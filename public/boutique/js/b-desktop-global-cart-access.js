/**
 * @komerce-arch-lite
 * @role          boutique-b-desktop-global-cart-access
 * @domain        catalog
 * @layer         ui-component
 * @owner         public/boutique/js/b-catalog.js
 * @purpose       supports public/boutique/js/b-catalog.js
 * @impact-areas  boutique
 * @version       2026-06
 */
'use strict';

/**
 * @module b-desktop-global-cart-access
 * @brief Sur desktop, la petite dame reste l'accès global au vrai panier.
 *
 * Mobile : pas de pilule/petite dame flottante. Le panier mobile passe par
 * la bottom nav, qui est plus claire et ne parasite pas le catalogue.
 *
 * Si le side-cart n'est pas réellement visible dans la vue courante
 * (favoris, suivi, groupes, etc.), on force le drawer panier comme fallback.
 */

let installed = false;

function isDesktopViewport() {
  return window.matchMedia && window.matchMedia('(min-width: 900px)').matches;
}

function applyMobileCartAccessVisibility() {
  const cartBtn = document.getElementById('k-cart-btn');
  if (!cartBtn) return;

  // L'avatar header est toujours visible (mobile et desktop).
  // hero-cart-proxy.css gère la visibilité via CSS — on ne masque jamais
  // le bouton en JS pour ne pas écraser les règles CSS avec un style inline.
  cartBtn.style.removeProperty('display');
  cartBtn.removeAttribute('aria-hidden');
  cartBtn.removeAttribute('tabindex');
}

function isVisible(el) {
  if (!el) return false;
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
  const rect = el.getBoundingClientRect();
  if (rect.width < 8 || rect.height < 8) return false;
  return rect.bottom > 0 && rect.right > 0 && rect.top < window.innerHeight && rect.left < window.innerWidth;
}

function isCartTrigger(target) {
  return Boolean(target.closest('#k-cart-btn, #k-modal-cart-btn'));
}

function openDrawerFallback() {
  // FIX scroll bloqué : si le panier est VIDE, ne pas ouvrir le drawer.
  // checkoutCart() a déjà affiché le toast « Votre panier est vide » et s'est
  // arrêté. Sans ce garde-fou, le fallback ouvrait quand même overlay + drawer
  // + body.cart-open pour un panier vide → l'overlay restait posé par-dessus la
  // page et captait le scroll (molette/tactile KO, seul l'ascenseur marchait).
  const cartBtn = document.getElementById('k-cart-btn');
  if (cartBtn && cartBtn.classList.contains('is-empty')) return;

  const overlay = document.getElementById('k-cart-overlay');
  const drawer = document.getElementById('k-cart-drawer');
  if (!overlay || !drawer) return;

  overlay.classList.add('open');
  drawer.classList.add('open');
  document.body.classList.add('cart-open');
}

function onCartClick(e) {
  if (!isCartTrigger(e.target)) return;
  if (!isDesktopViewport()) return;

  // Laisser le handler historique faire son travail d'abord : renderCartBody,
  // badge, tentative side-cart. Puis corriger seulement si le side-cart n'est
  // pas une cible visible dans la vue actuelle.
  setTimeout(function() {
    const sideCart = document.getElementById('k-side-cart');
    if (isVisible(sideCart)) return;
    openDrawerFallback();
  }, 0);
}

export function setupDesktopGlobalCartAccess() {
  if (installed) return;
  installed = true;

  applyMobileCartAccessVisibility();
  window.addEventListener('resize', applyMobileCartAccessVisibility);
  window.addEventListener('orientationchange', applyMobileCartAccessVisibility);

  document.addEventListener('click', onCartClick, false);
}
