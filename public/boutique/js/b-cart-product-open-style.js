/**
 * @module b-cart-product-open-style
 * @brief Charge l'affordance visuelle des images produit cliquables dans le panier.
 */

export function setupCartProductOpenStyle() {
  if (document.getElementById('kmrc-cart-product-image-affordance-css')) return;

  const link = document.createElement('link');
  link.id = 'kmrc-cart-product-image-affordance-css';
  link.rel = 'stylesheet';
  link.href = '/boutique/css/cart-product-open.css?v=1';
  document.head.appendChild(link);
}
