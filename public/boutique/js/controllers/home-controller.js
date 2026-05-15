/**
 * @component Boutique / Home Controller
 * @owner home-controller.js
 *
 * Responsibility:
 * - Mount the category rail rendered by render-categories.js.
 * - Orchestrate category selection on the home/catalog experience.
 * - Sync active category state between chips and desktop horizontal navigation.
 * - Own the desktop contextual rayon rail under #k-subcats-wrap.
 *
 * Must not:
 * - Define category or subcategory data.
 * - Duplicate category chip markup.
 * - Render product cards.
 * - Own mobile pager internals.
 * - Patch hero/category CSS to compensate pager state bugs.
 *
 * Depends on:
 * - shop-schema.js for category/subcategory metadata.
 * - render-categories.js for category rail markup.
 * - b-catalog.js for renderGrid()/setActiveCat().
 * - b-pager.js indirectly through injected scrollPagerToCat().
 *
 * See:
 * - docs/BOUTIQUE_COMPONENT_OWNERSHIP.md
 * - docs/BOUTIQUE_CATEGORY_NAVIGATION_REDESIGN.md
 */

import { state, dom, $$, setActiveCatState } from '../b-store.js';
import { renderCategoryRailMarkup } from '../render/render-categories.js';
import { getSubcategories, getRailCategories } from '../shop-schema.js';
import { renderGrid, setActiveCat } from '../b-catalog.js';
import { scrollPageToTop, scrollPageToElement } from '../b-scroll-owner.js';

function getCatsEl() {
  return document.getElementById('k-cats');
}

function isDesktop() {
  return window.innerWidth >= 900;
}

function scrollToCatalog() {
  const catalog = document.getElementById('k-catalog-section') || document.getElementById('k-grid');
  if (catalog) scrollPageToElement(catalog, -120, 'smooth');
}

/**
 * Affiche/masque le rail de rayons contextuels desktop.
 * Mobile garde sa logique pager/rail compact.
 */
export function renderSubcatRail(catKey) {
  if (window.innerWidth < 900) return;
  const wrap = document.getElementById('k-subcats-wrap');
  if (!wrap) return;

  const subs = catKey && catKey !== 'all' ? getSubcategories(catKey) : [];
  if (!subs.length) {
    wrap.style.display = 'none';
    wrap.innerHTML = '';
    document.documentElement.style.removeProperty('--sidebar-top');
    return;
  }

  const activeSub = state.activeSubcat || null;
  wrap.innerHTML =
    '<div class="k-desktop-rayons-head">' +
      '<span class="k-desktop-rayons-title">Rayons</span>' +
      '<span class="k-desktop-rayons-hint">Affiner l’univers sélectionné</span>' +
    '</div>' +
    '<div class="k-subcats-rail k-subcats-visible k-desktop-rayons-rail">' +
      '<button class="k-subchip' + (!activeSub ? ' active' : '') + '" data-subcat="">' +
        '<span class="k-subchip-label">Tout voir</span>' +
      '</button>' +
      subs.map(s =>
        '<button class="k-subchip' + (activeSub === s.key ? ' active' : '') + '" data-subcat="' + s.key + '">' +
          (s.icon ? '<span class="k-subchip-icon">' + s.icon + '</span>' : '') +
          '<span class="k-subchip-label">' + s.label + '</span>' +
        '</button>'
      ).join('') +
    '</div>';
  wrap.dataset.parentCat = catKey;
  wrap.style.display = 'block';

  requestAnimationFrame(function() {
    var wrapH = wrap.offsetHeight || 50;
    var headerH = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--header-h')) || 76;
    var catsShell = document.querySelector('.k-cats-shell');
    var catsH = catsShell ? catsShell.offsetHeight : 58;
    document.documentElement.style.setProperty('--sidebar-top', (headerH + catsH + wrapH + 4) + 'px');
  });

  wrap.querySelectorAll('.k-subchip').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const sub = btn.dataset.subcat || null;
      state.activeSubcat = sub || null;
      wrap.querySelectorAll('.k-subchip').forEach(b => b.classList.toggle('active', b === btn));
      renderGrid();
      requestAnimationFrame(function() {
        renderSubcatRail(state.activeCat);
        scrollToCatalog();
      });
    });
  });
}

export function centerRailChip(chip) {
  const catsEl = getCatsEl();
  if (!chip || !catsEl || window.innerWidth >= 900) return;
  const left = chip.offsetLeft - (catsEl.clientWidth / 2) + (chip.clientWidth / 2);
  catsEl.scrollTo({ left, behavior: 'smooth' });
}

export function syncRailActiveState(categoryKey, options = {}) {
  const center = options.center !== false;
  let activeChip = null;
  $$('.k-chip').forEach((chip) => {
    const isActive = chip.dataset.cat === categoryKey;
    chip.classList.toggle('active', isActive);
    if (isActive) activeChip = chip;
  });
  if (center && activeChip) centerRailChip(activeChip);
  return activeChip;
}

export function renderCategoryRail() {
  const catsEl = getCatsEl();
  if (!catsEl) return null;

  const expectedCategories = getRailCategories();
  const expectedKeys = expectedCategories.map(c => c.key);
  const existingChips = Array.from(catsEl.querySelectorAll('.k-chip'));
  const alreadyInSync =
    existingChips.length === expectedKeys.length &&
    existingChips.every((chip, i) => {
      if (chip.dataset.cat !== expectedKeys[i]) return false;
      const img = chip.querySelector('.k-chip-photo img');
      const expectedImage = expectedCategories[i].image || '';
      return !expectedImage || (img && img.getAttribute('src') === expectedImage);
    });

  if (!alreadyInSync) {
    catsEl.innerHTML = renderCategoryRailMarkup(state.activeCat);
  }

  return catsEl;
}

/** Met à jour l'état actif de l'ancienne sidebar desktop si elle existe encore. */
export function syncDesktopSidebar(catKey) {
  if (window.innerWidth < 900) return;
  document.querySelectorAll('.k-sidebar-cat').forEach(function(item) {
    item.classList.toggle('is-active', item.dataset.cat === catKey);
  });
}

function handleCategorySelection(cat, deps) {
  const { renderGrid, scrollPagerToCat, scrollToCategorySection } = deps;

  if (state.flatSubcat) {
    state.flatSubcat = null;
    renderGrid();
    requestAnimationFrame(() => handleCategorySelection(cat, deps));
    return;
  }

  const pageScroll = dom.pageScroll;
  const pagerActive = window.innerWidth < 900
    && pageScroll
    && pageScroll.classList.contains('k-pager-active')
    && document.getElementById('k-grid')?.classList.contains('k-grid-cat-pager');

  if (pagerActive) {
    setActiveCatState(cat);
    syncRailActiveState(cat, { center: true });
    const scrolled = scrollPagerToCat(cat);
    if (scrolled) return;
  }

  if (cat === 'all') {
    if (state.activeCat === 'all') {
      scrollPageToTop('smooth');
      return;
    }
    syncRailActiveState('all', { center: true });
    state.sectionSubcats = {};
    state.activeSubcat = null;
    setActiveCat('all');
    scrollPageToTop('smooth');
    return;
  }

  if (state.activeCat === 'all') {
    syncRailActiveState(cat, { center: true });
    state.activeSubcat = null;
    setActiveCat(cat);
    scrollPageToTop('smooth');
    return;
  }

  if (cat === state.activeCat) {
    if (window.innerWidth >= 900) {
      renderSubcatRail(cat);
      scrollToCatalog();
      return;
    }

    syncRailActiveState('all', { center: true });
    state.sectionSubcats = {};
    state.activeSubcat = null;
    setActiveCat('all');
    scrollPageToTop('smooth');
    return;
  }

  syncRailActiveState(cat, { center: true });
  state.activeSubcat = null;
  setActiveCat(cat);
  scrollPageToTop('smooth');
}

export function setupHomeController(deps) {
  const catsEl = renderCategoryRail();
  if (!catsEl || catsEl.dataset.bound === '1') return;
  catsEl.dataset.bound = '1';

  catsEl.querySelectorAll('.k-chip').forEach((chip) => {
    chip.addEventListener('click', () => handleCategorySelection(chip.dataset.cat, deps));
  });

  const activeChip = catsEl.querySelector('.k-chip.active');
  if (activeChip) centerRailChip(activeChip);
}
