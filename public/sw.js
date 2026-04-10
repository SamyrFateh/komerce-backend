/* Komerce Service Worker v7.0 — Cache bust + Cross-origin safe + Network-First HTML */
const CACHE = 'komerce-v8';

const SHELL = [
  '/boutique.html',
  '/manifest.json'
];

/* ── Install: précache le SHELL — tolérant ── */
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((cache) =>
      Promise.all(
        SHELL.map((url) =>
          cache.add(url).catch((err) => {
            console.warn('[SW v7] Cache skip:', url, err.message || err);
          })
        )
      )
    ).then(() => self.skipWaiting())
  );
});

/* ── Activate: purge ALL old caches ── */
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE).map((k) => {
          console.log('[SW v7] Purging old cache:', k);
          return caches.delete(k);
        })
      )
    ).then(() => self.clients.claim())
  );
});

/* ── Fetch strategy ── */
self.addEventListener('fetch', (e) => {
  const request = e.request;

  /* Skip non-GET */
  if (request.method !== 'GET') return;

  /* ★ CRITICAL: Skip cross-origin requests entirely ★ */
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  /* Skip API requests — always network, no caching */
  if (url.pathname.startsWith('/api/')) return;

  /* HTML pages → NETWORK-FIRST (always latest, cache = offline fallback) */
  const isHTML = request.mode === 'navigate'
    || url.pathname === '/'
    || url.pathname.endsWith('.html')
    || (request.headers.get('accept') || '').includes('text/html');

  if (isHTML) {
    e.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE).then((c) => c.put(request, clone).catch(() => {}));
          }
          return response;
        })
        .catch(() =>
          caches.match(request)
            .then((cached) => cached || caches.match('/boutique.html'))
            .then((fallback) => fallback || new Response('Hors ligne', {
              status: 503,
              headers: { 'Content-Type': 'text/html; charset=utf-8' }
            }))
        )
    );
    return;
  }

  /* JS/CSS → NETWORK-FIRST too (ensures fresh code after deploy) */
  if (url.pathname.endsWith('.js') || url.pathname.endsWith('.css')) {
    e.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE).then((c) => c.put(request, clone).catch(() => {}));
          }
          return response;
        })
        .catch(() => caches.match(request).then((c) => c || new Response('', { status: 503 })))
    );
    return;
  }

  /* Other same-origin static assets → CACHE-FIRST */
  e.respondWith(
    caches.match(request)
      .then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE).then((c) => c.put(request, clone).catch(() => {}));
          }
          return response;
        });
      })
      .catch(() => new Response('', { status: 503 }))
  );
});
