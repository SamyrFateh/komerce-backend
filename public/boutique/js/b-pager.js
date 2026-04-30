/**
 * b-pager.js — Pager horizontal catégories principales mobile
 *
 * Moteur : scroll natif CSS scroll-snap sur #k-grid.k-grid-cat-pager
 * Sync   : listener scroll passif → _syncCatFromScroll (index-based)
 * Nav    : _scrollPagerToCat depuis chip click ou home-controller
 *
 * Règles :
 * - Jamais actif en même temps que b-subcat.js (k-grid-flat-subcat)
 * - Jamais actif quand state.modalOpen
 * - destroyMobilePager() nettoyage complet avant flatSubcat
 */

import { bus }           from './b-bus.js';
import { state, scroll } from './b-store.js';

'use strict';

// ── Helpers ──────────────────────────────────────────────────────

function _getPagerPages(grid) {
  return Array.from(grid.querySelectorAll(':scope > .k-cat-section'));
}

function _getCurrentPagerIndex(grid) {
  var w = window.innerWidth;
  return Math.max(0, Math.round(grid.scrollLeft / w));
}

function _getCatByIndex(grid, index) {
  var pages = _getPagerPages(grid);
  var page = pages[index];
  return page ? page.dataset.cat : null;
}

function _syncActiveChip(cat) {
  state.activeCat    = cat;
  state.activeSubcat = null;

  var chips = Array.from(document.querySelectorAll('#k-cats .k-chip'));
  var activeChip = null;

  chips.forEach(function(chip) {
    var on = chip.dataset.cat === cat;
    chip.classList.toggle('active', on);
    if (on) activeChip = chip;
  });

  if (activeChip) bus.emit('chip:center', activeChip);
}

function _scrollPagerToIndex(index, behavior) {
  var grid = document.getElementById('k-grid');
  if (!grid || window.innerWidth >= 900) return;
  if (grid.classList.contains('k-grid-flat-subcat')) return;

  var pages = _getPagerPages(grid);
  if (!pages.length) return;

  var safeIndex = Math.max(0, Math.min(index, pages.length - 1));
  var left = safeIndex * window.innerWidth;

  grid.scrollTo({
    left: left,
    behavior: behavior || 'smooth'
  });

  var cat = pages[safeIndex].dataset.cat;
  if (cat) _syncActiveChip(cat);
}

function _scrollPagerToCat(cat, behavior) {
  var grid = document.getElementById('k-grid');
  if (!grid || window.innerWidth >= 900) return;
  if (grid.classList.contains('k-grid-flat-subcat')) return;

  var pages = _getPagerPages(grid);
  var index = pages.findIndex(function(page) {
    return page.dataset.cat === cat;
  });

  if (index < 0) return;
  _scrollPagerToIndex(index, behavior || 'smooth');
}

function _syncCatFromScroll() {
  var grid = document.getElementById('k-grid');
  if (!grid || grid.classList.contains('k-grid-flat-subcat')) return;

  var index = _getCurrentPagerIndex(grid);
  var cat = _getCatByIndex(grid, index);

  if (cat) _syncActiveChip(cat);
}

// ── Setup principal ───────────────────────────────────────────────

function _setupMobilePager() {
  if (window.innerWidth >= 900) return;
  var grid = document.getElementById('k-grid');
  if (!grid) return;
  if (grid.classList.contains('k-grid-flat-subcat')) return;
  grid.classList.add('k-grid-cat-pager');

  // Calculer et activer la cage du pager mobile
var ps = document.getElementById('k-page-scroll');
var bnav = document.querySelector('.k-bnav');
var bnavH = bnav ? bnav.offsetHeight : 56;

var gridRect = grid.getBoundingClientRect();
var pagerTop = Math.max(0, Math.round(gridRect.top));
var pagerH = window.innerHeight - pagerTop - bnavH;

if (pagerH < 300) pagerH = 300;

document.documentElement.style.setProperty('--pager-top', pagerTop + 'px');
document.documentElement.style.setProperty('--pager-h', pagerH + 'px');
document.documentElement.style.setProperty('--pager-w', window.innerWidth + 'px');

if (ps) {
  ps.classList.add('k-pager-active');
  ps.style.left = '0';
  ps.style.right = '0';
  ps.style.top = pagerTop + 'px';
  ps.style.bottom = 'calc(var(--bnav-h) + env(safe-area-inset-bottom, 0px))';
  ps.style.width = '100vw';
}

  // Listener scroll passif — sync chips au scroll natif
  if (grid._catPagerScrollHandler) {
    grid.removeEventListener('scroll', grid._catPagerScrollHandler);
  }
  var raf = null;
  grid._catPagerScrollHandler = function() {
    if (state.modalOpen) return;
    if (raf) cancelAnimationFrame(raf);
    raf = requestAnimationFrame(_syncCatFromScroll);
  };
  grid.addEventListener('scroll', grid._catPagerScrollHandler, { passive: true });

  // Resize
window.removeEventListener('resize', _setupMobilePager);
window.removeEventListener('orientationchange', _setupMobilePager);
window.addEventListener('orientationchange', _setupMobilePager);
}

// ── Auto-advance bas → catégorie suivante ─────────────────────────

function _setupSectionAutoAdvance() {
  // Désactivé temporairement — réactiver quand le pager est stable
}

// ── Destroy ───────────────────────────────────────────────────────

function destroyMobilePager() {
  var grid = document.getElementById('k-grid');
  if (grid) {
    if (grid._catPagerScrollHandler) {
      grid.removeEventListener('scroll', grid._catPagerScrollHandler);
      grid._catPagerScrollHandler = null;
    }
    grid.classList.remove('k-grid-cat-pager');
    grid.style.transform  = '';
    grid.style.transition = '';
    grid.style.width      = '';
    grid.style.height     = '';
    grid.style.position   = '';
    grid.style.overflow   = '';
    grid.style.willChange = '';
    grid.style.display    = '';
    grid.querySelectorAll('.k-pager-dots').forEach(function(d) { d.remove(); });
  }
  var ps = document.getElementById('k-page-scroll');
  if (ps) {
  ps.classList.remove('k-pager-active');
  ps.style.left = '';
  ps.style.right = '';
  ps.style.top = '';
  ps.style.bottom = '';
  ps.style.width = '';
}
  window.removeEventListener('resize', _setupMobilePager);
  window.removeEventListener('orientationchange', _setupMobilePager);
  document.documentElement.style.removeProperty('--pager-top');
  document.documentElement.style.removeProperty('--pager-h');
  document.documentElement.style.removeProperty('--pager-w');
}

// ── Stubs compatibilité ───────────────────────────────────────────
function _setupInfiniteLoop()   { }
function _setupHorizontalWrap() { }
function _syncChipToScroll()    { _syncCatFromScroll(); }
function _onPagerScroll()       { }
function _setupPagerDots()      { }
function _reshuffleToutInDOM()  {
  var grid = document.getElementById('k-grid');
  if (!grid) return;
  var sec = grid.querySelector('.k-cat-section[data-cat="all"]');
  if (!sec) return;
  var secGrid = sec.querySelector('.k-sec-grid');
  if (!secGrid) return;
  var cards = Array.from(secGrid.children);
  for (var i = cards.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var t = cards[i]; cards[i] = cards[j]; cards[j] = t;
  }
  var frag = document.createDocumentFragment();
  cards.forEach(function(c) { frag.appendChild(c); });
  secGrid.appendChild(frag);
}
function _scrollPagerToGhost() {
  _scrollPagerToCat('all', 'smooth');
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
