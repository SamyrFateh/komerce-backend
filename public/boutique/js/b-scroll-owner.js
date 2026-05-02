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

function isDesktop() {
  return window.innerWidth >= 900;
}

function clearInlinePagerStyles(el) {
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
  // Si la molette tombe dans le wrapper boutique, on pilote le document.
  // Cela évite le conflit historique où #k-page-scroll recevait la molette
  // alors qu'il n'est plus le scroller desktop.
  window.addEventListener('wheel', function(e) {
    if (!isDesktop()) return;
    if (document.body.classList.contains('modal-open')) return;
    if (document.body.classList.contains('cart-open')) return;

    var target = e.target;
    if (!target || !target.closest) return;

    if (target.closest('.k-modal, .k-cart-drawer, .k-search-dropdown, .k-modal-search-dropdown, .k-desktop-sidebar')) {
      return;
    }

    var ps = document.getElementById('k-page-scroll');
    if (!ps || !ps.contains(target)) return;

    var maxScroll = document.documentElement.scrollHeight - document.documentElement.clientHeight;
    if (maxScroll <= 0) return;

    e.preventDefault();

    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerHeight : 1;
    const speed = 2.35;
    window.scrollBy({ top: e.deltaY * unit * speed, left: 0, behavior: 'auto' });
  }, { passive: false });
}
