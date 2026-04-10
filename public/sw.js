/* Komerce Service Worker v6.0 — Cross-origin safe + Network-First HTML */
const CACHE = 'komerce-v6';

const SHELL = [
  '/Komerce_Boutique.html',
  '/komerce-api.js',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

/* ── Install: précache le SHELL — tolérant ── */
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((cache) =>
      Promise.all(
        SHELL.map((url) =>
          cache.add(url).catch((err) => {
            console.warn('[SW v6] Cache skip:', url, err.message || err);
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
          console.log('[SW v6] Purging old cache:', k);
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

  /* ★ CRITICAL: Skip cross-origin requests entirely ★
     Let the browser handle Cloudinary, Unsplash, Google Fonts, CDNs etc.
     The SW should only manage same-origin assets. */
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
            .then((cached) => cached || caches.match('/Komerce_Boutique.html'))
            .then((fallback) => fallback || new Response('Hors ligne', {
              status: 503,
              headers: { 'Content-Type': 'text/html; charset=utf-8' }
            }))
        )
    );
    return;
  }

  /* Same-origin static assets → CACHE-FIRST */
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
