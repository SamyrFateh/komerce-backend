/**
 * b-pager.js — Pager horizontal catégories principales mobile
 *
 * Features :
 * 1. Rail horizontal scroll-snap — une page par catégorie
 * 2. Ghost loop — après la dernière catégorie, une page clone de "Tout"
 *    → swipe dessus → téléportation silencieuse vers le vrai "Tout" (idx 0)
 * 3. Bounce vertical — en bas d'une page → scroll automatique vers la suivante
 * 4. Sync chips — au scroll natif, chip active = page visible
 */

import { bus }   from './b-bus.js';
import { state } from './b-store.js';

'use strict';

// ── Variables CSS de la cage ──────────────────────────────────────

function _recalcPagerVars() {
  // PATCH #233 — no pager vars on desktop
  if (window.innerWidth >= 900) {
    destroyMobilePager();
    return;
  }

  const ps   = document.getElementById('k-page-scroll');
  const bnav = document.querySelector('.k-bnav');
  const wrap = document.getElementById('k-hero-fixed-wrap');

  const bnavH   = bnav ? bnav.offsetHeight : 56;
  const wrapH   = wrap ? wrap.offsetHeight : 180;
  const headerH = 44;

  const pagerTop = wrapH + headerH;
  const pagerH   = window.innerHeight - pagerTop - bnavH;

  document.documentElement.style.setProperty('--pager-top', pagerTop + 'px');
  document.documentElement.style.setProperty('--pager-h',   Math.max(pagerH, 300) + 'px');
  document.documentElement.style.setProperty('--pager-w',   window.innerWidth + 'px');
  document.documentElement.style.setProperty('--bnav-h',    bnavH + 'px');

  if (ps) { ps.style.left = '0'; ps.style.right = '0'; ps.style.width = '100vw'; }
}

// ── Helpers ───────────────────────────────────────────────────────

function _getGrid() { return document.getElementById('k-grid'); }

function _getPages(grid) {
  return Array.from((grid || _getGrid()).querySelectorAll(':scope > .k-cat-section'));
}

function _getRealPages(grid) {
  // Exclut le ghost
  return Array.from((grid || _getGrid()).querySelectorAll(':scope > .k-cat-section:not([data-ghost])'));
}

function _getCurrentIndex(grid) {
  const g = grid || _getGrid();
  if (!g) return 0;
  const w = g.clientWidth || window.innerWidth;
  return w > 0 ? Math.max(0, Math.round(g.scrollLeft / w)) : 0;
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

function _scrollToIndex(grid, idx, behavior = 'smooth') {
  const w    = grid.clientWidth || window.innerWidth;
  const left = idx * w;
  grid.scrollTo({ left, behavior });
  setTimeout(() => {
    if (Math.abs(grid.scrollLeft - left) > 10) grid.scrollLeft = left;
  }, 150);
}

// ── Ghost loop ────────────────────────────────────────────────────
// Ajoute un clone de la page "Tout" à la fin du rail.
// Quand l'utilisateur y arrive, on téléporte silencieusement vers le vrai Tout.

function _setupInfiniteLoop() {
  const grid = _getGrid();
  if (!grid || window.innerWidth >= 900) return;

  // Supprimer l'ancien ghost
  grid.querySelectorAll('[data-ghost]').forEach(g => g.remove());

  const toutPage = grid.querySelector('.k-cat-section[data-cat="all"]:not([data-ghost])');
  if (!toutPage) return;

  // Cloner la page Tout et l'ajouter à la fin
  const ghost = toutPage.cloneNode(true);
  ghost.setAttribute('data-ghost', 'true');
  ghost.dataset.cat = 'all';
  grid.appendChild(ghost);
}

function _ghostTeleport(grid) {
  // 1. Masquer le grid pendant la téléportation (évite le scintillement)
  grid.style.opacity    = '0';
  grid.style.transition = 'none';

  // 2. Mélanger les cartes de Tout (dopamine)
  _reshuffleToutInDOM();

  // 3. Téléporter vers idx 0 sans animation
  _scrollToIndex(grid, 0, 'instant');
  _syncChip('all');

  // 4. Réafficher après un frame (le browser a repositionné le scroll)
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      grid.style.opacity    = '';
      grid.style.transition = '';
    });
  });
}

// ── Scroll listener principal ─────────────────────────────────────

function _setupScrollSync(grid) {
  if (grid._pagerScrollH) grid.removeEventListener('scroll', grid._pagerScrollH);

  let raf = null;
  let lastIdx = -1;

  grid._pagerScrollH = () => {
    if (state.modalOpen) return;
    if (raf) cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      const allPages = _getPages(grid);
      const idx = _getCurrentIndex(grid);
      const page = allPages[idx];
      if (!page) return;

      // Ghost détecté → téléportation
      if (page.dataset.ghost) {
        _ghostTeleport(grid);
        lastIdx = 0;
        return;
      }

      const cat = page.dataset.cat;
      if (cat && idx !== lastIdx) {
        lastIdx = idx;
        _syncChip(cat);
      }
    });
  };

  grid.addEventListener('scroll', grid._pagerScrollH, { passive: true });
}

// ── Bounce vertical → page suivante ──────────────────────────────

function _setupSectionAutoAdvance() {
  const grid = _getGrid();
  if (!grid || window.innerWidth >= 900) return;

  function _bindPage(page) {
    if (page._bounceH) page.removeEventListener('scroll', page._bounceH);

    let lastST  = 0;
    let wasDown = false;
    let timer   = null;

    page._bounceH = () => {
      if (state.modalOpen) return;
      const st = page.scrollTop;
      if      (st > lastST + 2) wasDown = true;
      else if (st < lastST - 8) wasDown = false;
      lastST = st;

      const atBottom = page.scrollHeight <= page.clientHeight + 8
        || page.scrollTop + page.clientHeight >= page.scrollHeight - 32;

      if (wasDown && atBottom) {
        clearTimeout(timer);
        timer = setTimeout(() => {
          if (!wasDown || state.modalOpen) return;
          const realPages = _getRealPages(grid);
          const currentIdx = _getCurrentIndex(grid);
          const total = realPages.length; // sans ghost
          const nextIdx = currentIdx + 1 >= total ? 0 : currentIdx + 1;

          // Hint visuel
          _showNextHint(page, realPages[nextIdx]);

          // Si on passe à 0 depuis la dernière → aller au ghost (scroll naturel)
          // puis téléporter
          if (nextIdx === 0) {
            const allPages = _getPages(grid);
            const ghostIdx = allPages.findIndex(p => p.dataset.ghost);
            if (ghostIdx >= 0) {
              _scrollToIndex(grid, ghostIdx, 'smooth');
              return;
            }
          }
          _scrollToIndex(grid, nextIdx, 'smooth');
        }, 350);
      } else {
        clearTimeout(timer);
      }
    };

    page.addEventListener('scroll', page._bounceH, { passive: true });
  }

  // Binder toutes les vraies pages (pas le ghost)
  _getRealPages(grid).forEach(_bindPage);
}

function _showNextHint(currentPage, nextPage) {
  if (!nextPage) return;
  const cat = nextPage.dataset.cat || 'Tout';
  const label = document.querySelector(`#k-cats .k-chip[data-cat="${cat}"] .k-chip-label`)?.textContent || cat;

  const existing = currentPage.querySelector('.k-pager-next-hint');
  if (existing) existing.remove();

  const hint = document.createElement('div');
  hint.className = 'k-pager-next-hint';
  hint.textContent = label + ' →';
  currentPage.appendChild(hint);
  setTimeout(() => hint.remove(), 900);
}

// ── Setup principal ───────────────────────────────────────────────

function _handlePagerResize() {
  if (window.innerWidth >= 900) {
    destroyMobilePager();
    return;
  }
  _setupMobilePager();
}

function _setupMobilePager() {
  if (window.innerWidth >= 900) {
    destroyMobilePager();
    return;
  }
  const grid = _getGrid();
  if (!grid) return;
  if (grid.classList.contains('k-grid-flat-subcat')) return;

  _recalcPagerVars();
  _setupScrollSync(grid);

  window.removeEventListener('resize', _setupMobilePager);
  window.removeEventListener('resize', _handlePagerResize);
  window.addEventListener('resize', _handlePagerResize);
}

// ── Navigation externe (chip click) ──────────────────────────────

function _scrollPagerToCat(cat, behavior = 'smooth') {
  const grid = _getGrid();
  if (!grid || window.innerWidth >= 900) return;
  if (grid.classList.contains('k-grid-flat-subcat')) return;

  const pages = _getRealPages(grid); // chercher dans les vraies pages
  const idx   = pages.findIndex(p => p.dataset.cat === cat);
  if (idx < 0) return;

  _scrollToIndex(grid, idx, behavior);
  _syncChip(cat);
}

function _scrollPagerToGhost() { _scrollPagerToCat('all'); }

// ── Destroy ───────────────────────────────────────────────────────

function destroyMobilePager() {
  const grid = _getGrid();
  if (grid) {
    if (grid._pagerScrollH) {
      grid.removeEventListener('scroll', grid._pagerScrollH);
      grid._pagerScrollH = null;
    }
    // Nettoyer bounces sur les pages
    _getPages(grid).forEach(p => {
      if (p._bounceH) { p.removeEventListener('scroll', p._bounceH); p._bounceH = null; }
    });
    // Supprimer ghost
    grid.querySelectorAll('[data-ghost]').forEach(g => g.remove());
    grid.classList.remove('k-grid-cat-pager');
    ['transform','transition','width','height','position','overflow','willChange','display']
      .forEach(p => { grid.style[p] = ''; });
  }
  const ps = document.getElementById('k-page-scroll');
  if (ps) {
    ps.classList.remove('k-pager-active');
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
    ].forEach(p => { ps.style[p] = ''; });
  }

  document.documentElement.style.removeProperty('--pager-top');
  document.documentElement.style.removeProperty('--pager-h');
  document.documentElement.style.removeProperty('--pager-w');
  document.documentElement.style.removeProperty('--bnav-h');

  window.removeEventListener('resize', _setupMobilePager);
  window.removeEventListener('resize', _handlePagerResize);
}

// ── Reshuffle Tout ────────────────────────────────────────────────

function _reshuffleToutInDOM() {
  const grid = _getGrid();
  if (!grid) return;
  const sec = grid.querySelector('.k-cat-section[data-cat="all"]:not([data-ghost])');
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

// ── Stubs compatibilité ───────────────────────────────────────────
function _setupHorizontalWrap() { }
function _syncChipToScroll()    { }
function _onPagerScroll()       { }
function _setupPagerDots()      { }

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
