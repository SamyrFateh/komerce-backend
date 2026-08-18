/**
 * @komerce-arch
 * @role          boutique-home-navigation-controller
 * @domain        catalog
 * @layer         controller
 * @criticality   high
 * @inputs        category_clicks, chip_state, viewport, render_callbacks
 * @outputs       active_category, centered_chip, subcategory_rail, home_refresh
 * @depends       b-store.js, shop-schema.js
 * @used-by       b-catalog.js, b-catalog-desktop-enhancers.js
 * @doctrine      navigation_sans_friction, categorie_souscategorie_switch_fluide, desktop_mobile_coherence
 * @impact-areas  home-navigation, category-rail, product-discovery, desktop-catalog
 * @version       2026-06
 */
'use strict';

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
import { getSubcategories, getRailCategories, getCategorySectionEmoji, getCategoryLabel } from '../shop-schema.js';
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
  if (!catalog) return;
  // Calcule l'offset dynamiquement depuis la hauteur réelle de la barre sticky
  // (chips .k-hero-cats-sticky + subcats #k-subcats-wrap) pour ne pas masquer
  // le premier produit ni faire disparaître la barre du champ visuel.
  const stickyBar = document.querySelector('.k-hero-cats-sticky');
  const subcatsWrap = document.getElementById('k-subcats-wrap');
  const barH = (stickyBar ? stickyBar.getBoundingClientRect().height : 0)
             + (subcatsWrap && subcatsWrap.style.display !== 'none'
                ? subcatsWrap.getBoundingClientRect().height : 0);
  const offset = -(barH + 12); // 12px d'air sous la barre
  scrollPageToElement(catalog, offset, 'smooth');
}

/**
 * Surface contextuelle desktop UNIQUE sous les grandes pastilles imagées.
 *
 * Doctrine desktop retenue (NAV-DESKTOP — consolidation 1 surface) :
 * - le rail principal choisit l'univers ;
 * - #k-subcats-wrap porte le contexte de l'univers ;
 * - le niveau 2 utilise désormais des objets visuels légers
 *   (slot image/emoji + petit libellé) plutôt que des pills pleines ;
 * - il reste visible en haut au scroll ;
 * - b-catalog.js ne rend pas de doublon dans la grille.
 *
 * Source unique : shop-schema.js (toutes les sous-cats, modifiables sans code).
 * Owner : home-controller.js (« subcats desktop + active state »).
 * Mobile reste inchangé : early return, aucune participation au pager mobile.
 *
 * Contrat de transition : les classes historiques k-subcats-* / k-subchip
 * restent présentes pour le comportement et les invariants existants ; les
 * classes k-subcutout-* ajoutent uniquement la nouvelle présentation.
 *
 * @param {string|null} catKey  Univers actif ('all'/null = barre masquée).
 * @param {{count?:number}} [opts]  Compteur produits de l'univers.
 */
export function renderSubcatRail(catKey, opts = {}) {
  if (!isDesktop()) return;

  const wrap = document.getElementById('k-subcats-wrap');
  if (!wrap) return;

  if (!catKey || catKey === 'all') {
    wrap.style.display = 'none';
    wrap.innerHTML = '';
    delete wrap.dataset.parentCat;
    delete wrap.dataset.catCount;
    document.documentElement.style.removeProperty('--sidebar-top');
    return;
  }

  let count = null;
  if (opts && opts.count != null) {
    count = opts.count;
    wrap.dataset.catCount = String(count);
  } else if (wrap.dataset.catCount) {
    count = Number(wrap.dataset.catCount);
  }

  wrap.style.display = '';
  wrap.dataset.parentCat = catKey;

  const label = getCategoryLabel(catKey) || catKey;
  const emoji = getCategorySectionEmoji(catKey) || '';
  const subcats = getSubcategories(catKey) || [];
  const activeSubcat = state.activeSubcat || '';

  const header = `
    <div class="k-subcats-context k-subcutout-context" data-cat-label="${escapeHtml(catKey)}">
      <button type="button" class="k-subcats-back k-subcutout-back" data-back-all="1" aria-label="Retour à toutes les catégories">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
        <span>Toutes les catégories</span>
      </button>
      <span class="k-subcats-title k-subcutout-title">
        ${emoji ? `<span class="k-subcats-emoji k-subcutout-emoji" aria-hidden="true">${escapeHtml(emoji)}</span>` : ''}
        <span class="k-subcats-name k-subcutout-name">${escapeHtml(label)}</span>
        ${count != null ? `<span class="k-subcats-count k-subcutout-count">${count}</span>` : ''}
      </span>
    </div>`;

  let rail = '';
  if (subcats.length) {
    const buttons = [
      `<button type="button" class="k-subchip k-subcutout ${activeSubcat ? '' : 'active'}" data-subcat="" aria-label="Voir tous les produits ${escapeHtml(label)}">
        <span class="k-subcutout-icon k-subcutout-icon--all" aria-hidden="true">✦</span>
        <span class="k-subchip-label k-subcutout-label">Tout voir</span>
      </button>`,
      ...subcats.map((sub) => {
        const key = escapeHtml(sub.key);
        const lbl = escapeHtml(sub.shortLabel || sub.label || sub.key);
        const icon = escapeHtml(sub.icon || '✨');
        const active = activeSubcat === sub.key ? ' active' : '';
        return `<button type="button" class="k-subchip k-subcutout${active}" data-subcat="${key}">
          <span class="k-subchip-icon k-subcutout-icon" aria-hidden="true">${icon}</span>
          <span class="k-subchip-label k-subcutout-label">${lbl}</span>
        </button>`;
      }),
    ].join('');
    rail = `<div class="k-subcats-rail k-subcutout-rail k-desktop-rayons-rail k-subcats-visible" data-cat-label="${escapeHtml(catKey)}">${buttons}</div>`;
  }

  wrap.innerHTML = header + rail;

  const backBtn = wrap.querySelector('[data-back-all="1"]');
  if (backBtn) {
    backBtn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      syncRailActiveState('all', { center: false });
      setActiveCat('all');
      scrollPageToTop('smooth');
    });
  }

  wrap.querySelectorAll('.k-subchip').forEach((chip) => {
    chip.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const next = chip.dataset.subcat || null;
      state.activeSubcat = (next && state.activeSubcat === next) ? null : next;
      renderSubcatRail(catKey);
      renderGrid();
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
    delete catsEl.dataset.bound;
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
      requestAnimationFrame(() => scrollPageToTop('smooth'));
      return;
    }
    syncRailActiveState('all', { center: true });
    state.sectionSubcats = {};
    state.activeSubcat = null;
    setActiveCat('all');
    renderSubcatRail(null);
    requestAnimationFrame(() => scrollPageToTop('smooth'));
    return;
  }

  if (state.activeCat === 'all') {
    syncRailActiveState(cat, { center: true });
    state.activeSubcat = null;
    setActiveCat(cat);
    renderSubcatRail(cat);
    requestAnimationFrame(() => window.innerWidth >= 900 ? scrollToCatalog() : scrollPageToTop('smooth'));
    return;
  }

  if (cat === state.activeCat) {
    if (window.innerWidth >= 900) {
      renderSubcatRail(cat);
      requestAnimationFrame(() => scrollToCatalog());
      return;
    }

    syncRailActiveState('all', { center: true });
    state.sectionSubcats = {};
    state.activeSubcat = null;
    setActiveCat('all');
    requestAnimationFrame(() => scrollPageToTop('smooth'));
    return;
  }

  syncRailActiveState(cat, { center: true });
  state.activeSubcat = null;
  setActiveCat(cat);
  renderSubcatRail(cat);
  requestAnimationFrame(() => window.innerWidth >= 900 ? scrollToCatalog() : scrollPageToTop('smooth'));
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
