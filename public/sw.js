/* Komerce Service Worker v9.0 — Refacto tri-fichiers (HTML + CSS + JS) */
const CACHE = 'komerce-v11';

/* Fichiers à pré-cacher au install */
const SHELL = [
  '/Komerce_Boutique.html',
  '/boutique.css',
  '/boutique.js',
  '/manifest.json'
];

/* ── Install: précache le SHELL — tolérant ── */
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((cache) =>
      Promise.all(
        SHELL.map((url) =>
          cache.add(url).catch((err) => {
            console.warn('[SW v10] Cache skip:', url, err.message || err);
          })
        )
      )
    ).then(() => self.skipWaiting())
  );
});

/* ── Activate: purge toutes les anciennes caches ── */
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE).map((k) => {
          console.log('[SW v10] Purging old cache:', k);
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

  /* Skip cross-origin (Google Fonts, Cloudinary, CDN…) */
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  /* API → réseau pur, jamais de cache */
  if (url.pathname.startsWith('/api/')) return;

  /* HTML → Network-first (toujours la version la plus récente) */
  const isHTML = request.mode === 'navigate'
    || url.pathname === '/'
    || url.pathname.endsWith('.html')
    || (request.headers.get('accept') || '').includes('text/html');

  if (isHTML) {
    e.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const responseClone = response.clone();
            caches.open(CACHE).then((c) => c.put(request, responseClone).catch(() => {}));
          }
          return response;
        })
        .catch(() =>
          caches.match(request)
            .then((cached) => cached || caches.match('/Komerce_Boutique.html'))
            .then((fallback) => fallback || new Response('<h1>Hors ligne</h1>', {
              status: 503,
              headers: { 'Content-Type': 'text/html; charset=utf-8' }
            }))
        )
    );
    return;
  }

  /* JS / CSS → Network-first (déploiements fréquents, toujours fresh) */
  if (url.pathname.endsWith('.js') || url.pathname.endsWith('.css')) {
    e.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const responseClone = response.clone();
            caches.open(CACHE).then((c) => c.put(request, responseClone).catch(() => {}));
          }
          return response;
        })
        .catch(() => caches.match(request).then((c) => c || new Response('', { status: 503 })))
    );
    return;
  }

  /* Autres assets statiques (images, icons…) → Cache-first */
  e.respondWith(
    caches.match(request)
      .then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok) {
            const responseClone = response.clone();
            caches.open(CACHE).then((c) => c.put(request, responseClone).catch(() => {}));
          }
          return response;
        });
      })
      .catch(() => new Response('', { status: 503 }))
  );
});
