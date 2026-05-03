// Service Worker for Sufrin Cards PWA
// Version 2.0.0 - Smart caching with automatic updates

// IMPORTANT: Bump this version when releasing significant changes
// to force all clients to clear old caches.
const SW_VERSION = '2.0.0';
const CACHE_NAME = `sufrin-cards-v${SW_VERSION}`;
const RUNTIME_CACHE = `sufrin-runtime-v${SW_VERSION}`;

// Files to cache on install (app shell)
const PRECACHE_URLS = [
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon.png'
];

// ============================================
// INSTALL - Cache app shell
// ============================================
self.addEventListener('install', (event) => {
  console.log(`[SW v${SW_VERSION}] Install`);
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[SW] Caching shell resources');
        return Promise.allSettled(
          PRECACHE_URLS.map(url => cache.add(url).catch(e => console.warn(`Failed to cache: ${url}`)))
        );
      })
      .then(() => self.skipWaiting()) // Activate new SW immediately
  );
});

// ============================================
// ACTIVATE - Clean up old caches
// ============================================
self.addEventListener('activate', (event) => {
  console.log(`[SW v${SW_VERSION}] Activate`);
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => {
            // Delete any cache that doesn't match current version
            return name.startsWith('sufrin-') && 
                   name !== CACHE_NAME && 
                   name !== RUNTIME_CACHE;
          })
          .map((name) => {
            console.log('[SW] Deleting old cache:', name);
            return caches.delete(name);
          })
      );
    }).then(() => {
      // Take control of all open tabs immediately
      return self.clients.claim();
    }).then(() => {
      // Notify all open tabs of the update
      return self.clients.matchAll().then(clients => {
        clients.forEach(client => {
          client.postMessage({ type: 'SW_UPDATED', version: SW_VERSION });
        });
      });
    })
  );
});

// ============================================
// FETCH - Network first for HTML, cache first for assets
// ============================================
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Don't cache POST/PUT/DELETE
  if (request.method !== 'GET') return;

  // Don't cache Supabase API or auth (always fresh)
  if (url.hostname.includes('supabase.co')) return;
  
  // Don't cache CDN scripts (always fresh, they have their own cache headers)
  if (url.hostname.includes('cdn.jsdelivr.net') || 
      url.hostname.includes('cdnjs.cloudflare.com') ||
      url.hostname.includes('unpkg.com')) {
    return;
  }

  // ============================================
  // HTML Pages: Network-first (always try latest)
  // ============================================
  if (request.mode === 'navigate' || 
      request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(request, { cache: 'no-store' })
        .then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(RUNTIME_CACHE).then((cache) => {
              cache.put(request, clone).catch(() => {});
            });
          }
          return response;
        })
        .catch(() => {
          // Offline - try cache
          return caches.match(request).then((cached) => {
            if (cached) return cached;
            // No cache either - show offline message
            return new Response(
              `<!DOCTYPE html><html lang="he" dir="rtl"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>לא מקוון</title><style>body{font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#FAFAF7;color:#0A1628;padding:20px;text-align:center}.box{max-width:300px}h1{font-size:24px;margin-bottom:10px}p{color:#6B6555;font-size:14px}button{margin-top:20px;padding:12px 24px;background:#0A1628;color:white;border:none;border-radius:10px;font-size:14px;cursor:pointer}</style></head><body><div class="box"><div style="font-size:48px;margin-bottom:16px;">📡</div><h1>אין חיבור</h1><p>בדוק את החיבור לאינטרנט ונסה שוב</p><button onclick="location.reload()">נסה שוב</button></div></body></html>`,
              { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
            );
          });
        })
    );
    return;
  }

  // ============================================
  // Static assets (images, icons): Cache-first
  // ============================================
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) {
        // Update in background (don't block on this)
        fetch(request).then((response) => {
          if (response && response.status === 200) {
            caches.open(RUNTIME_CACHE).then((cache) => {
              cache.put(request, response).catch(() => {});
            });
          }
        }).catch(() => {});
        return cached;
      }
      
      // Not cached - fetch and cache
      return fetch(request).then((response) => {
        if (!response || response.status !== 200) return response;
        const clone = response.clone();
        caches.open(RUNTIME_CACHE).then((cache) => {
          cache.put(request, clone).catch(() => {});
        });
        return response;
      }).catch(() => {
        return new Response('', { status: 408, statusText: 'Offline' });
      });
    })
  );
});

// ============================================
// MESSAGE - Handle update commands
// ============================================
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data?.type === 'CLEAR_CACHE') {
    caches.keys().then(names => {
      return Promise.all(names.map(name => caches.delete(name)));
    }).then(() => {
      event.ports[0]?.postMessage({ cleared: true });
    });
  }
  if (event.data?.type === 'GET_VERSION') {
    event.ports[0]?.postMessage({ version: SW_VERSION });
  }
});
