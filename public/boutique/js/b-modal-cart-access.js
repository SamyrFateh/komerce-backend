/**
 * @komerce-arch-lite
 * @role          modal-integrated-cart-access
 * @domain        shared-cart-modal
 * @layer         ui-component
 * @owner         public/boutique/js/b-modal-core.js
 * @purpose       Rendre perceptible et accessible le ciblage du side-cart déjà intégré au PDP desktop.
 * @impact-areas  product-modal, side-cart, accessibility
 * @version       2026-08
 */
'use strict';

/**
 * Le panier est déjà ouvert dans la modal desktop. Son bouton central ne doit
 * donc ni fermer la fiche, ni ouvrir le drawer mobile : il cible la surface
 * existante, lui donne le focus et rejoue son signal visuel.
 */
export function focusIntegratedSideCart(sideCart) {
  sideCart.scrollIntoView({
    behavior: 'smooth',
    block: 'nearest',
    inline: 'nearest',
  });
  sideCart.setAttribute('tabindex', '-1');
  sideCart.focus({ preventScroll: true });
  sideCart.classList.remove('is-attention');
  void sideCart.offsetWidth;
  sideCart.classList.add('is-attention');
}
