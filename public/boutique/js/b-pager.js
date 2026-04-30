/**
 * b-pager.js — Centrage chip catégorie uniquement
 *
 * Ce module ne gère PAS de rail horizontal sur #k-grid.
 * Responsabilité unique : centrer la chip active dans le rail catégories.
 *
 * Le scroll horizontal des sous-catégories (flatSubcat) est géré par b-subcat.js.
 */

import { bus }   from './b-bus.js';
import { state } from './b-store.js';

'use strict';

// ── Centrage chip ─────────────────────────────────────────────────

function _scrollPagerToCat(cat) {
  // En mode grille verticale : juste centrer la chip dans le rail
  const chip = document.querySelector('#k-cats .k-chip[data-cat="' + cat + '"]');
  if (chip) bus.emit('chip:center', chip);
}

function _scrollPagerToGhost() {
  _scrollPagerToCat('all');
}

// ── Cleanup (appelé avant flatSubcat) ─────────────────────────────

function destroyMobilePager() {
  // Rien à détruire — pas de listeners ni de styles inline posés
  const grid = document.getElementById('k-grid');
  if (grid) {
    grid.classList.remove('k-grid-cat-pager');
    grid.style.transform  = '';
    grid.style.transition = '';
    grid.style.overflow   = '';
  }
  const ps = document.getElementById('k-page-scroll');
  if (ps) ps.classList.remove('k-pager-active');
}

// ── Stubs (compatibilité b-catalog.js) ───────────────────────────

function _setupMobilePager()       { /* grille verticale — rien à faire */ }
function _setupSectionAutoAdvance() { /* désactivé */ }
function _setupInfiniteLoop()       { /* désactivé */ }
function _setupHorizontalWrap()     { /* désactivé */ }
function _syncChipToScroll()        { /* désactivé */ }
function _onPagerScroll()           { /* désactivé */ }
function _setupPagerDots()          { /* désactivé */ }
function _reshuffleToutInDOM()      {
  // Mélanger les cartes de la section "Tout" pour la dopamine
  const grid = document.getElementById('k-grid');
  if (!grid) return;
  const sec = grid.querySelector('.k-cat-section[data-cat="all"]');
  if (!sec) return;
  const secGrid = sec.querySelector('.k-sec-grid');
  if (!secGrid) return;
  const cards = Array.from(secGrid.children);
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  secGrid.append(...cards);
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
