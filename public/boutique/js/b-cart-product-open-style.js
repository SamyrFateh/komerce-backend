/**
 * @module b-cart-product-open-style
 * @brief Charge l'affordance visuelle des images produit cliquables dans le panier.
 */

export function setupCartProductOpenStyle() {
  if (!document.getElementById('kmrc-cart-product-image-affordance-css')) {
    const link = document.createElement('link');
    link.id = 'kmrc-cart-product-image-affordance-css';
    link.rel = 'stylesheet';
    link.href = '/boutique/css/cart-product-open.css?v=1';
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

  // Bootstrap opportuniste de l'onglet Mes groupes sans alourdir main.js.
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
