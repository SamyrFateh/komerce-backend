/* Komerce Service Worker v4.0 — Tolerant Install + Offline Boutique */
const CACHE = 'komerce-v4';

/* SHELL = vrais assets utilisés par la Boutique mobile */
const SHELL = [
  '/Komerce_Boutique.html',
  '/komerce-api.js',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

/* Autres pages — cachées au runtime, pas au SHELL */
const RUNTIME_PAGES = [
  '/portal.html',
  '/komerce-ui.css',
  '/Komerce_Hub.html',
  '/Komerce_Relais.html',
  '/Komerce_Admin.html',
  '/Komerce_Pipeline.html'
];

/* Install: pre-cache SHELL — tolerant (un asset qui échoue ne casse pas tout) */
self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(CACHE).then(function(cache) {
      return Promise.all(
        SHELL.map(function(url) {
          return cache.add(url).catch(function(err) {
            console.warn('[SW] Échec cache:', url, err.message || err);
          });
        })
      );
    }).then(function() {
      return self.skipWaiting();
    })
  );
});

/* Activate: purge vieux caches (v1, v2, v3...) */
self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k) { return k !== CACHE; })
            .map(function(k) {
              console.log('[SW] Suppression ancien cache:', k);
              return caches.delete(k);
            })
      );
    }).then(function() {
      return self.clients.claim();
    })
  );
});

/* Fetch: stale-while-revalidate pour static, network-only pour API */
self.addEventListener('fetch', function(e) {
  var url = new URL(e.request.url);

  /* Skip non-GET */
  if (e.request.method !== 'GET') return;

  /* API calls: network only (données mutables) */
  if (url.pathname.startsWith('/api/')) return;

  /* Auth endpoints: jamais en cache */
  if (url.pathname.indexOf('auth') !== -1) return;

  /* Static assets + HTML: stale-while-revalidate */
  e.respondWith(
    caches.open(CACHE).then(function(cache) {
      return cache.match(e.request).then(function(cached) {
        var fetchPromise = fetch(e.request).then(function(response) {
          if (response.ok && response.type === 'basic') {
            cache.put(e.request, response.clone());
          }
          return response;
        }).catch(function() {
          /* Offline: version cachée ou fallback Boutique */
          if (cached) return cached;
          /* Si c'est une page HTML, fallback vers Boutique cachée */
          if (e.request.headers.get('accept') &&
              e.request.headers.get('accept').indexOf('text/html') !== -1) {
            return cache.match('/Komerce_Boutique.html');
          }
          return undefined;
        });

        /* Retourne le cache immédiatement, met à jour en arrière-plan */
        return cached || fetchPromise;
      });
    })
  );
});
