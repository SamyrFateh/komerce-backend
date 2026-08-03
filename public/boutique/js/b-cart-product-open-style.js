/**
 * @komerce-arch-lite
 * @role          catalog-b-cart-product-open-style
 * @domain        catalog
 * @layer         ui-component
 * @owner         public/boutique/js/b-modal-core.js
 * @purpose       supports public/boutique/js/b-modal-core.js
 * @impact-areas  catalog, product-discovery
 * @version       2026-06
 */
'use strict';

/**
 * @module b-cart-product-open-style
 * @brief Charge les modules UX légers branchés au boot boutique.
 */

export function setupCartProductOpenStyle() {
  // NOTE 2026-05-19 : injection de cart-product-open.css retirée — fichier
  // orphelin (cf. docs/BOUTIQUE_ARCHITECTURE_LIVE.md), n'existe plus dans le
  // build. Provoquait "Refused to apply style ... MIME type 'text/html'" car
  // le serveur renvoyait l'index HTML en fallback SPA.

  // NOTE: b-cart-groups-tab.js retiré — setupCartGroupsTab() est vide (legacy désactivé).
  // Le flux Groupe officiel vit dans group/group-render-list.js + group/group-api.js.

  // Desktop : la petite dame doit toujours ouvrir un vrai panier,
  // même dans Favoris/Suivi où le side-cart peut être invisible.
  import('./b-desktop-global-cart-access.js')
    .then(function(mod) {
      if (mod && typeof mod.setupDesktopGlobalCartAccess === 'function') {
        mod.setupDesktopGlobalCartAccess();
      }
    })
    .catch(function(err) {
      console.warn('[desktop-cart-access] chargement impossible', err);
    });
}
