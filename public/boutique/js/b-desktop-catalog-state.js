/**
 * @module b-desktop-catalog-state
 * @brief État visuel desktop du catalogue.
 *
 * Rôle :
 * - ajouter body.k-catalog-focused quand une catégorie autre que "all" est active
 * - permettre au CSS desktop de compacter les pavillons
 * - rester totalement découplé du rendu catalogue
 */

import { bus } from './b-bus.js';
import { state } from './b-store.js';

function isDesktop() {
  return window.innerWidth >= 900;
}

function syncCatalogFocus(cat) {
  if (!document.body) return;

  const activeCat = cat || state.activeCat || 'all';
  const focused = isDesktop() && activeCat && activeCat !== 'all';

  document.body.classList.toggle('k-catalog-focused', focused);
}

export function setupDesktopCatalogState() {
  syncCatalogFocus(state.activeCat);

  bus.on('catalog:cat-changed', function(cat) {
    syncCatalogFocus(cat);
  });

  window.addEventListener('resize', function() {
    syncCatalogFocus(state.activeCat);
  }, { passive: true });
}
