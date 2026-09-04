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
/* global navigator, location, sessionStorage */

const ACTIVE_KOMERCE_CACHE = 'komerce-v341';
const RELOAD_MARKER = 'kmrc_sw_reload_v341';

function setupServiceWorkerRefresh({
  serviceWorker = navigator.serviceWorker,
  cacheStorage = window.caches,
  storage = sessionStorage,
  reload = location.reload.bind(location),
  logger = console,
} = {}) {
  if (!serviceWorker) return false;

  serviceWorker.getRegistrations().then((registrations) => {
    registrations.forEach((registration) => {
      registration.update();
    });
  });

  serviceWorker.addEventListener('message', (event) => {
    const isCurrentUpdate =
      event.data?.type === 'sw-updated' &&
      event.data?.version === 'v341';

    if (!isCurrentUpdate || !serviceWorker.controller) return;
    if (storage.getItem(RELOAD_MARKER) === '1') return;

    storage.setItem(RELOAD_MARKER, '1');
    logger.log('[SW] Nouvelle version v341 → rechargement unique');
    reload();
  });

  if (cacheStorage) {
    cacheStorage.keys().then((names) => {
      names.forEach((name) => {
        if (
          name.startsWith('komerce-') &&
          name !== ACTIVE_KOMERCE_CACHE
        ) {
          cacheStorage.delete(name);
        }
      });
    });
  }

  return true;
}

if ('serviceWorker' in navigator) {
  setupServiceWorkerRefresh();
}

export { setupServiceWorkerRefresh };
