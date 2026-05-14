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

  if (isDesktopViewport()) {
    cartBtn.style.removeProperty('display');
    cartBtn.removeAttribute('aria-hidden');
    cartBtn.removeAttribute('tabindex');
    return;
  }

  cartBtn.style.display = 'none';
  cartBtn.setAttribute('aria-hidden', 'true');
  cartBtn.setAttribute('tabindex', '-1');
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
