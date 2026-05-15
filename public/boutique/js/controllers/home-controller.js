/**
 * @component Boutique / Home Controller
 * @owner home-controller.js
 *
 * Responsibility:
 * - Mount the category rail rendered by render-categories.js.
 * - Orchestrate category selection on the home/catalog experience.
 * - Sync active category state between chips and desktop horizontal navigation.
 * - Own the desktop contextual subcategory rail rendered below the image pills.
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

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function scrollToCatalog() {
  const catalog = document.getElementById('k-catalog-section') || document.getElementById('k-grid');
  if (catalog) scrollPageToElement(catalog, -120, 'smooth');
}

/**
 * Rail contextuel desktop sous les grandes pastilles imagées.
 *
 * Doctrine desktop retenue :
 * - le rail principal choisit l'univers ;
 * - ce rail contextuel affine l'univers ;
 * - le flat header catalogue est masqué en desktop par CSS pour éviter doublon.
 *
 * Mobile reste inchangé : cette fonction ne participe pas au pager mobile.
 */
export function renderSubcatRail(catKey) {
  if (!isDesktop()) return;

  const wrap = document.getElementById('k-subcats-wrap');
  if (!wrap) return;

  const subcats = catKey && catKey !== 'all' ? getSubcategories(catKey) : [];
  if (!catKey || catKey === 'all' || !subcats.length) {
    wrap.style.display = 'none';
    wrap.innerHTML = '';
    delete wrap.dataset.parentCat;
    document.documentElement.style.removeProperty('--sidebar-top');
    return;
  }

  wrap.style.display = '';
  wrap.dataset.parentCat = catKey;

  const activeSubcat = state.activeSubcat || '';
  const buttons = [
    `<button type="button" class="k-subchip ${activeSubcat ? '' : 'active'}" data-subcat="" aria-label="Voir tous les produits ${escapeHtml(catKey)}">
      <span class="k-subchip-label">Tout voir</span>
    </button>`,
    ...subcats.map((sub) => {
      const key = escapeHtml(sub.key);
      const label = escapeHtml(sub.shortLabel || sub.label || sub.key);
      const icon = escapeHtml(sub.icon || '✨');
      const active = activeSubcat === sub.key ? ' active' : '';
      return `<button type="button" class="k-subchip${active}" data-subcat="${key}">
        <span class="k-subchip-icon" aria-hidden="true">${icon}</span>
        <span class="k-subchip-label">${label}</span>
      </button>`;
    }),
  ].join('');

  wrap.innerHTML = `
    <div class="k-subcats-rail k-desktop-rayons-rail k-subcats-visible" data-cat-label="${escapeHtml(catKey)}">
      ${buttons}
    </div>
  `;

  wrap.querySelectorAll('.k-subchip').forEach((chip) => {
    chip.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const subcat = chip.dataset.subcat || null;
      state.activeSubcat = subcat || null;
      renderSubcatRail(catKey);
      renderGrid();
      scrollToCatalog();
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
    renderSubcatRail(null);
    scrollPageToTop('smooth');
    return;
  }

  if (state.activeCat === 'all') {
    syncRailActiveState(cat, { center: true });
    state.activeSubcat = null;
    setActiveCat(cat);
    renderSubcatRail(cat);
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
  renderSubcatRail(cat);
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
