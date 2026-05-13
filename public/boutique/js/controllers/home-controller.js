/**
 * @module home-controller
 * @brief Orchestration home/categories sans changer l'experience Komerce.
 */

import { state, dom, $$, setActiveCatState } from '../b-store.js';
import { renderCategoryRailMarkup } from '../render/render-categories.js';
import { getSubcategories, getRailCategoryKeys } from '../shop-schema.js';
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
  wrap.dataset.parentCat = catKey;  // ciblage CSS couleur catégorie active
  wrap.dataset.parentCat = catKey;
  wrap.style.display = 'block';

  // Compteur produits — injecté à droite du rail
  (function() {
    var rail = wrap.querySelector('.k-subcats-rail');
    if (!rail) return;
    var existing = wrap.querySelector('.k-subcat-count');
    if (existing) existing.remove();
    var total = (window._shopProducts || []).filter(function(p) {
      return p.category === catKey || (p.dbCategory && p.dbCategory === catKey);
    }).length;
    if (total > 0) {
      var counter = document.createElement('span');
      counter.className = 'k-subcat-count';
      counter.textContent = total + ' article' + (total > 1 ? 's' : '');
      wrap.appendChild(counter);
    }
  }());

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
      // Bug 10 fix : import statique en tête de fichier — plus d'import() dynamique avec risque de race condition
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

  // FOUC fix : si les chips statiques HTML sont déjà en sync avec le schéma,
  // on évite le innerHTML (qui vide puis réécrit le DOM → flash visuel).
  const expectedKeys  = getRailCategoryKeys();
  const existingChips = Array.from(catsEl.querySelectorAll('.k-chip'));
  const alreadyInSync =
    existingChips.length === expectedKeys.length &&
    existingChips.every((chip, i) => chip.dataset.cat === expectedKeys[i]);

  if (!alreadyInSync) {
    catsEl.innerHTML = renderCategoryRailMarkup(state.activeCat);
  }

  return catsEl;
}

/** Met à jour l'état actif de la sidebar desktop (sans toucher au mobile). */
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
    // FIX audit 3.2 : renderGrid monte le pager dans un requestAnimationFrame.
    // On doit attendre la prochaine frame avant de tester pagerActive / lire offsetLeft.
    requestAnimationFrame(() => handleCategorySelection(cat, deps));
    return;
  }

  // Mode pager actif : scroll vers la page existante, pas de renderGrid
  const pageScroll = dom.pageScroll;
  const pagerActive = window.innerWidth < 900
    && pageScroll
    && pageScroll.classList.contains('k-pager-active')
    && document.getElementById('k-grid')?.classList.contains('k-grid-cat-pager');

  if (pagerActive) {
    // Mutation sans renderGrid — le pager gère déjà l'affichage via scrollPagerToCat.
    setActiveCatState(cat);
    syncRailActiveState(cat, { center: true });
    const scrolled = scrollPagerToCat(cat);
    if (scrolled) return;
    // Fallback : page absente du pager (ex: catégorie sans produits) → renderGrid classique
  }

  if (cat === 'all') {
    if (state.activeCat === 'all') {
      scrollPageToTop('smooth');
      return;
    }
    syncRailActiveState('all', { center: true });
    state.sectionSubcats = {};
    // setActiveCat émet catalog:cat-changed → b-catalog.js listener gère renderSubcatRail + sidebar sync
    setActiveCat('all');
    scrollPageToTop('smooth');
    return;
  }

  if (state.activeCat === 'all') {
    syncRailActiveState(cat, { center: true });
    // setActiveCat émet catalog:cat-changed → b-catalog.js listener gère renderSubcatRail + sidebar sync
    setActiveCat(cat);
    scrollPageToTop('smooth');
    return;
  }

  if (cat === state.activeCat) {
    if (window.innerWidth >= 900) {
      // Même catégorie re-cliquée : setActiveCat n'est pas appelé, pas de bus event
      // → appel direct nécessaire ici (seul endroit légitime)
      renderSubcatRail(cat);
      scrollToCatalog();
      return;
    }

    syncRailActiveState('all', { center: true });
    state.sectionSubcats = {};
    setActiveCat('all');
    scrollPageToTop('smooth');
    return;
  }

  syncRailActiveState(cat, { center: true });
  // setActiveCat émet catalog:cat-changed → b-catalog.js listener gère renderSubcatRail + sidebar sync
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

  // FIX balayage instable : on ne pose PAS de second listener "click" délégué
  // ici, ni dans b-catalog#setupCatSwipeNav. handleCategorySelection appelle
  // syncRailActiveState(cat, { center: true }) qui centre déjà la chip via
  // centerRailChip. Avoir 2 ou 3 RAF de centrage en parallèle créait des
  // sursauts visuels et des chips non centrées franchement.

  const activeChip = catsEl.querySelector('.k-chip.active');
  if (activeChip) centerRailChip(activeChip);
}
