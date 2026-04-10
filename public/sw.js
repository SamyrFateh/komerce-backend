/* Komerce Service Worker v5.0 — Network-First HTML + Tolerant Cache */
const CACHE = 'komerce-v5';

/* SHELL = vrais assets utilisés par la Boutique */
const SHELL = [
  '/Komerce_Boutique.html',
  '/komerce-api.js',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

/* Pages HTML — toujours network-first pour voir les mises à jour */
const HTML_PAGES = [
  '/Komerce_Boutique.html',
  '/Komerce_Hub.html',
  '/Komerce_Relais.html',
  '/Komerce_Admin.html',
  '/Komerce_Pipeline.html',
  '/portal.html'
];

function isHTMLRequest(request) {
  const url = new URL(request.url);
  if (HTML_PAGES.some(p => url.pathname === p || url.pathname === p.replace('.html', ''))) return true;
  if (url.pathname === '/' || url.pathname === '') return true;
  if (request.headers.get('accept') && request.headers.get('accept').includes('text/html')) return true;
  return false;
}

function isAPIRequest(request) {
  return new URL(request.url).pathname.startsWith('/api/');
}

/* ── Install: précache le SHELL — tolérant (un échec ne bloque pas) ── */
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((cache) =>
      Promise.all(
        SHELL.map((url) =>
          cache.add(url).catch((err) => {
            console.warn('[SW v5] Cache skip:', url, err.message || err);
          })
        )
      )
    ).then(() => self.skipWaiting())
  );
});

/* ── Activate: purge les anciens caches (v1, v2, v3, v4...) ── */
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE).map((k) => {
          console.log('[SW v5] Purging old cache:', k);
          return caches.delete(k);
        })
      )
    ).then(() => self.clients.claim())
  );
});

/* ── Fetch strategy ── */
self.addEventListener('fetch', (e) => {
  const request = e.request;

  /* Skip non-GET requests */
  if (request.method !== 'GET') return;

  /* Skip API requests — always go to network, no caching */
  if (isAPIRequest(request)) return;

  /* HTML pages → NETWORK-FIRST (always get latest, fallback to cache) */
  if (isHTMLRequest(request)) {
    e.respondWith(
      fetch(request)
        .then((response) => {
          /* Cache the fresh copy for offline */
          const clone = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, clone));
          return response;
        })
        .catch(() => {
          /* Offline → serve from cache */
          return caches.match(request)
            .then((cached) => cached || caches.match('/Komerce_Boutique.html'));
        })
    );
    return;
  }

  /* Static assets → CACHE-FIRST (fast, with network fallback) */
  e.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        /* Cache static assets for future use */
        if (response.ok && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, clone));
        }
        return response;
      });
    }).catch(() => {
      /* Ultimate fallback for navigation */
      if (request.mode === 'navigate') {
        return caches.match('/Komerce_Boutique.html');
      }
    })
  );
});
