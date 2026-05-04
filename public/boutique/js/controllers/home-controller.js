/**
 * @module home-controller
 * @brief Orchestration home/categories sans changer l'experience Komerce.
 */

import { state, $$ } from '../b-store.js';
import { renderCategoryRailMarkup } from '../render/render-categories.js';
import { getSubcategories }          from '../shop-schema.js';

function getCatsEl() {
  return document.getElementById('k-cats');
}

/**
 * Affiche/masque le rail de sous-catégories sous les chips (desktop uniquement).
 * Source unique de vérité pour #k-subcats-wrap.
 */
export function renderSubcatRail(catKey) {
  if (window.innerWidth < 900) return;
  const wrap = document.getElementById('k-subcats-wrap');
  if (!wrap) return;

  const subs = catKey && catKey !== 'all' ? getSubcategories(catKey) : [];
  if (!subs.length) {
    wrap.style.display = 'none';
    wrap.innerHTML = '';
    // Fix: reset sidebar-top quand les subcats sont masquées
    document.documentElement.style.removeProperty('--sidebar-top');
    return;
  }

  const activeSub = state.activeSubcat || null;
  wrap.innerHTML =
    '<div class="k-subcats-rail k-subcats-visible">' +
      '<button class="k-subchip' + (!activeSub ? ' active' : '') + '" data-subcat="">' +
        '<span class="k-subchip-label">Tout</span>' +
      '</button>' +
      subs.map(s =>
        '<button class="k-subchip' + (activeSub === s.key ? ' active' : '') + '" data-subcat="' + s.key + '">' +
          (s.icon ? '<span class="k-subchip-icon">' + s.icon + '</span>' : '') +
          '<span class="k-subchip-label">' + s.label + '</span>' +
        '</button>'
      ).join('') +
    '</div>';
  wrap.style.display = 'block';

  // Fix: mettre à jour --sidebar-top pour que la sidebar reste sous le rail subcats
  requestAnimationFrame(function() {
    var wrapH = wrap.offsetHeight || 50;
    var headerH = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--header-h')) || 76;
    // chips shell ≈ 58px (chips + padding), puis subcats wrap
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
      import('../b-catalog.js').then(m => {
        m.renderGrid();
        const catalog = document.getElementById('k-catalog-section');
        if (catalog) {
          const top = catalog.getBoundingClientRect().top + window.scrollY - 130;
          window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
        }
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
  catsEl.innerHTML = renderCategoryRailMarkup(state.activeCat);
  return catsEl;
}

/** Met à jour l'état actif de la sidebar desktop (sans toucher au mobile). */
function syncDesktopSidebar(catKey) {
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
  }

  // Mode pager actif : scroll vers la page existante, pas de renderGrid
  const pageScroll = document.getElementById('k-page-scroll');
  const pagerActive = window.innerWidth < 900
    && pageScroll
    && pageScroll.classList.contains('k-pager-active')
    && document.getElementById('k-grid')?.classList.contains('k-grid-cat-pager');

  if (pagerActive) {
    state.activeCat    = cat;
    state.activeSubcat = null;
    syncRailActiveState(cat, { center: true });
    scrollPagerToCat(cat);
    return;
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
    if (window.innerWidth >= 900) {
      renderSubcatRail(null);
      syncDesktopSidebar('all');
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }

  if (state.activeCat === 'all') {
    syncRailActiveState(cat, { center: true });
    if (window.innerWidth < 900) {
      // Mobile : filtrer la grille ET scroller en haut
      state.activeCat = cat;
      state.activeSubcat = null;
      renderGrid();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      // Desktop : filtrer la grille sur cette catégorie, afficher subcats, sync sidebar
      state.activeCat = cat;
      state.activeSubcat = null;
      renderGrid();
      renderSubcatRail(cat);
      syncDesktopSidebar(cat);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    return;
  }

  if (cat === state.activeCat) {
    syncRailActiveState('all', { center: true });
    state.activeCat = 'all';
    state.activeSubcat = null;
    state.sectionSubcats = {};
    renderGrid();
    if (window.innerWidth >= 900) {
      renderSubcatRail(null);
      syncDesktopSidebar('all');
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }

  syncRailActiveState(cat, { center: true });
  state.activeCat = cat;
  state.activeSubcat = null;
  renderGrid();
  if (window.innerWidth >= 900) {
    renderSubcatRail(cat);
    syncDesktopSidebar(cat);
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

export function setupHomeController(deps) {
  const catsEl = renderCategoryRail();
  if (!catsEl) return;

  catsEl.querySelectorAll('.k-chip').forEach((chip) => {
    chip.addEventListener('click', () => handleCategorySelection(chip.dataset.cat, deps));
  });

  // FIX balayage instable : on ne pose PAS de second listener "click" délégué
  // ici, ni dans b-catalog#setupCatSwipeNav. handleCategorySelection appelle
  // syncRailActiveState(cat, { center: true }) qui centre déjà la chip via
  // centerRailChip. Avoir 2 ou 3 RAF de centrage en parallèle créait des
  // sursauts visuels et des chips non centrées franchement.

  const activeChip = catsEl.querySelector('.k-chip.active');
  if (activeChip) centerRailChip(activeChip);
}
