/**
 * b-pager.js — Navigation catégories mobile (Temu-style)
 *
 * Implémentation fidèle à l'ancienne boutique :
 * - Swipe horizontal sur la grille → change de catégorie
 * - Animation slide-out/slide-in sur la grille (translateX CSS classes)
 * - Chip s'allume immédiatement au swipe
 * - Scroll vertical dans chaque catégorie : natif (pas de pager)
 * - Auto-advance bas de page → catégorie suivante
 *
 * Pas de scroll-snap, pas de position:fixed, pas de translateX custom.
 * Juste des classes CSS d'animation + renderGrid() comme avant.
 */

import { bus }    from './b-bus.js';
import { scroll } from './b-store.js';

'use strict';

// ── Swipe horizontal → change catégorie ──────────────────────────
function _setupMobilePager() {
  if (window.innerWidth >= 900) return;
  _setupCatalogSwipeNav();
}

function _setupCatalogSwipeNav() {
  if (window.innerWidth >= 900) return;

  var startX = 0, startY = 0, startT = 0;
  var tracking = false;
  var SWIPE_MIN_DIST     = 45;
  var SWIPE_MAX_VERTICAL = 80;
  var SWIPE_MAX_DURATION = 900;

  // Nettoyer les anciens listeners
  document.removeEventListener('touchstart', document._pagerTouchStart, true);
  document.removeEventListener('touchend',   document._pagerTouchEnd,   true);

  document._pagerTouchStart = function(e) {
    if (e.touches.length !== 1) { tracking = false; return; }
    var t = e.target;
    // Ignorer les zones qui ont leur propre scroll/interaction
    if (t.closest &&  t.closest(
      '.k-cats, .k-subcats-rail, .k-header, .k-modal-overlay, .k-modal,' +
      '.k-cart-drawer, .k-cart-overlay, .k-bnav, .k-wa-fab,' +
      '.k-card-fav, .k-card-add, .k-card-tab,' +
      '.k-promo-rail, .k-promo-card,' +
      '.k-sug-rail, .k-modal-carousel,' +
      'input, textarea, select, button'
    )) { tracking = false; return; }
    // Seulement sur la zone catalogue
    if (t.closest && !t.closest('#k-page-scroll, #k-catalog-section, .k-grid, .k-card, .k-section, .k-cat-section')) {
      tracking = false; return;
    }
    startX    = e.touches[0].clientX;
    startY    = e.touches[0].clientY;
    startT    = Date.now();
    tracking  = true;
  };

  document._pagerTouchEnd = function(e) {
    if (!tracking) return;
    tracking = false;
    var touch = e.changedTouches[0];
    if (!touch) return;
    var dx = touch.clientX - startX;
    var dy = touch.clientY - startY;
    var dt = Date.now() - startT;

    if (dt > SWIPE_MAX_DURATION)               return;
    if (Math.abs(dy) > SWIPE_MAX_VERTICAL)     return;
    if (Math.abs(dx) < SWIPE_MIN_DIST)         return;
    if (Math.abs(dx) < Math.abs(dy) * 1.2)    return;

    // Trouver la chip active et la chip suivante/précédente
    var chips = Array.from(document.querySelectorAll('#k-cats .k-chip'));
    if (chips.length < 2) return;
    var currentIdx = chips.findIndex(function(c) { return c.classList.contains('active'); });
    if (currentIdx === -1) currentIdx = 0;
    var nextIdx = dx < 0 ? currentIdx + 1 : currentIdx - 1;
    if (nextIdx < 0 || nextIdx >= chips.length) return;

    // Émettre le swipe vers le chip — b-catalog.js gérera l'animation + renderGrid
    var swipeDir = dx < 0 ? -1 : 1;
    bus.emit('pager:swipe', { chip: chips[nextIdx], dir: swipeDir });
  };

  document.addEventListener('touchstart', document._pagerTouchStart, { passive: true, capture: true });
  document.addEventListener('touchend',   document._pagerTouchEnd,   { passive: true, capture: true });
}

// ── Auto-advance bas → catégorie suivante ─────────────────────────
function _setupSectionAutoAdvance() {
  // En mode slide simple, l'auto-advance se fait via scroll de window/page-scroll
  var pageScroll = document.getElementById('k-page-scroll') || window;
  var _lastST = 0, _wasDown = false, _timer = null;

  function _scrollTop() {
    var ps = document.getElementById('k-page-scroll');
    return ps ? ps.scrollTop : window.scrollY;
  }
  function _scrollHeight() {
    var ps = document.getElementById('k-page-scroll');
    return ps ? ps.scrollHeight : document.body.scrollHeight;
  }
  function _clientHeight() {
    var ps = document.getElementById('k-page-scroll');
    return ps ? ps.clientHeight : window.innerHeight;
  }
  function _atBottom() {
    return _scrollTop() + _clientHeight() >= _scrollHeight() - 48;
  }

  function onScroll() {
    var st = _scrollTop();
    if (st > _lastST + 2)      _wasDown = true;
    else if (st < _lastST - 8) _wasDown = false;
    _lastST = st;
    if (_wasDown && _atBottom()) {
      clearTimeout(_timer);
      _timer = setTimeout(function() {
        if (!_wasDown || !_atBottom()) return;
        var chips = Array.from(document.querySelectorAll('#k-cats .k-chip'));
        var idx   = chips.findIndex(function(c) { return c.classList.contains('active'); });
        if (idx === -1) return;
        var nextIdx = idx + 1 >= chips.length ? 0 : idx + 1;
        bus.emit('pager:swipe', { chip: chips[nextIdx], dir: -1 });
      }, 350);
    }
  }

  var ps = document.getElementById('k-page-scroll');
  if (ps) {
    ps.removeEventListener('scroll', ps._pagerScroll);
    ps._pagerScroll = onScroll;
    ps.addEventListener('scroll', onScroll, { passive: true });
  } else {
    window.removeEventListener('scroll', window._pagerScroll);
    window._pagerScroll = onScroll;
    window.addEventListener('scroll', onScroll, { passive: true });
  }
}

// ── Stubs compatibilité (appelés par b-catalog.js) ───────────────
function _setupInfiniteLoop()   { /* géré par ghost dans b-catalog */ }
function _setupHorizontalWrap() { /* géré par swipeNav */ }
function _syncChipToScroll()    { /* non utilisé */ }
function _onPagerScroll()       { /* non utilisé */ }
function _setupPagerDots()      { /* optionnel */ }
function _reshuffleToutInDOM()  {
  var toutSec = document.querySelector('.k-grid');
  if (!toutSec) return;
  var cards = Array.from(toutSec.children);
  for (var i = cards.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var t = cards[i]; cards[i] = cards[j]; cards[j] = t;
  }
  var frag = document.createDocumentFragment();
  cards.forEach(function(c) { frag.appendChild(c); });
  toutSec.appendChild(frag);
}

function _scrollPagerToCat(cat) {
  var chips = Array.from(document.querySelectorAll('#k-cats .k-chip'));
  var chip  = chips.find(function(c) { return c.dataset.cat === cat; });
  if (chip && !chip.classList.contains('active')) chip.click();
}
function _scrollPagerToGhost() {
  var allChip = document.querySelector('.k-chip[data-cat="all"]');
  if (allChip) allChip.click();
}

/**
 * Cleanup complet du pager principal catégories.
 * À appeler AVANT d'activer le mode flat subcat.
 */
function destroyMobilePager() {
  // Retirer les listeners touchstart/touchend du document
  if (document._pagerTouchStart) {
    document.removeEventListener('touchstart', document._pagerTouchStart, true);
    document._pagerTouchStart = null;
  }
  if (document._pagerTouchEnd) {
    document.removeEventListener('touchend', document._pagerTouchEnd, true);
    document._pagerTouchEnd = null;
  }
  // Retirer le listener scroll de l'auto-advance
  var ps = document.getElementById('k-page-scroll');
  if (ps && ps._pagerScroll) {
    ps.removeEventListener('scroll', ps._pagerScroll);
    ps._pagerScroll = null;
  }
  if (window._pagerScroll) {
    window.removeEventListener('scroll', window._pagerScroll);
    window._pagerScroll = null;
  }
  // Retirer les styles inline du pager sur #k-grid (translateX résiduel, etc.)
  var grid = document.getElementById('k-grid');
  if (grid) {
    grid.style.transform   = '';
    grid.style.transition  = '';
    grid.style.width       = '';
    grid.style.height      = '';
    grid.style.position    = '';
    grid.style.overflow    = '';
    grid.style.willChange  = '';
    grid.style.display     = '';
    // Supprimer les dots
    grid.querySelectorAll('.k-pager-dots').forEach(function(d) { d.remove(); });
  }
  // Retirer k-pager-active si présent
  var pageScroll = document.getElementById('k-page-scroll');
  if (pageScroll) {
    pageScroll.classList.remove('k-pager-active');
    pageScroll.style.overflow = '';
    pageScroll.style.height   = '';
  }
}

export {
  _setupMobilePager,
  _setupSectionAutoAdvance,
  _setupHorizontalWrap,
  _syncChipToScroll,
  _onPagerScroll,
  _scrollPagerToCat,
  _scrollPagerToGhost,
  _reshuffleToutInDOM,
  _setupInfiniteLoop,
  _setupPagerDots,
  destroyMobilePager,
};
