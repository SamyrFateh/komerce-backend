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
/* global navigator, caches, location, sessionStorage */

const ACTIVE_KOMERCE_CACHE = 'komerce-v337';
const RELOAD_MARKER = 'kmrc_sw_reload_v337';

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((registrations) => {
    registrations.forEach((registration) => {
      registration.update();
    });
  });

  navigator.serviceWorker.addEventListener('message', (event) => {
    const isCurrentUpdate =
      event.data?.type === 'sw-updated' &&
      event.data?.version === 'v337';

    if (!isCurrentUpdate || !navigator.serviceWorker.controller) return;
    if (sessionStorage.getItem(RELOAD_MARKER) === '1') return;

    sessionStorage.setItem(RELOAD_MARKER, '1');
    console.log('[SW] Nouvelle version v337 → rechargement unique');
    location.reload();
  });

  if (window.caches) {
    caches.keys().then((names) => {
      names.forEach((name) => {
        if (
          name.startsWith('komerce-') &&
          name !== ACTIVE_KOMERCE_CACHE
        ) {
          caches.delete(name);
        }
      });
    });
  }
}
