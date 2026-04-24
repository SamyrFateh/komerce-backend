/* Komerce SW v177 — purge agressive + reload forcé aux clients */
const CACHE = 'komerce-v219';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => {
        if (k !== CACHE) {
          console.log('[SW v177] Purge ancien cache :', k);
          return caches.delete(k);
        }
      }));
      await self.clients.claim();
      const clients = await self.clients.matchAll({ type: 'window' });
      clients.forEach(client => {
        client.postMessage({ type: 'sw-updated', version: 'v189' });
      });
    })()
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  e.respondWith(
    fetch(e.request)
      .then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone).catch(() => {}));
        }
        return response;
      })
      .catch(() => caches.match(e.request).then(c => c || new Response('Hors ligne', { status: 503 })))
  );
});
