/**
 * @komerce-arch-lite
 * @role          platform-service-worker
 * @domain        platform
 * @layer         infrastructure
 * @owner         dashboards
 * @purpose       Service Worker — cache offline, pre-fetch assets, bump versions.
 * @impact-areas  platform
 * @version       2026-06
 */
/* Komerce SW v335 — network-first + garde anti-empoisonnement de cache
 *
 * Changements vs v328 :
 *   - Bump de version (v328 → v335) : force la purge de l'ancien cache sur tous les clients.
 *   - Le nom de cache garde le préfixe v334 car index.html conserve temporairement
 *     uniquement les caches qui contiennent "komerce-v334".
 *   - Ne met plus en cache une réponse dont le Content-Type ne correspond pas à
 *     la ressource demandée. Cas typique : un .js / .css qui renvoie en fait du
 *     HTML (fallback SPA, page d'erreur, redirection 200). Avant, ce HTML était
 *     caché puis resservi comme si c'était le script/feuille de style → vue non
 *     stylée ou cassée. Désormais on renvoie la réponse réseau mais on ne la cache pas.
 *   - Ne cache que les réponses same-origin "basic" et 200 OK.
 */
const CACHE = 'komerce-v334-v335';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => {
        if (k !== CACHE) {
          console.log('[SW v335] Purge ancien cache :', k);
          return caches.delete(k);
        }
      }));
      await self.clients.claim();
      const clients = await self.clients.matchAll({ type: 'window' });
      clients.forEach(client => {
        client.postMessage({ type: 'sw-updated', version: 'v335' });
      });
    })()
  );
});

/* Vérifie que la réponse est saine ET que son type correspond à la ressource.
   Empêche de cacher du HTML servi à la place d'un .js / .css. */
function isCacheable(request, response) {
  if (!response || !response.ok)        return false;   // pas de 4xx/5xx/opaque-redirect
  if (response.type !== 'basic')        return false;   // same-origin uniquement

  const ct   = (response.headers.get('Content-Type') || '').toLowerCase();
  const dest = request.destination;                     // 'script' | 'style' | 'image' | 'font' | 'document' | ''
  const path = new URL(request.url).pathname.toLowerCase();

  const isScript = dest === 'script' || path.endsWith('.js')  || path.endsWith('.mjs');
  const isStyle  = dest === 'style'  || path.endsWith('.css');

  // Un script doit être servi en JS, une feuille de style en CSS.
  // Sinon (souvent du text/html), on refuse de cacher pour ne pas empoisonner.
  if (isScript && !(ct.includes('javascript') || ct.includes('ecmascript'))) return false;
  if (isStyle  && !ct.includes('css'))                                       return false;

  return true;
}

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  e.respondWith(
    fetch(e.request)
      .then(response => {
        if (isCacheable(e.request, response)) {
          const clone = response.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone).catch(() => {}));
        }
        return response;
      })
      .catch(() => caches.match(e.request).then(c => c || new Response('Hors ligne', { status: 503 })))
  );
});