// Service Worker for Sufrin Cards PWA
// Version 1.0.0

const CACHE_NAME = 'sufrin-cards-v1';
const RUNTIME_CACHE = 'sufrin-runtime-v1';

// Files to cache on install (app shell)
const PRECACHE_URLS = [
  '/app',
  '/app.html',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png'
];

// External resources we want to cache
const EXTERNAL_CACHE = [
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
  'https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js'
];

// ============================================
// INSTALL - Cache app shell
// ============================================
self.addEventListener('install', (event) => {
  console.log('[SW] Install');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[SW] Caching app shell');
        return cache.addAll(PRECACHE_URLS).catch(err => {
          console.warn('[SW] Failed to cache some resources:', err);
          // Try caching individually
          return Promise.allSettled(
            PRECACHE_URLS.map(url => cache.add(url).catch(e => console.warn(`Failed: ${url}`, e)))
          );
        });
      })
      .then(() => self.skipWaiting())
  );
});

// ============================================
// ACTIVATE - Clean up old caches
// ============================================
self.addEventListener('activate', (event) => {
  console.log('[SW] Activate');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME && name !== RUNTIME_CACHE)
          .map((name) => {
            console.log('[SW] Deleting old cache:', name);
            return caches.delete(name);
          })
      );
    }).then(() => self.clients.claim())
  );
});

// ============================================
// FETCH - Network first, fallback to cache
// ============================================
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Don't cache POST/PUT/DELETE (Supabase API calls)
  if (request.method !== 'GET') return;

  // Don't cache Supabase API or auth calls (always fresh)
  if (url.hostname.includes('supabase.co')) return;

  // Network-first strategy for HTML (always try latest)
  if (request.mode === 'navigate' || request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Clone and cache successful responses
          const clone = response.clone();
          caches.open(RUNTIME_CACHE).then((cache) => {
            cache.put(request, clone).catch(() => {});
          });
          return response;
        })
        .catch(() => {
          // Offline - serve from cache
          return caches.match(request).then((cached) => {
            return cached || caches.match('/app.html');
          });
        })
    );
    return;
  }

  // Cache-first for static assets (images, scripts, styles)
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) {
        // Update cache in background
        fetch(request).then((response) => {
          if (response && response.status === 200) {
            caches.open(RUNTIME_CACHE).then((cache) => {
              cache.put(request, response).catch(() => {});
            });
          }
        }).catch(() => {});
        return cached;
      }
      
      // Not in cache - fetch and cache
      return fetch(request).then((response) => {
        if (!response || response.status !== 200) return response;
        const clone = response.clone();
        caches.open(RUNTIME_CACHE).then((cache) => {
          cache.put(request, clone).catch(() => {});
        });
        return response;
      }).catch(() => {
        // Truly offline and not cached
        return new Response('', { status: 408, statusText: 'Offline' });
      });
    })
  );
});

// ============================================
// MESSAGE - Allow page to trigger SW updates
// ============================================
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
