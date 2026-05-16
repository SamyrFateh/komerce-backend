/**
 * b-scroll-owner.js — Source de vérité du scroll boutique
 *
 * Desktop:
 *   - le document/window est le scroller principal
 *   - #k-page-scroll reste un wrapper de contenu
 *
 * Mobile:
 *   - le pager Temu peut utiliser #k-page-scroll.k-pager-active
 */

'use strict';

export const DESKTOP_BREAKPOINT = 900;

export function isDesktop() {
  return window.innerWidth >= DESKTOP_BREAKPOINT;
}

export function clearInlinePagerStyles(el) {
  if (!el) return;
  [
    'position',
    'top',
    'left',
    'right',
    'bottom',
    'width',
    'height',
    'maxWidth',
    'overflow',
    'overflowX',
    'overflowY',
    'transform',
    'transition'
  ].forEach(function(prop) {
    el.style[prop] = '';
  });
}

export function ensureDesktopScrollOwner() {
  if (!isDesktop()) return;

  var ps = document.getElementById('k-page-scroll');
  var grid = document.getElementById('k-grid');

  if (ps) {
    ps.classList.remove('k-pager-active');
    clearInlinePagerStyles(ps);
  }

  if (grid) {
    grid.classList.remove('k-grid-cat-pager', 'k-grid-flat-subcat');
    clearInlinePagerStyles(grid);
  }

  document.documentElement.style.removeProperty('--pager-top');
  document.documentElement.style.removeProperty('--pager-h');
  document.documentElement.style.removeProperty('--pager-w');
  document.documentElement.style.removeProperty('--bnav-h');

  // Guard rAF : le pager peut réécrire des styles inline de façon asynchrone
  // juste après ce cleanup synchrone (race condition au resize/transition de tab).
  // On repasse un second nettoyage au frame suivant pour s'assurer que
  // #k-page-scroll ne redevient pas scroll container et ne casse pas le sticky
  // du side cart. Mobile non concerné (guard isDesktop() en entrée).
  requestAnimationFrame(function() {
    if (!isDesktop()) return;
    var ps2 = document.getElementById('k-page-scroll');
    var grid2 = document.getElementById('k-grid');
    if (ps2) clearInlinePagerStyles(ps2);
    if (grid2) clearInlinePagerStyles(grid2);
  });
}

/**
 * getScrollY() — valeur unifiée du scroll vertical
 * Mobile : lit #k-page-scroll.scrollTop (container fixe)
 * Desktop : lit window.scrollY natif
 * À utiliser à la place de window.scrollY dans tous les modules.
 */
export function getScrollY() {
  if (isDesktop()) return window.scrollY;
  var ps = document.getElementById('k-page-scroll');
  return ps ? ps.scrollTop : 0;
}

/**
 * scrollToPosition(top, behavior?) — scroll vers une position absolue
 * Mobile : scrolle #k-page-scroll
 * Desktop : scrolle window
 * Remplace window.scrollTo(0, y) et window.scrollTo({ top:y }) dans les modules.
 */
export function scrollToPosition(top, behavior = 'auto') {
  if (isDesktop()) {
    window.scrollTo({ top, behavior });
    return;
  }
  var ps = document.getElementById('k-page-scroll');
  if (ps) ps.scrollTo({ top, behavior });
  else window.scrollTo({ top, behavior });
}

export function scrollPageToTop(behavior = 'smooth') {
  if (isDesktop()) {
    window.scrollTo({ top: 0, behavior });
    return;
  }

  var ps = document.getElementById('k-page-scroll');
  if (ps) ps.scrollTo({ top: 0, behavior });
  else window.scrollTo({ top: 0, behavior });
}

export function scrollPageToElement(el, offset = 0, behavior = 'smooth') {
  if (!el) return;

  if (isDesktop()) {
    var top = el.getBoundingClientRect().top + window.scrollY + offset;
    window.scrollTo({ top: Math.max(0, top), behavior });
    return;
  }

  var ps = document.getElementById('k-page-scroll');
  if (ps && ps.contains(el)) {
    var psRect = ps.getBoundingClientRect();
    var elRect = el.getBoundingClientRect();
    var localTop = elRect.top - psRect.top + ps.scrollTop + offset;
    ps.scrollTo({ top: Math.max(0, localTop), behavior });
  } else {
    el.scrollIntoView({ behavior, block: 'start' });
  }
}

let installed = false;

export function installScrollOwner() {
  if (installed) return;
  installed = true;

  ensureDesktopScrollOwner();

  window.addEventListener('resize', function() {
    ensureDesktopScrollOwner();
  });

  // Desktop wheel owner:
  // Redirige la molette tombant dans #k-page-scroll vers le document scroller.
  // FIX audit: passive: true (ne bloque plus le thread de rendu),
  // plus de preventDefault(), plus de multiplicateur ×2.35 qui rendait
  // le scroll nerveux et ignorait les préférences OS de l'utilisateur.
  window.addEventListener('wheel', function(e) {
    if (!isDesktop()) return;
    if (document.body.classList.contains('modal-open')) return;
    if (document.body.classList.contains('cart-open')) return;

    var target = e.target;
    if (!target || !target.closest) return;

    if (target.closest('.k-modal, .k-cart-drawer, .k-search-dropdown, .k-modal-search-dropdown, .k-desktop-sidebar')) {
      return;
    }

    // Side cart déployé : il a son propre scroll interne (.k-sc-items overflow-y:auto).
    // Ne pas rediriger la molette vers window — ça scrollerait le catalogue en même temps.
    var sideCart = document.getElementById('k-side-cart');
    if (sideCart && sideCart.classList.contains('is-expanded') && target.closest('#k-side-cart')) {
      return;
    }

    // Ne pas intercepter la molette sur les rails de chips (scroll horizontal natif)
    if (target.closest('.k-cats-shell, .k-subcats-wrap, #k-subcats-wrap, .k-sec-subcats')) {
      return;
    }

    var ps = document.getElementById('k-page-scroll');
    if (!ps || !ps.contains(target)) return;

    var maxScroll = document.documentElement.scrollHeight - document.documentElement.clientHeight;
    if (maxScroll <= 0) return;

    // Scroll natif : on respecte le deltaY du navigateur tel quel
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerHeight : 1;
    window.scrollBy({ top: e.deltaY * unit, left: 0, behavior: 'auto' });
  }, { passive: true });
}
