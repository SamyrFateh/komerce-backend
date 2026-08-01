/**
 * @komerce-arch
 * @role          boutique-service-worker-refresh
 * @domain        boutique
 * @layer         ui-bootstrap
 * @criticality   medium
 * @inputs        navigator.serviceWorker, CacheStorage
 * @outputs       service-worker-update-check, stale-cache-cleanup
 * @depends       browser-service-worker-api, browser-cache-api
 * @used-by       public/boutique/index.html
 * @doctrine      csp_no_inline_script, mise_a_jour_sans_boucle
 * @impact-areas  boutique-bootstrap, cache, service-worker
 * @version       2026-08
 */
'use strict';
/* global navigator, caches, location */

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(function (registrations) {
    registrations.forEach(function (registration) {
      registration.update();
    });
  });

  navigator.serviceWorker.addEventListener('message', function (event) {
    if (event.data && event.data.type === 'sw-updated' && navigator.serviceWorker.controller) {
      console.log('[SW] Nouvelle version', event.data.version, '→ reload auto');
      location.reload();
    }
  });

  if (window.caches) {
    caches.keys().then(function (names) {
      names.forEach(function (name) {
        if (name.indexOf('komerce-v334') === -1) caches.delete(name);
      });
    });
  }
}
