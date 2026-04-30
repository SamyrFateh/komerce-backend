/**
 * b-pager.js — Pager horizontal catégories principales mobile
 *
 * Moteur : #k-grid = rail flex horizontal, scroll-snap natif CSS
 * Pages  : chaque .k-cat-section = 100vw × --pager-h
 * Sync   : scroll passif → chip active (index-based)
 * Nav    : chip click → scrollTo(index * clientWidth)
 *
 * Séparation stricte :
 * - Ce module = catégories principales (k-grid-cat-pager)
 * - b-subcat.js = sous-catégories (k-grid-flat-subcat)
 * - Jamais actifs ensemble
 */

import { bus }   from './b-bus.js';
import { state } from './b-store.js';

'use strict';

// ── Variables CSS de la cage ──────────────────────────────────────

function _recalcPagerVars() {
  const ps   = document.getElementById('k-page-scroll');
  const bnav = document.querySelector('.k-bnav');
  const wrap = document.getElementById('k-hero-fixed-wrap');

  const bnavH   = bnav ? bnav.offsetHeight : 56;
  const wrapH   = wrap ? wrap.offsetHeight : 180;
  const headerH = 44; // header fixe

  const pagerTop = wrapH + headerH;
  const pagerH   = window.innerHeight - pagerTop - bnavH;

  document.documentElement.style.setProperty('--pager-top', pagerTop + 'px');
  document.documentElement.style.setProperty('--pager-h',   Math.max(pagerH, 300) + 'px');
  document.documentElement.style.setProperty('--pager-w',   window.innerWidth + 'px');
  document.documentElement.style.setProperty('--bnav-h',    bnavH + 'px');

  // Forcer la cage fixe
  if (ps) {
    ps.style.left  = '0';
    ps.style.right = '0';
    ps.style.width = '100vw';
  }
}

// ── Helpers index-based ───────────────────────────────────────────

function _getPages() {
  const grid = document.getElementById('k-grid');
  if (!grid) return [];
  return Array.from(grid.querySelectorAll(':scope > .k-cat-section'));
}

function _getCurrentIndex() {
  const grid = document.getElementById('k-grid');
  if (!grid) return 0;
  const w = grid.clientWidth || window.innerWidth;
  return w > 0 ? Math.max(0, Math.round(grid.scrollLeft / w)) : 0;
}

function _syncChip(cat) {
  state.activeCat    = cat;
  state.activeSubcat = null;
  let activeChip = null;
  document.querySelectorAll('#k-cats .k-chip').forEach(chip => {
    const on = chip.dataset.cat === cat;
    chip.classList.toggle('active', on);
    if (on) activeChip = chip;
  });
  if (activeChip) bus.emit('chip:center', activeChip);
}

// ── Setup ─────────────────────────────────────────────────────────

function _setupMobilePager() {
  if (window.innerWidth >= 900) return;
  const grid = document.getElementById('k-grid');
  if (!grid) return;
  if (grid.classList.contains('k-grid-flat-subcat')) return;

  _recalcPagerVars();

  // Scroll listener — sync chip
  if (grid._pagerScrollH) grid.removeEventListener('scroll', grid._pagerScrollH);
  let raf = null;
  grid._pagerScrollH = () => {
    if (state.modalOpen) return;
    if (raf) cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      const idx = _getCurrentIndex();
      const cat = _getPages()[idx]?.dataset.cat;
      if (cat) _syncChip(cat);
    });
  };
  grid.addEventListener('scroll', grid._pagerScrollH, { passive: true });

  // Resize
  window.removeEventListener('resize', _setupMobilePager);
  window.addEventListener('resize', _setupMobilePager);
}

// ── Navigation externe (chip click) ──────────────────────────────

function _scrollPagerToCat(cat, behavior = 'smooth') {
  const grid = document.getElementById('k-grid');
  if (!grid || window.innerWidth >= 900) return;
  if (grid.classList.contains('k-grid-flat-subcat')) return;

  const pages = _getPages();
  const idx   = pages.findIndex(p => p.dataset.cat === cat);
  if (idx < 0) return;

  const w    = grid.clientWidth || window.innerWidth;
  const left = idx * w;
  grid.scrollTo({ left, behavior });

  // Fallback iOS
  setTimeout(() => {
    if (Math.abs(grid.scrollLeft - left) > 10) grid.scrollLeft = left;
  }, 150);

  _syncChip(cat);
}

function _scrollPagerToGhost() { _scrollPagerToCat('all'); }

// ── Destroy ───────────────────────────────────────────────────────

function destroyMobilePager() {
  const grid = document.getElementById('k-grid');
  if (grid) {
    if (grid._pagerScrollH) {
      grid.removeEventListener('scroll', grid._pagerScrollH);
      grid._pagerScrollH = null;
    }
    grid.classList.remove('k-grid-cat-pager');
    // Nettoyer les styles inline
    ['transform','transition','width','height','position','overflow','willChange','display']
      .forEach(p => { grid.style[p] = ''; });
  }
  const ps = document.getElementById('k-page-scroll');
  if (ps) ps.classList.remove('k-pager-active');
  window.removeEventListener('resize', _setupMobilePager);
}

// ── Stubs compatibilité ───────────────────────────────────────────
function _setupSectionAutoAdvance() { /* réactivable plus tard */ }
function _setupInfiniteLoop()       { }
function _setupHorizontalWrap()     { }
function _syncChipToScroll()        { }
function _onPagerScroll()           { }
function _setupPagerDots()          { }
function _reshuffleToutInDOM() {
  const grid = document.getElementById('k-grid');
  if (!grid) return;
  const sec = grid.querySelector('.k-cat-section[data-cat="all"]');
  if (!sec) return;
  const sg = sec.querySelector('.k-sec-grid');
  if (!sg) return;
  const cards = [...sg.children];
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  sg.append(...cards);
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
