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
}
