/**
 * @komerce-arch
 * @role          mobile-category-pager
 * @domain        catalog
 * @layer         ui-state
 * @criticality   high
 * @inputs        category_sections, scroll_state, viewport, modal_events
 * @outputs       horizontal_pager_state, active_chip_sync, category_scroll_memory
 * @depends       b-bus.js, b-pager-end-bounce.js, b-scroll-owner.js, b-store.js
 * @used-by       b-catalog.js, b-subcat.js, b-nav.js, discovery-rail.js
 * @doctrine      navigation_sans_friction, categorie_souscategorie_switch_fluide, mobile_desktop_coherence, docs/doctrine/DOCTRINE_DISCOVERY_ACCESSIBILITE_LOCALE.md
 * @impact-areas  mobile-navigation, category-navigation, scroll-ownership, product-grid, discovery-rail
 * @version       2026-09
 */
'use strict';

/**
 * b-pager.js — Temu V2.11 : pager horizontal des catégories principales mobile.
 *
 * Grammaire :
 * - horizontal = changement explicite d'univers (swipe ou tap sur le rail) ;
 * - vertical   = exploration locale de l'univers courant ;
 * - toute entrée horizontale dans un univers repart en haut afin que
 *   `Disponible ici`, lorsqu'il existe, soit immédiatement visible ;
 * - l'arrivée verticale volontaire en bas déclenche le bump historique :
 *   passage automatique vers la catégorie suivante, repositionnée en haut ;
 * - un unique ghost DROITE, snapshot inerte de Tout, permet dernière catégorie → Tout.
 *
 * Le ghost n'est jamais une page métier : pas de fetch, pas d'event listener,
 * pas d'ID dupliqué, pas d'interaction. Une fois visible, le pager se recale
 * silencieusement sur la vraie page Tout, elle aussi repositionnée en haut.
 */

import { bus } from './b-bus.js';
import { state, dom, setActiveCatState } from './b-store.js';
import { isDesktop } from './b-scroll-owner.js';
import { setupPagerEndBounce, teardownPagerEndBounce } from './b-pager-end-bounce.js';

let _stabilizationHooksInstalled = false;
let _recalcRaf = 0;
let _isProgrammaticScroll = false;
let _programmaticScrollTimer = null;
let _isSettingUpMobilePager = false;

const _pageScrollByCat = new Map();

function _scheduleRecalc() {
  if (_recalcRaf) cancelAnimationFrame(_recalcRaf);
  _recalcRaf = requestAnimationFrame(() => {
    _recalcRaf = requestAnimationFrame(() => {
      _recalcRaf = 0;
      _recalcPagerVars();
    });
  });
}

function _installStabilizationHooks() {
  if (_stabilizationHooksInstalled) return;
  _stabilizationHooksInstalled = true;

  const wrap = document.getElementById('k-hero-fixed-wrap');
  const img = wrap && (wrap.querySelector('.k-hero-img') || wrap.querySelector('img'));
  if (img && !img.complete) {
    img.addEventListener('load', _scheduleRecalc, { once: true });
    img.addEventListener('error', _scheduleRecalc, { once: true });
  }
  if (document.fonts?.ready) {
    document.fonts.ready.then(_scheduleRecalc).catch(() => {});
  }
  if (window.ResizeObserver && wrap) {
    try { new ResizeObserver(_scheduleRecalc).observe(wrap); } catch (e) {}
  }
  window.addEventListener('resize', _scheduleRecalc, { passive: true });
  window.addEventListener('orientationchange', _scheduleRecalc, { passive: true });
}

function _recalcPagerVars() {
  if (isDesktop()) {
    destroyMobilePager();
    return;
  }

  const ps = dom.pageScroll;
  const bnav = document.querySelector('.k-bnav');
  const bnavH = bnav ? bnav.offsetHeight : 56;

  let pagerTop = 0;
  [
    document.querySelector('.k-header'),
    document.getElementById('k-hero-fixed-wrap'),
    document.getElementById('k-sticky-bar'),
    document.querySelector('.k-hero-cats-sticky'),
    document.querySelector('.k-cats-shell'),
  ].forEach((el) => {
    if (!el) return;
    const bottom = el.getBoundingClientRect().bottom;
    if (bottom > pagerTop) pagerTop = bottom;
  });

  if (pagerTop < 10) {
    const wrap = document.getElementById('k-hero-fixed-wrap');
    pagerTop = (wrap ? wrap.offsetHeight : 180) + 44;
  }

  const pagerH = window.innerHeight - pagerTop - bnavH;
  document.documentElement.style.setProperty('--pager-top', pagerTop + 'px');
  document.documentElement.style.setProperty('--pager-h', Math.max(pagerH, 300) + 'px');
  document.documentElement.style.setProperty('--pager-w', window.innerWidth + 'px');
  document.documentElement.style.setProperty('--bnav-h', bnavH + 'px');

  if (ps) {
    ps.style.top = pagerTop + 'px';
    ps.style.left = '0';
    ps.style.right = '0';
    ps.style.width = '100vw';
  }

  _installStabilizationHooks();
}

function _getGrid() {
  return document.getElementById('k-grid');
}

function _getPages(grid) {
  const target = grid || _getGrid();
  if (!target) return [];
  return Array.from(target.querySelectorAll(':scope > .k-cat-section:not([data-ghost])'));
}

function _getPagerPages(grid) {
  const target = grid || _getGrid();
  if (!target) return [];
  return Array.from(target.querySelectorAll(':scope > .k-cat-section'));
}

function _getCurrentIndex(grid) {
  const target = grid || _getGrid();
  if (!target) return 0;
  const width = target.clientWidth || window.innerWidth;
  return width > 0 ? Math.max(0, Math.round(target.scrollLeft / width)) : 0;
}

function _syncChip(cat) {
  setActiveCatState(cat);
  let activeChip = null;
  document.querySelectorAll('#k-cats .k-chip').forEach((chip) => {
    const active = chip.dataset.cat === cat;
    chip.classList.toggle('active', active);
    if (active) activeChip = chip;
  });
  if (activeChip) bus.emit('chip:center', activeChip);
}

function _scrollToIndex(grid, idx, behavior = 'smooth') {
  const width = grid.clientWidth || window.innerWidth;
  if (width <= 0) {
    requestAnimationFrame(() => _scrollToIndex(grid, idx, behavior));
    return;
  }

  _isProgrammaticScroll = true;
  clearTimeout(_programmaticScrollTimer);
  grid.scrollTo({ left: idx * width, behavior });
  _programmaticScrollTimer = setTimeout(() => {
    _isProgrammaticScroll = false;
  }, behavior === 'instant' ? 32 : 100);
}

function _resetPageToTop(page, grid) {
  if (!page) return;
  const cat = page.dataset.cat;
  page.scrollTop = 0;
  if (cat) _pageScrollByCat.set(cat, 0);

  if (cat === 'all') {
    const target = grid || _getGrid();
    const ghost = target?.querySelector(':scope > .k-cat-section[data-ghost="right"]');
    if (ghost) ghost.scrollTop = 0;
  }
}

function _teardownPageScrollMemory(grid, persist = true) {
  _getPages(grid).forEach((page) => {
    const cat = page.dataset.cat;
    if (persist && cat) _pageScrollByCat.set(cat, page.scrollTop);
    if (page._pagerVerticalScrollH) {
      page.removeEventListener('scroll', page._pagerVerticalScrollH);
      page._pagerVerticalScrollH = null;
    }
  });
}

function _setupPageScrollMemory(grid) {
  _getPages(grid).forEach((page) => {
    const cat = page.dataset.cat;
    if (!cat) return;

    if (page._pagerVerticalScrollH) {
      page.removeEventListener('scroll', page._pagerVerticalScrollH);
    }

    const saved = _pageScrollByCat.get(cat);
    if (Number.isFinite(saved)) page.scrollTop = saved;

    page._pagerVerticalScrollH = () => {
      _pageScrollByCat.set(cat, page.scrollTop);
      if (cat === 'all') {
        const ghost = grid.querySelector(':scope > .k-cat-section[data-ghost="right"]');
        if (ghost) ghost.scrollTop = page.scrollTop;
      }
    };
    page.addEventListener('scroll', page._pagerVerticalScrollH, { passive: true });
  });
}

function _teleportRightGhost(grid) {
  const realTout = grid.querySelector(':scope > .k-cat-section[data-cat="all"]:not([data-ghost])');
  if (!realTout) return;

  _isProgrammaticScroll = true;
  clearTimeout(_programmaticScrollTimer);
  _resetPageToTop(realTout, grid);

  const previousSnap = grid.style.scrollSnapType;
  const previousBehavior = grid.style.scrollBehavior;
  grid.style.scrollSnapType = 'none';
  grid.style.scrollBehavior = 'auto';
  grid.scrollLeft = 0;
  _syncChip('all');

  requestAnimationFrame(() => {
    grid.style.scrollSnapType = previousSnap;
    grid.style.scrollBehavior = previousBehavior;
    grid.scrollLeft = 0;
    _programmaticScrollTimer = setTimeout(() => {
      _isProgrammaticScroll = false;
    }, 32);
  });
}

function _setupScrollSync(grid) {
  if (grid._pagerScrollH) grid.removeEventListener('scroll', grid._pagerScrollH);

  let raf = null;
  let lastIdx = -1;
  grid._pagerScrollH = () => {
    if (_isProgrammaticScroll || state.modalOpen) return;
    if (raf) cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      const pages = _getPagerPages(grid);
      const idx = _getCurrentIndex(grid);
      const page = pages[idx];
      if (!page) return;

      if (page.dataset.ghost === 'right') {
        lastIdx = -1;
        _teleportRightGhost(grid);
        return;
      }

      const cat = page.dataset.cat;
      if (cat && idx !== lastIdx) {
        _resetPageToTop(page, grid);
        lastIdx = idx;
        _syncChip(cat);
      }
    });
  };

  grid.addEventListener('scroll', grid._pagerScrollH, { passive: true });
}

function _handlePagerResize() {
  if (isDesktop()) {
    destroyMobilePager();
    return;
  }
  _setupMobilePager();
}

function _setupMobilePager() {
  if (isDesktop()) {
    destroyMobilePager();
    return;
  }
  if (_isSettingUpMobilePager) return;
  _isSettingUpMobilePager = true;

  try {
    const grid = _getGrid();
    if (!grid || grid.classList.contains('k-grid-flat-subcat')) return;

    _recalcPagerVars();
    _setupPageScrollMemory(grid);
    _setupScrollSync(grid);

    window.removeEventListener('resize', _setupMobilePager);
    window.removeEventListener('resize', _handlePagerResize);
    window.addEventListener('resize', _handlePagerResize);
  } finally {
    _isSettingUpMobilePager = false;
  }
}

function _scrollPagerToCat(cat, behavior = 'smooth') {
  const grid = _getGrid();
  if (!grid || isDesktop()) return false;
  const pages = _getPages(grid);
  const idx = pages.findIndex((page) => page.dataset.cat === cat);
  if (idx < 0) return false;

  _resetPageToTop(pages[idx], grid);
  _syncChip(cat);
  _scrollToIndex(grid, idx, behavior);
  return true;
}

/**
 * Crée un unique ghost DROITE : clone visuel inerte de Tout.
 * Les event listeners ne sont pas clonés par cloneNode(); tous les IDs sont
 * retirés et les descendants interactifs neutralisés. Le ghost représente
 * toujours l'entrée de Tout en haut de page, jamais son ancien scroll vertical.
 */
function _setupInfiniteLoop() {
  const grid = _getGrid();
  if (!grid || isDesktop() || grid.classList.contains('k-grid-flat-subcat')) return;

  const realPagesBefore = _getPages(grid);
  const currentIdx = _getCurrentIndex(grid);
  if (currentIdx >= realPagesBefore.length && realPagesBefore.length > 0) {
    const toutBefore = realPagesBefore.find(page => page.dataset.cat === 'all');
    _resetPageToTop(toutBefore, grid);
    grid.scrollLeft = 0;
    _syncChip('all');
  }

  grid.querySelectorAll(':scope > .k-cat-section[data-ghost]').forEach((ghost) => ghost.remove());

  const realPages = _getPages(grid);
  if (realPages.length < 2) return;
  const toutPage = grid.querySelector(':scope > .k-cat-section[data-cat="all"]:not([data-ghost])');
  if (!toutPage) return;

  const ghost = toutPage.cloneNode(true);
  ghost.dataset.ghost = 'right';
  ghost.setAttribute('aria-hidden', 'true');
  ghost.setAttribute('inert', '');
  ghost.style.pointerEvents = 'none';
  ghost.style.userSelect = 'none';
  ghost.removeAttribute('id');
  ghost.querySelectorAll('[id]').forEach(node => node.removeAttribute('id'));
  ghost.querySelectorAll('a, button, input, select, textarea, [tabindex]')
    .forEach(node => node.setAttribute('tabindex', '-1'));

  grid.appendChild(ghost);
  ghost.scrollTop = 0;
}

function _teardownSectionAutoAdvance(pages = _getPages()) {
  pages.forEach((page) => {
    if (page._bounceH) {
      page.removeEventListener('scroll', page._bounceH);
      page._bounceH = null;
    }
    if (page._bounceTouchEnd) {
      page.removeEventListener('touchend', page._bounceTouchEnd);
      page.removeEventListener('touchcancel', page._bounceTouchEnd);
      page._bounceTouchEnd = null;
    }
    if (page._bounceTimer) {
      clearTimeout(page._bounceTimer);
      page._bounceTimer = null;
    }
    page._bounceLastST = 0;
    page._bounceWasDown = false;
  });
  teardownPagerEndBounce(pages);
}

function _setupSectionAutoAdvance() {
  const pages = _getPages();
  _teardownSectionAutoAdvance(pages);

  return setupPagerEndBounce({
    pages,
    isBlocked: () => state.modalOpen || isDesktop(),
    onAdvance: (currentPage, nextPage) => {
      const grid = _getGrid();
      if (!grid) return;
      const realPages = _getPages(grid);
      const currentIndex = realPages.indexOf(currentPage);
      if (currentIndex < 0) return;

      _resetPageToTop(nextPage, grid);
      _syncChip(nextPage.dataset.cat || 'all');

      if (currentIndex + 1 < realPages.length) {
        _scrollToIndex(grid, currentIndex + 1, 'smooth');
        return;
      }

      const ghost = grid.querySelector(':scope > .k-cat-section[data-ghost="right"]');
      const ghostIndex = _getPagerPages(grid).indexOf(ghost);
      _scrollToIndex(grid, ghostIndex >= 0 ? ghostIndex : 0, 'smooth');
    },
  });
}

function _scrollPagerToGhost() {
  return _scrollPagerToCat('all');
}

function _reshuffleToutInDOM() {
  const grid = _getGrid();
  const sec = grid?.querySelector('.k-cat-section[data-cat="all"]:not([data-ghost])');
  const sg = sec?.querySelector('.k-sec-grid');
  if (!sg) return;
  const cards = [...sg.children];
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  sg.append(...cards);
}

function destroyMobilePager() {
  _isProgrammaticScroll = false;
  clearTimeout(_programmaticScrollTimer);

  const grid = _getGrid();
  if (grid) {
    _teardownPageScrollMemory(grid, true);
    if (grid._pagerScrollH) {
      grid.removeEventListener('scroll', grid._pagerScrollH);
      grid._pagerScrollH = null;
    }

    _teardownSectionAutoAdvance(_getPages(grid));
    grid.querySelectorAll('[data-ghost]').forEach((ghost) => ghost.remove());
    grid.classList.remove('k-grid-cat-pager');
    ['transform', 'transition', 'width', 'height', 'position', 'overflow', 'willChange', 'display']
      .forEach((prop) => { grid.style[prop] = ''; });
  }

  const ps = dom.pageScroll;
  if (ps) {
    ps.classList.remove('k-pager-active');
    [
      'position', 'top', 'left', 'right', 'bottom', 'width', 'height',
      'maxWidth', 'overflow', 'overflowX', 'overflowY', 'transform', 'transition',
    ].forEach((prop) => { ps.style[prop] = ''; });
  }

  document.documentElement.style.removeProperty('--pager-top');
  document.documentElement.style.removeProperty('--pager-h');
  document.documentElement.style.removeProperty('--pager-w');
  document.documentElement.style.removeProperty('--bnav-h');

  window.removeEventListener('resize', _setupMobilePager);
  window.removeEventListener('resize', _handlePagerResize);
}

function _setupHorizontalWrap() {}
function _syncChipToScroll() {}
function _onPagerScroll() {}
function _setupPagerDots() {}

export {
  _setupMobilePager,
  _recalcPagerVars,
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
