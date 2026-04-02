// ═══════════════════════════════════════════════════════════════════════════
//   KOMERCE — Service Worker v1.0
//   Stratégie : Cache-First pour assets statiques, Network-First pour l'API
//   Optimisé pour réseau instable (Comores)
// ═══════════════════════════════════════════════════════════════════════════

const CACHE_NAME = 'komerce-v1';
const CACHE_STATIC = 'komerce-static-v1';
const CACHE_API    = 'komerce-api-v1';

// Assets à mettre en cache immédiatement à l'installation
const STATIC_ASSETS = [
  '/',
  '/Komerce_Web.html',
  '/manifest.json',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap',
  'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.min.js',
];

// Routes API — Network-First avec fallback cache
const API_ROUTES = [
  '/api/products',
  '/api/rates',
  '/api/orders',
];

// ─── Install ──────────────────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  console.log('[SW] Install');
  event.waitUntil(
    caches.open(CACHE_STATIC).then((cache) => {
      return cache.addAll(STATIC_ASSETS.map(url => new Request(url, { cache: 'reload' })))
        .catch(err => console.warn('[SW] Certains assets non mis en cache:', err));
    }).then(() => self.skipWaiting())
  );
});

// ─── Activate ─────────────────────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  console.log('[SW] Activate');
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

  // API Komerce → Network-First avec fallback cache
  if (url.hostname.includes('railway.app') || url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirstStrategy(request, CACHE_API));
    return;
  }

  // Google Fonts → Cache-First (économise la bande passante)
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(cacheFirstStrategy(request, CACHE_STATIC));
    return;
  }

  // CDN (qrcode, etc.) → Cache-First
  if (url.hostname === 'cdn.jsdelivr.net') {
    event.respondWith(cacheFirstStrategy(request, CACHE_STATIC));
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
 * Cache-First : sert depuis le cache, tente le réseau seulement si absent
 * Idéal pour les assets statiques qui ne changent pas souvent
 */
async function cacheFirstStrategy(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('Ressource indisponible hors ligne', { status: 503 });
  }
}

/**
 * Network-First : essaie le réseau, fallback sur le cache si offline
 * Idéal pour l'API (données fraîches si possible, cache si réseau coupé)
 */
async function networkFirstStrategy(request, cacheName) {
  const cache = await caches.open(cacheName);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000); // 5s timeout
    const response = await fetch(request, { signal: controller.signal });
    clearTimeout(timeout);

    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    // Réseau indisponible → fallback cache
    const cached = await cache.match(request);
    if (cached) {
      console.log('[SW] Fallback cache pour:', request.url);
      return cached;
    }
    // Aucun cache → réponse d'erreur JSON
    return new Response(
      JSON.stringify({ error: 'offline', message: 'Données indisponibles hors connexion' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

/**
 * Stale-While-Revalidate : sert immédiatement depuis le cache,
 * met à jour en arrière-plan
 * Idéal pour l'app shell (chargement instantané + fraîcheur garantie)
 */
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  // Revalidation en arrière-plan
  const networkFetch = fetch(request).then((response) => {
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  }).catch(() => null);

  // Servir depuis le cache immédiatement, sinon attendre le réseau
  return cached || networkFetch || new Response('App indisponible hors ligne', { status: 503 });
}

// ─── Message handler (pour forcer la mise à jour depuis l'app) ────────────────
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data === 'CLEAR_CACHE') {
    caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))));
  }
});
