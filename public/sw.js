/**
 * @komerce-arch-lite
 * @role          platform-service-worker
 * @domain        platform
 * @layer         infrastructure
 * @owner         dashboards
 * @purpose       Service Worker — cache offline, préchargement et rotation contrôlée des assets.
 * @impact-areas  platform, boutique-cache
 * @version       2026-08
 */

'use strict';

/* Komerce SW v338 — rotation catalogue : cutouts HD et titres de sections
 *
 * La rotation force le rechargement des modules Commandes / Mon Komerce et
 * de leurs styles afin que les documents privés et le wallet compact soient
 * visibles immédiatement sur les sessions déjà ouvertes.
 *
 * La garde anti-empoisonnement demeure : une réponse HTML reçue à la place
 * d'un script ou d'une feuille CSS n'est jamais mise en cache.
 */
const CACHE = 'komerce-v338';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.map((key) => {
          if (key === CACHE || !key.startsWith('komerce-')) return undefined;
          console.log('[SW v338] Purge ancien cache :', key);
          return caches.delete(key);
        })
      );

      await self.clients.claim();

      const clients = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });

      clients.forEach((client) => {
        client.postMessage({ type: 'sw-updated', version: 'v338' });
      });
    })()
  );
});

function isCacheable(request, response) {
  if (!response || !response.ok) return false;
  if (response.type !== 'basic') return false;

  const contentType = (
    response.headers.get('Content-Type') || ''
  ).toLowerCase();
  const destination = request.destination;
  const pathname = new URL(request.url).pathname.toLowerCase();

  const isScript =
    destination === 'script' ||
    pathname.endsWith('.js') ||
    pathname.endsWith('.mjs');
  const isStyle =
    destination === 'style' ||
    pathname.endsWith('.css');

  if (
    isScript &&
    !contentType.includes('javascript') &&
    !contentType.includes('ecmascript')
  ) {
    return false;
  }

  if (isStyle && !contentType.includes('css')) return false;

  return true;
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (isCacheable(event.request, response)) {
          const clone = response.clone();
          caches
            .open(CACHE)
            .then((cache) => cache.put(event.request, clone))
            .catch(() => {});
        }
        return response;
      })
      .catch(() =>
        caches
          .match(event.request)
          .then(
            (cached) =>
              cached ||
              new Response('Hors ligne', { status: 503 })
          )
      )
  );
});
