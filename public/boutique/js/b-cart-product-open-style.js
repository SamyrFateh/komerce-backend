/**
 * @module b-cart-product-open-style
 * @brief Charge les modules UX légers branchés au boot boutique.
 */

export function setupCartProductOpenStyle() {
  // NOTE 2026-05-19 : injection de cart-product-open.css retirée — fichier
  // orphelin (cf. docs/BOUTIQUE_ARCHITECTURE_LIVE.md), n'existe plus dans le
  // build. Provoquait "Refused to apply style ... MIME type 'text/html'" car
  // le serveur renvoyait l'index HTML en fallback SPA.

  if (!document.getElementById('kmrc-shared-followup-css')) {
    const link = document.createElement('link');
    link.id = 'kmrc-shared-followup-css';
    link.rel = 'stylesheet';
    link.href = '/boutique/css/shared-followup.css?v=1';
    document.head.appendChild(link);
  }

  // Compatibilité lien public court /g/:token → /event/w/:token.
  import('./b-friendly-group-redirect.js')
    .then(function(mod) {
      if (mod && typeof mod.setupFriendlyGroupRedirect === 'function') {
        mod.setupFriendlyGroupRedirect();
      }
    })
    .catch(function(err) {
      console.warn('[friendly-group-link] chargement impossible', err);
    });

  // Bootstrap opportuniste de l'onglet Mes paniers partagés sans alourdir main.js.
  import('./b-cart-groups-tab.js')
    .then(function(mod) {
      if (mod && typeof mod.setupCartGroupsTab === 'function') {
        mod.setupCartGroupsTab();
      }
    })
    .catch(function(err) {
      console.warn('[cart-groups] chargement impossible', err);
    });

  // Bootstrap du flux simplifié "Payer à plusieurs".
  import('./b-group-cart-flow.js')
    .then(function(mod) {
      if (mod && typeof mod.setupGroupCartFlow === 'function') {
        mod.setupGroupCartFlow();
      }
    })
    .catch(function(err) {
      console.warn('[group-cart-flow] chargement impossible', err);
    });

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
