/* Komerce Service Worker v2.0 — Stale-While-Revalidate + Offline Shell */
const CACHE = 'komerce-v3';
const SHELL = [
  '/portal.html',
  '/komerce-ui.css',
  '/komerce-api.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

/* Install: pre-cache shell */
self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(CACHE)
      .then(function(c) { return c.addAll(SHELL); })
      .then(function() { return self.skipWaiting(); })
  );
});

/* Activate: clean old caches */
self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k) { return k !== CACHE; })
            .map(function(k) { return caches.delete(k); })
      );
    }).then(function() { return self.clients.claim(); })
  );
});

/* Fetch: stale-while-revalidate for HTML/CSS/JS, network-first for API */
self.addEventListener('fetch', function(e) {
  var url = new URL(e.request.url);

  /* Skip non-GET */
  if (e.request.method !== 'GET') return;

  /* API calls: network only (never cache mutable data) */
  if (url.pathname.startsWith('/api/')) return;

  /* Auth endpoints: never cache */
  if (url.pathname.indexOf('auth') !== -1) return;

  /* Static assets + HTML: stale-while-revalidate */
  e.respondWith(
    caches.open(CACHE).then(function(cache) {
      return cache.match(e.request).then(function(cached) {
        var fetchPromise = fetch(e.request).then(function(response) {
          if (response.ok && response.type === 'basic') {
            cache.put(e.request, response.clone());
          }
          return response;
        }).catch(function() {
          /* Offline: serve cached version */
          return cached;
        });

        /* Return cached immediately, update in background */
        return cached || fetchPromise;
      });
    })
  );
});
