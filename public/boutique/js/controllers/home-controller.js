/**
 * @module home-controller
 * @brief Orchestration home/categories sans changer l'experience Komerce.
 */

import { state, $$ } from '../b-store.js';
import { renderCategoryRailMarkup } from '../render/render-categories.js';

function getCatsEl() {
  return document.getElementById('k-cats');
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
  catsEl.innerHTML = renderCategoryRailMarkup(state.activeCat);
  return catsEl;
}

function handleCategorySelection(cat, deps) {
  const { renderGrid, scrollPagerToCat, scrollToCategorySection } = deps;

  if (state.flatSubcat) {
    state.flatSubcat = null;
    renderGrid();
  }

  if (cat === 'all') {
    if (state.activeCat === 'all') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    syncRailActiveState('all', { center: true });
    state.activeCat = 'all';
    state.activeSubcat = null;
    state.sectionSubcats = {};
    renderGrid();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }

  if (state.activeCat === 'all') {
    syncRailActiveState(cat, { center: true });
    scrollToCategorySection(cat);
    return;
  }

  if (cat === state.activeCat) {
    syncRailActiveState('all', { center: true });
    state.activeCat = 'all';
    state.activeSubcat = null;
    state.sectionSubcats = {};
    renderGrid();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }

  syncRailActiveState(cat, { center: true });
  state.activeCat = cat;
  state.activeSubcat = null;
  renderGrid();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

export function setupHomeController(deps) {
  const catsEl = renderCategoryRail();
  if (!catsEl) return;

  catsEl.querySelectorAll('.k-chip').forEach((chip) => {
    chip.addEventListener('click', () => handleCategorySelection(chip.dataset.cat, deps));
  });

  if (window.innerWidth < 900) {
    catsEl.addEventListener('click', function(e) {
      const chip = e.target.closest('.k-chip');
      if (!chip) return;
      requestAnimationFrame(function() { centerRailChip(chip); });
    });
  }

  const activeChip = catsEl.querySelector('.k-chip.active');
  if (activeChip) centerRailChip(activeChip);
}
