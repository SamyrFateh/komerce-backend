/* Komerce Service Worker v12 — Force cache refresh */
const CACHE = 'komerce-v18';

const SHELL = [
  '/Komerce_Boutique.html',
  '/boutique.css',
  '/boutique.js',
  '/manifest.json'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((cache) =>
      Promise.all(
        SHELL.map((url) =>
          cache.add(url).catch((err) => {
            console.warn('[SW v12] Cache skip:', url, err.message || err);
          })
        )
      )
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE).map((k) => {
          console.log('[SW v12] Purging old cache:', k);
          return caches.delete(k);
        })
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const request = e.request;
  if (request.method !== 'GET') return;
  
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  const isHTML = request.mode === 'navigate'
    || url.pathname === '/'
    || url.pathname.endsWith('.html')
    || (request.headers.get('accept') || '').includes('text/html');

  if (isHTML) {
    e.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const rc = response.clone();
            caches.open(CACHE).then((c) => c.put(request, rc).catch(() => {}));
          }
          return response;
        })
        .catch(() =>
          caches.match(request)
            .then((cached) => cached || caches.match('/Komerce_Boutique.html'))
            .then((fb) => fb || new Response('<h1>Hors ligne</h1>', {
              status: 503,
              headers: { 'Content-Type': 'text/html; charset=utf-8' }
            }))
        )
    );
    return;
  }

  if (url.pathname.endsWith('.js') || url.pathname.endsWith('.css')) {
    e.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const rc = response.clone();
            caches.open(CACHE).then((c) => c.put(request, rc).catch(() => {}));
          }
          return response;
        })
        .catch(() => caches.match(request).then((c) => c || new Response('', { status: 503 })))
    );
    return;
  }

  e.respondWith(
    caches.match(request)
      .then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok) {
            const rc = response.clone();
            caches.open(CACHE).then((c) => c.put(request, rc).catch(() => {}));
          }
          return response;
        });
      })
      .catch(() => new Response('', { status: 503 }))
  );
});
