/**
 * @komerce-arch
 * @role          boutique-scroll-owner
 * @domain        boutique
 * @layer         ui-infrastructure
 * @criticality   high
 * @inputs        viewport, page_scroll, modal_state, desktop_state
 * @outputs       scroll_positions, ownership_guards, layout_resets
 * @depends       DOM
 * @used-by       b-catalog.js, b-subcat.js, b-nav.js, b-cart.js, modal-modules, desktop-enhancers
 * @doctrine      scroll_owner_unique, mobile_desktop_coherence, modal_produit_sans_chevauchement
 * @impact-areas  responsive-layout, modal, category-navigation, side-cart-layout
 * @version       2026-06
 */
'use strict';

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

const DESKTOP_BREAKPOINT = 900;

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

  let ps = document.getElementById('k-page-scroll');
  let grid = document.getElementById('k-grid');

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
    let ps2 = document.getElementById('k-page-scroll');
    let grid2 = document.getElementById('k-grid');
    if (ps2) clearInlinePagerStyles(ps2);
    if (grid2) clearInlinePagerStyles(grid2);
  });
}

/**
 * getMobileScrollContainer() — qui scrolle en MOBILE ?
 * FIX AUDIT 2026-06-11 : hors pager, #k-page-scroll n'est PAS le scroller.
 * - Pager Temu actif (#k-page-scroll.k-pager-active, vue Boutique) :
 *   le conteneur fixe est le scroller → on le retourne.
 * - Onglets Groupe / Suivi / Favoris (pager détruit par switchView) :
 *   #k-page-scroll est static sans hauteur contrainte → c'est WINDOW qui
 *   scrolle. Scroller ps était un no-op : le scroll window hérité n'était
 *   jamais remis à zéro (atterrissage "dans le vide" en bas de la nouvelle
 *   vue) et getScrollY() mentait (0 permanent) à tous les modules.
 * @returns {HTMLElement|null} le conteneur, ou null si window est le scroller
 */
export function getMobileScrollContainer() {
  let ps = document.getElementById('k-page-scroll');
  return (ps && ps.classList.contains('k-pager-active')) ? ps : null;
}

/**
 * getScrollY() — valeur unifiée du scroll vertical Mobile : pager actif → #k-page-scroll.scrollTop ; sinon → window.scrollY
 * Desktop : window.scrollY natif
 * À utiliser à la place de window.scrollY dans tous les modules.
 */
export function getScrollY() {
  if (isDesktop()) return window.scrollY;
  let c = getMobileScrollContainer();
  return c ? c.scrollTop : window.scrollY;
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
  let c = getMobileScrollContainer();
  if (c) c.scrollTo({ top, behavior });
  else window.scrollTo({ top, behavior });
}

export function scrollPageToTop(behavior = 'smooth') {
  if (isDesktop()) {
    window.scrollTo({ top: 0, behavior });
    return;
  }

  let c = getMobileScrollContainer();
  if (c) c.scrollTo({ top: 0, behavior });
  // Toujours remettre window à zéro aussi : en sortie de pager, un scroll
  // window résiduel peut exister (clavier, focus, restauration navigateur).
  window.scrollTo({ top: 0, behavior });
}

export function scrollPageToElement(el, offset = 0, behavior = 'smooth') {
  if (!el) return;

  if (isDesktop()) {
    let top = el.getBoundingClientRect().top + window.scrollY + offset;
    window.scrollTo({ top: Math.max(0, top), behavior });
    return;
  }

  let c = getMobileScrollContainer();
  if (c && c.contains(el)) {
    let cRect = c.getBoundingClientRect();
    let elRect = el.getBoundingClientRect();
    let localTop = elRect.top - cRect.top + c.scrollTop + offset;
    c.scrollTo({ top: Math.max(0, localTop), behavior });
  } else {
    // Hors pager : window est le scroller (mêmes maths que desktop)
    let top2 = el.getBoundingClientRect().top + window.scrollY + offset;
    window.scrollTo({ top: Math.max(0, top2), behavior });
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

    let target = e.target;
    if (!target || !target.closest) return;

    if (target.closest('.k-modal, .k-cart-drawer, .k-search-dropdown, .k-desktop-sidebar')) {
      return;
    }

    // Side cart : il a son propre scroll interne (.k-sc-items overflow-y:auto).
    // Ne pas rediriger la molette vers window — ça scrollerait le catalogue en même temps.
    // NOTE : la condition `is-expanded` a été retirée (refactor 21/05/2026 — pattern Temu
    // full-height, is-expanded n'est plus jamais posé). Le guard couvre désormais tous
    // les états du side cart, pas seulement quand il était "déployé".
    if (target.closest('#k-side-cart')) {
      return;
    }

    // Ne pas intercepter la molette sur les rails de chips (scroll horizontal natif)
    if (target.closest('.k-cats-shell, .k-subcats-wrap, #k-subcats-wrap, .k-sec-subcats')) {
      return;
    }

    let ps = document.getElementById('k-page-scroll');
    if (!ps || !ps.contains(target)) return;

    let maxScroll = document.documentElement.scrollHeight - document.documentElement.clientHeight;
    if (maxScroll <= 0) return;

    // Scroll natif : on respecte le deltaY du navigateur tel quel
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerHeight : 1;
    window.scrollBy({ top: e.deltaY * unit, left: 0, behavior: 'auto' });
  }, { passive: true });
}
