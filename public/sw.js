// ═══════════════════════════════════════════════════════════════════════════
//   KOMERCE — Service Worker v3.1
//   Stratégie : Cache-First pour assets statiques, Network-First pour l'API
//   Optimisé pour réseau instable (Comores)
//   v3.1 : bump version pour forcer ré-installation + CSP fix
// ═══════════════════════════════════════════════════════════════════════════

const CACHE_NAME = 'komerce-v3.1';
const CACHE_STATIC = 'komerce-static-v3.1';
const CACHE_API    = 'komerce-api-v3.1';

// Assets à mettre en cache immédiatement à l'installation
const STATIC_ASSETS = [
  '/',
  '/Komerce_Boutique.html',
  '/manifest.json',
];

// Routes API — Network-First avec fallback cache
const API_ROUTES = [
  '/api/products',
  '/api/rates',
  '/api/orders',
];

// ─── Install ──────────────────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  console.log('[SW] Install v3.1');
  event.waitUntil(
    caches.open(CACHE_STATIC).then((cache) => {
      return cache.addAll(STATIC_ASSETS.map(url => new Request(url, { cache: 'reload' })))
        .catch(err => console.warn('[SW] Certains assets non mis en cache:', err));
    }).then(() => self.skipWaiting())
  );
});

// ─── Activate ─────────────────────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  console.log('[SW] Activate v3.1');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter(name => name !== CACHE_STATIC && name !== CACHE_API)
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

  // Ignorer les requêtes vers des domaines tiers non critiques
  if (url.hostname === 'ipapi.co') return;
  if (url.hostname === 'www.googletagmanager.com') return;
  if (url.hostname === 'www.google-analytics.com') return;

  // Laisser passer les CDN externes sans interception SW
  // (évite les erreurs CSP — les CDN sont déjà autorisés par Helmet)
  if (
    url.hostname === 'fonts.googleapis.com' ||
    url.hostname === 'fonts.gstatic.com' ||
    url.hostname === 'cdn.jsdelivr.net' ||
    url.hostname === 'unpkg.com' ||
    url.hostname === 'cdnjs.cloudflare.com'
  ) {
    // Ne pas intercepter — laisser le navigateur gérer directement
    return;
  }

  // API Komerce → Network-First avec fallback cache
  if (url.hostname.includes('railway.app') || url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirstStrategy(request, CACHE_API));
    return;
  }

  // App shell (index.html, manifest) → Cache-First avec revalidation en arrière-plan
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
