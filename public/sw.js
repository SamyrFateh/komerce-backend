// ═══════════════════════════════════════════════════════════════════════════
//   KOMERCE — Service Worker v3.2
//   Stratégie : Cache-First pour assets statiques, Network-First pour l'API
//   Optimisé pour réseau instable (Comores)
//   v3.2 : fix CDN caching (qrcode lib + fonts) — les CDN sont maintenant
//          cachés en Stale-While-Revalidate au lieu d'être ignorés
// ═══════════════════════════════════════════════════════════════════════════

const CACHE_NAME = 'komerce-v3.2';
const CACHE_STATIC = 'komerce-static-v3.2';
const CACHE_API    = 'komerce-api-v3.2';
const CACHE_CDN    = 'komerce-cdn-v3.2';

// Assets à mettre en cache immédiatement à l'installation
const STATIC_ASSETS = [
  '/',
  '/Komerce_Boutique.html',
  '/manifest.json',
];

// CDN critiques à pré-cacher à l'installation
const CDN_PRECACHE = [
  'https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js',
  'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js',
];

// Routes API — Network-First avec fallback cache
const API_ROUTES = [
  '/api/products',
  '/api/rates',
  '/api/orders',
];

// ─── Install ──────────────────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  console.log('[SW] Install v3.2');
  event.waitUntil(
    Promise.all([
      caches.open(CACHE_STATIC).then((cache) => {
        return cache.addAll(STATIC_ASSETS.map(url => new Request(url, { cache: 'reload' })))
          .catch(err => console.warn('[SW] Certains assets non mis en cache:', err));
      }),
      // Pré-cacher les CDN critiques pour fonctionnement offline
      caches.open(CACHE_CDN).then((cache) => {
        return cache.addAll(CDN_PRECACHE.map(url => new Request(url, { mode: 'cors' })))
          .catch(err => console.warn('[SW] CDN non pré-cachés (pas grave, fallback API QR):', err));
      }),
    ]).then(() => self.skipWaiting())
  );
});

// ─── Activate ─────────────────────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  console.log('[SW] Activate v3.2');
  const KEEP = [CACHE_STATIC, CACHE_API, CACHE_CDN];
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter(name => !KEEP.includes(name))
          .map(name => {
            console.log('[SW] Suppression ancien cache:', name);
            return caches.delete(name);
          })
      );
    }).then(() => self.clients.claim())
  );
});

// ─── Fetch ────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Ignorer les requêtes non-GET
  if (request.method !== 'GET') return;

  // Ignorer analytics & tracking
  if (url.hostname === 'ipapi.co') return;
  if (url.hostname === 'www.googletagmanager.com') return;
  if (url.hostname === 'www.google-analytics.com') return;

  // CDN scripts & fonts → Stale-While-Revalidate (disponible offline!)
  if (
    url.hostname === 'cdn.jsdelivr.net' ||
    url.hostname === 'unpkg.com' ||
    url.hostname === 'cdnjs.cloudflare.com' ||
    url.hostname === 'fonts.googleapis.com' ||
    url.hostname === 'fonts.gstatic.com'
  ) {
    event.respondWith(staleWhileRevalidate(request, CACHE_CDN));
    return;
  }

  // API Komerce → Network-First avec fallback cache
  if (url.hostname.includes('railway.app') || url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirstStrategy(request, CACHE_API));
    return;
  }

  // App shell (index.html, manifest) → Stale-While-Revalidate
  if (url.hostname === self.location.hostname) {
    event.respondWith(staleWhileRevalidate(request, CACHE_STATIC));
    return;
  }
});

// ─── Stratégies ───────────────────────────────────────────────────────────────

/**
 * Network-First : essaie le réseau, fallback sur le cache si offline
 */
async function networkFirstStrategy(request, cacheName) {
  const cache = await caches.open(cacheName);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(request, { signal: controller.signal });
    clearTimeout(timeout);

    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) {
      console.log('[SW] Fallback cache pour:', request.url);
      return cached;
    }
    return new Response(
      JSON.stringify({ error: 'offline', message: 'Données indisponibles hors connexion' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

/**
 * Stale-While-Revalidate : sert immédiatement depuis le cache,
 * met à jour en arrière-plan
 */
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const networkFetch = fetch(request).then((response) => {
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  }).catch(() => null);

  return cached || networkFetch || new Response('App indisponible hors ligne', { status: 503 });
}

// ─── Message handler ──────────────────────────────────────────────────────────
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data === 'CLEAR_CACHE') {
    caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))));
  }
});
