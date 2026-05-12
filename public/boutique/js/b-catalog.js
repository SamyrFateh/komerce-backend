/**
 * b-catalog.js — Module ES · §4 CATALOG + §6 GRID SECTIONS + §8 CATS & SEARCH
 *
 * Refactorisé v3 :
 *   - _normalizeCat       → normalizeCategoryKey (shop-schema.js)
 *   - _renderCard         → renderProductCard    (render/render-product-card.js)
 *   - _renderGridWithSections → renderHomeSections (render/render-home-sections.js)
 *
 * Ce module conserve uniquement :
 *   - La logique de pagination / filtrage (state)
 *   - Le binding des événements (clicks, scroll, pager)
 *   - La recherche
 *   - Le scroll vers les sections
 */

import { bus }           from './b-bus.js';
import {
  state, dom, $, $$, PAGE_SIZE, scroll,
}                         from './b-store.js';
import {
  optimizeImgUrl, sanitize, promoImgUrl, fmt, fmtPrice,
  productEmoji, _currency, _rates,
  renderProductCarousel, bindCarouselDots,
}                         from './b-utils.js';
import {
  showToast, cartQty, updateCartBadge, isFav,
}                         from './b-cart-core.js';
import {
  renderCartBody,
  toggleFav, quickAdd, quickRemove, markAllCartButtons,
  pruneObsoleteCart,
}                         from './b-cart.js';
import {
  initFlatSubcat, renderSubcatChips,
}                              from './b-subcat.js';
import {
  _setupFlatSubcatPager, _renderFlatSubcat,
  _mountFlatSubcatChrome, _unmountFlatSubcatChrome,
  _bindFlatSubcatControls, _recalcPagerHeight,
}                              from './b-subcat.js';
import {
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
  destroyMobilePager,
}                         from './b-pager.js';
import { openModal }      from './b-modal.js';
import {
  normalizeCategoryKey,
  getSectionOrder,
  getCategorySectionEmoji,
  getSubcategories,
}                         from './shop-schema.js';
import { renderProductCard }  from './render/render-product-card.js';
import { renderHomeSections } from './render/render-home-sections.js';
import {
  setupHomeController as _setupHomeController,
  centerRailChip       as _centerRailChip,
  renderSubcatRail     as _renderSubcatRail,
  syncDesktopSidebar   as _syncDesktopSidebar,
} from './controllers/home-controller.js';
import { isDesktop, clearInlinePagerStyles, ensureDesktopScrollOwner, scrollPageToTop, scrollPageToElement } from './b-scroll-owner.js';
import {
  setProducts, getAllProducts, getPromoProducts,
}                             from './product-store.js';

'use strict';

// _normalizeCat → délégué à shop-schema (source unique de vérité)
const _normalizeCat = normalizeCategoryKey;

// Pager → catalog : centrer la chip active (découplage circulaire)
bus.on('chip:center', function(chip) { centerActiveChip(chip); });

// Fix: écouter catalog:cat-changed émis par b-desktop-upgrade.js (merch cards, promo strip)
// pour synchroniser le rail de chips ET la sidebar desktop.
// Catégories sans sidebar (navigation externe type Shein, etc.)
var _NO_SIDEBAR_CATS = ['Shein', 'shein', 'SHEIN'];

function _toggleSidebarForCat(cat) {
  var sidebarEl = document.getElementById('k-desktop-sidebar');
  if (!sidebarEl) return;
  var hide = _NO_SIDEBAR_CATS.indexOf(cat) !== -1;
  sidebarEl.style.display = hide ? 'none' : '';
}

bus.on('catalog:cat-changed', function(cat) {
  // Sync chip rail
  $$('.k-chip').forEach(function(c) {
    c.classList.toggle('active', c.dataset.cat === cat);
  });
  var chip = document.querySelector('.k-chip[data-cat="' + cat + '"]');
  if (chip) centerActiveChip(chip);
  // Sync sidebar desktop + masquage pour catégories externes (ex: Shein)
  _toggleSidebarForCat(cat);
  document.querySelectorAll('.k-sidebar-cat').forEach(function(item) {
    item.classList.toggle('is-active', item.dataset.cat === cat);
  });
  // Sync pavillons — état actif via .is-active (CSS outline coral)
  document.querySelectorAll('[data-pav-cat]').forEach(function(tile) {
    tile.classList.toggle('is-active', tile.dataset.pavCat === cat);
  });
  // Bug 2 fix : mettre à jour le rail de sous-catégories (desktop uniquement)
  if (isDesktop()) {
    _renderSubcatRail(cat);
  }
});


// ╔══════════════════════════════════════════════════════════════════╗
// ║  §4 · CATALOG — Promos, grille, pagination, shuffle             ║
// ╚══════════════════════════════════════════════════════════════════╝

/**
 * Charge la page suivante de produits (scroll infini — desktop).
 */
function appendNextPage() {
  const spinner = document.getElementById('k-load-more-spinner');

  if (state.flatSubcat && !isDesktop()) {
    if (spinner) spinner.classList.remove('show');
    return;
  }

  // FIX bug "cartes géantes" : en mode sections (display:block), insérer des
  // .k-card directement enfants de #k-grid les fait s'étirer pleine largeur
  // avec aspect-ratio 1/1 → image gigantesque. Le rendu sections est déjà
  // exhaustif (_balancedPick), donc rien à appendre dans ce cas.
  if (dom.grid && dom.grid.classList.contains('k-grid-has-sections')) {
    if (spinner) spinner.classList.remove('show');
    return;
  }

  let list = state.activeCat === 'all'
    ? state.filtered
    : state.activeCat === 'Soldes'
      ? state.filtered.filter(p => (p.promo_pct || 0) > 0)
      : state.filtered.filter(p => _normalizeCat(p.category) === state.activeCat);
  if (state.activeSubcat) {
    const subF = list.filter(p => p.subcategory === state.activeSubcat);
    if (subF.length > 0) list = subF;
  }
  const start = (state.page + 1) * state.pageSize;
  if (start >= list.length) {
    if (spinner) spinner.classList.remove('show');
    return;
  }
  state.page += 1;
  const nextItems = list.slice(start, start + state.pageSize);
  const fragment = nextItems.map(p => renderProductCard(p)).join('');
  dom.grid.insertAdjacentHTML('beforeend', fragment);

  // bindCarouselDots reste par-carte (touch listeners). Les clicks fav/add/card
  // sont gérés par la délégation installée par _bindGridEvents.
  _installGridDelegation();
  dom.grid.querySelectorAll('.k-card:not([data-bound])').forEach(card => {
    card.dataset.bound = '1';
    bindCarouselDots(card);
  });
  if (spinner) spinner.classList.remove('show');
}

/* ── LOAD PRODUCTS ──────────────────────────────────────────────── */

async function loadProducts() {
  // Charger via product-store (source unique — cache + normalisation)
  let products;
  try {
    if (typeof K === 'undefined' || !K.products) throw new Error('K non disponible');
    const data = await K.products.list({ limit: 1000 });
    const raw = (Array.isArray(data) ? data : data.products || []).filter(p => p.is_available !== false);
    products = setProducts(raw);           // product-store normalise + met en cache
  } catch (e) {
    console.warn('[loadProducts] API KO → fallback cache product-store');
    const cached = localStorage.getItem('komerce_products_cache');
    if (cached) {
      products = setProducts(JSON.parse(cached).filter(p => p.is_available !== false));
    } else {
      showToast('Pas de connexion', 'error');
      return;
    }
  }

  // Synchroniser state avec le store centralisé
  state.products = getAllProducts();
  state.filtered  = [...state.products];

  renderGrid();
  markAllCartButtons();

  // Badge favoris en promo
  try {
    const promoFavs = state.products.filter(p => state.favs.includes(p.id) && (p.promo_pct || 0) > 0);
    if (typeof updateFavPromoBadge === 'function') updateFavPromoBadge(promoFavs.length);
  } catch(e) { console.warn('[fav-promo-badge]', e.message); }

  // Nettoyer le panier des produits obsolètes
  const validIds = new Set(state.products.map(p => String(p.id)));
  const before = state.cart.length;
  pruneObsoleteCart(validIds);
  const removed = before - state.cart.length;
  if (removed > 0) {
    showToast(`${removed} produit${removed > 1 ? 's' : ''} obsolète${removed > 1 ? 's' : ''} retiré${removed > 1 ? 's' : ''} du panier`, 'info');
  }
}

/* ── RENDER PROMOS ──────────────────────────────────────────────── */

function renderPromos() {
  const promos = state.products.filter(p => p.promo_pct > 0).slice(0, 10);
  const promoSection = document.getElementById('k-promos-section');
  if (promoSection) {
    if (promos.length === 0) { promoSection.setAttribute('data-empty', '1'); return; }
    promoSection.removeAttribute('data-empty');
  }

  dom.promoRail.innerHTML = promos.map(p => {
    const oldPrice = Math.round(p.price_kmf / (1 - p.promo_pct / 100));
    return `
      <div class="k-promo-card" data-id="${p.id}">
        <img class="k-promo-card-img" src="${promoImgUrl(p.image_url, 400)}" alt="${sanitize(p.name)}" loading="lazy" decoding="async">
        <span class="k-promo-badge">-${p.promo_pct}%</span>
        <div class="k-promo-card-info">
          <div class="k-promo-card-name">${sanitize(p.name)}</div>
          <div class="k-promo-card-prices">
            <span class="k-promo-card-price">${fmtPrice(p.price_kmf)}</span>
            <span class="k-promo-card-old">${fmtPrice(oldPrice)}</span>
          </div>
        </div>
      </div>`;
  }).join('');

  const inner = document.createElement('div');
  inner.className = 'k-promo-rail-inner';
  inner.innerHTML = dom.promoRail.innerHTML + dom.promoRail.innerHTML;
  dom.promoRail.innerHTML = '';
  dom.promoRail.appendChild(inner);
  inner.addEventListener('touchstart', () => inner.style.animationPlayState = 'paused');
  inner.addEventListener('touchend',   () => inner.style.animationPlayState = 'running');
  inner.querySelectorAll('.k-promo-card').forEach(card => {
    card.addEventListener('click', () => openModal(card.dataset.id));
  });
}

/* ── RENDER GRID ────────────────────────────────────────────────── */

// _unmountFlatSubcatChrome → importée depuis b-subcat.js

// _renderCard : délégué à render-product-card.js
function _renderCard(p) {
  return renderProductCard(p);
}

/**
 * Setter centralisé pour le changement de catégorie active.
 * Garantit : state cohérent + renderGrid() + bus event en une seule passe.
 *
 * @param {string} cat  - Clé catégorie (ex: 'Mode', 'all')
 * @param {string|null} [sub=null] - Sous-catégorie active (null = toutes)
 */
export function setActiveCat(cat, sub = null) {
  state.activeCat    = cat;
  state.activeSubcat = sub;
  state.flatSubcat   = null;
  state.page         = 0;
  renderGrid();
  bus.emit('catalog:cat-changed', cat);
}

function renderGrid() {
  state.page = 0;
  const _isMobile = !isDesktop();

  // PATCH #227 step 2 — Desktop must never keep the mobile Temu pager cage.
  // Factored: clearInlinePagerStyles() (b-scroll-owner) remplace les resets inline manuels.
  // Timing intentionnel : reset pré-rendu, avant innerHTML — ne pas déplacer après.
  if (!_isMobile) {
    destroyMobilePager();
    const ps = dom.pageScroll;
    if (ps) {
      ps.classList.remove('k-pager-active');
      clearInlinePagerStyles(ps);
    }
    if (dom.grid) {
      dom.grid.classList.remove('k-grid-cat-pager', 'k-grid-flat-subcat');
      clearInlinePagerStyles(dom.grid);
    }
  }

  // ── TEMU FLAT SUBCAT MODE (mobile only) ──
  if (_isMobile && state.flatSubcat) {
    // Couper le pager principal AVANT de monter le flat subcat
    destroyMobilePager();
    dom.grid.classList.add('k-grid-has-sections', 'k-grid-flat-subcat');
    dom.grid.innerHTML = _renderFlatSubcat();
    _mountFlatSubcatChrome();
    _bindGridEvents();
    _bindFlatSubcatControls();
    var _psf = dom.pageScroll;
    if (_psf) _psf.classList.add('k-pager-active');
    _recalcPagerHeight();
    _setupFlatSubcatPager();
    return;
  }

  dom.grid.classList.remove('k-grid-flat-subcat');
  _unmountFlatSubcatChrome();

  let list = (state.activeCat === 'all' || _isMobile)
    ? state.filtered
    : state.activeCat === 'Soldes'
      ? state.filtered.filter(p => (p.promo_pct || 0) > 0)
      : state.filtered.filter(p => _normalizeCat(p.category) === state.activeCat);
  if (!_isMobile && state.activeSubcat) {
    const subF = list.filter(p => p.subcategory === state.activeSubcat);
    if (subF.length > 0) list = subF;
  }

  const useSections = state.activeCat === 'all' || _isMobile;
  let pageItems;
  if (useSections) {
    pageItems = _isMobile ? _balancedPick(list, 160) : _balancedPick(list, 48, 4);
  } else {
    pageItems = list.slice(0, state.pageSize);
  }

  if (useSections) {
    dom.grid.classList.add('k-grid-has-sections');
    // ── Déléguer le rendu des sections à render-home-sections.js ──
    dom.grid.innerHTML = renderHomeSections({
      items:             pageItems,
      allProducts:       state.filtered,
      isMobile:          _isMobile,
      renderCard:        _renderCard,
      normalizeCategory: _normalizeCat,
      shuffle:           _shuffle,
    });
    _bindGridEvents();
    if (_isMobile) {
      var _ps = dom.pageScroll;
      // Poser --pager-top/--pager-h AVANT k-pager-active (variables CSS requises
      // par le position:fixed du pager). On appelle uniquement _recalcPagerVars()
      // — pas _setupMobilePager() entier — pour ne pas attacher les scroll
      // listeners avant que _setupInfiniteLoop ait stabilisé le DOM.
      _recalcPagerVars();
      if (_ps) _ps.classList.add('k-pager-active');
      dom.grid.classList.add('k-grid-cat-pager');
      requestAnimationFrame(function() {
        _setupInfiniteLoop();      // ghost loop : clone Tout à la fin — DOIT être avant _setupMobilePager
        _setupMobilePager();       // listeners scroll/touch — DOM ghost déjà stabilisé
        _setupSectionAutoAdvance(); // bounce bas → catégorie suivante
        if (state.activeCat !== 'all') {
          setTimeout(function() { _scrollPagerToCat(state.activeCat, 'instant'); }, 80);
        }
      });
    } else {
      var _ps2 = dom.pageScroll;
      if (_ps2) _ps2.classList.remove('k-pager-active');
      dom.grid.classList.remove('k-grid-cat-pager');

      // PATCH #233 — late desktop pager cleanup
      requestAnimationFrame(function() {
        destroyMobilePager();
        ensureDesktopScrollOwner();
      });
    }
    return;
  }

  dom.grid.classList.remove('k-grid-has-sections');
  var _ps3 = dom.pageScroll;
  if (_ps3) _ps3.classList.remove('k-pager-active');

  if (!_isMobile) {
    requestAnimationFrame(function() {
      destroyMobilePager();
    });
  }

  // ── Header flat-cat (desktop, hors "all" et "Soldes") ───────────
  // Breadcrumb retour + titre catégorie + subchips, pour ne pas laisser
  // l'utilisateur bloqué dans une grille flat sans repère.
  let flatHeader = '';
  if (!_isMobile && state.activeCat && state.activeCat !== 'all') {
    const cat = state.activeCat;
    const emoji = getCategorySectionEmoji(cat) || '';
    const totalCat = list.length;
    flatHeader += '<div class="k-flatcat-header">';
    flatHeader += '<button class="k-flatcat-back" type="button" data-back-all="1" aria-label="Retour à toutes les catégories">';
    flatHeader += '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>';
    flatHeader += '<span>Toutes les catégories</span>';
    flatHeader += '</button>';
    flatHeader += '<h2 class="k-flatcat-title"><span class="k-flatcat-emoji">' + emoji + '</span>' + sanitize(cat);
    flatHeader += '<span class="k-flatcat-count">' + totalCat + '</span></h2>';
    flatHeader += '</div>';

    // Rail subchips de la catégorie active
    if (cat !== 'Soldes') {
      const schemaSubs = getSubcategories(cat) || [];
      const presentKeys = new Set(list.map(p => p.subcategory).filter(Boolean));
      const subs = schemaSubs.filter(s => presentKeys.has(s.key));
      if (subs.length >= 2) {
        const activeSub = state.activeSubcat;
        flatHeader += '<div class="k-flatcat-subcats" data-cat="' + sanitize(cat) + '">';
        flatHeader += '<button class="k-sec-subchip k-sec-subchip-all' + (activeSub ? '' : ' active') + '" type="button" data-flat-sub-all="1">Tout</button>';
        for (const s of subs) {
          const isActive = activeSub === s.key;
          flatHeader += '<button class="k-sec-subchip' + (isActive ? ' active' : '') +
            '" type="button" data-flat-sub="' + sanitize(s.key) + '">' +
            (s.icon ? '<span class="k-sec-subchip-icon">' + s.icon + '</span>' : '') +
            '<span class="k-sec-subchip-label">' + sanitize(s.label || s.key) + '</span>' +
            '</button>';
        }
        flatHeader += '</div>';
      }
    }
  }

  dom.grid.innerHTML = flatHeader + pageItems.map(p => renderProductCard(p)).join('');

  // Wire breadcrumb back
  const backBtn = dom.grid.querySelector('[data-back-all="1"]');
  if (backBtn) {
    backBtn.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      state.activeCat = 'all';
      state.activeSubcat = null;
      $$('.k-chip').forEach(c => c.classList.remove('active'));
      const allChip = document.querySelector('.k-chip[data-cat="all"]');
      if (allChip) { allChip.classList.add('active'); centerActiveChip(allChip); }
      // FIX Bug B — appels manquants : rail subcat + sidebar desktop restaient désynchronisés
      _renderSubcatRail(null);
      _syncDesktopSidebar('all');
      renderGrid();
      scrollPageToTop('smooth');
    });
  }
  // Wire flat subchips
  dom.grid.querySelectorAll('[data-flat-sub], [data-flat-sub-all]').forEach((chip) => {
    chip.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      if (chip.dataset.flatSubAll === '1') {
        state.activeSubcat = null;
      } else {
        const sub = chip.dataset.flatSub;
        state.activeSubcat = (state.activeSubcat === sub) ? null : sub;
      }
      renderGrid();
    });
  });

  _installGridDelegation();
  dom.grid.querySelectorAll('.k-card').forEach(card => bindCarouselDots(card));
}

/* ── HELPERS PAGINATION ─────────────────────────────────────────── */

function _shuffle(arr) {
  for (var i = arr.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
  }
  return arr;
}

function _balancedPick(list, pageSize, maxPerCat) {
  const MIN_PER_SECTION = 4;
  const byCat = new Map();
  const order = [];
  for (const p of list) {
    const cat = _normalizeCat(p.category) || 'Autres';
    if (!byCat.has(cat)) { byCat.set(cat, []); order.push(cat); }
    byCat.get(cat).push(p);
  }
  const rich = [];
  const thin = [];
  for (const cat of order) {
    const prods = byCat.get(cat);
    if (prods.length >= MIN_PER_SECTION) rich.push({ cat, prods });
    else thin.push(...prods);
  }
  if (thin.length >= MIN_PER_SECTION) rich.push({ cat: 'Autres', prods: thin });

  const nCats = rich.length || 1;
  const basePerCat = Math.floor(pageSize / nCats);
  let perCat = basePerCat >= 2 ? (basePerCat % 2 === 0 ? basePerCat : basePerCat - 1) : 2;
  // Cap dur si l'appelant impose un max (ex : 4 cartes/section sur la home desktop)
  if (typeof maxPerCat === 'number' && maxPerCat > 0) {
    perCat = Math.min(perCat, maxPerCat);
  }
  const flat = [];
  for (const section of rich) {
    _shuffle(section.prods);
    const take = Math.min(perCat, section.prods.length);
    const count = take >= 2 ? (take % 2 === 0 ? take : take - 1) : 0;
    for (let i = 0; i < count; i++) flat.push(section.prods[i]);
  }
  return flat;
}

/* ── GRID EVENTS ────────────────────────────────────────────────── */

// Listener délégué unique (installé une seule fois) — résout les bugs de
// re-binding manquant après re-render, doublons, ou cartes injectées plus
// tard. Couvre fav/add/dots/card-click pour tout #k-grid + tout #k-fav-grid.
let _gridDelegationInstalled = false;
function _installGridDelegation() {
  if (_gridDelegationInstalled) return;
  _gridDelegationInstalled = true;

  document.addEventListener('click', function(e) {
    // Restreint aux zones que l'on veut couvrir : #k-grid (catalogue),
    // #k-fav-grid (vue favoris), .k-cat-section (sections desktop).
    const grid = e.target.closest('#k-grid, #k-fav-grid');
    if (!grid) return;

    const card = e.target.closest('.k-card');
    if (!card) return;

    // FAV ────────────────────────────────────────────────────────
    const favBtn = e.target.closest('.k-card-fav');
    if (favBtn) {
      e.preventDefault();
      e.stopPropagation();
      const id = favBtn.dataset.fav || card.dataset.id;
      if (id) toggleFav(id, favBtn);
      return;
    }

    // ADD / STEPPER ──────────────────────────────────────────────
    const addBtn = e.target.closest('.k-card-add');
    if (addBtn) {
      e.preventDefault();
      e.stopPropagation();
      const id = addBtn.dataset.add || card.dataset.id;
      if (!id) return;
      if (e.target.closest('.k-add-minus')) quickRemove(id, addBtn);
      else quickAdd(id, addBtn);
      return;
    }

    // DOTS / TAB → on ignore (laisse le carousel gérer)
    if (e.target.closest('.k-card-tab') || e.target.closest('.k-card-dots')) return;

    // Click sur la carte → ouvrir modal (sauf après swipe)
    if (card.dataset.justSwiped === '1') return;
    if (card.dataset.id) openModal(card.dataset.id);
  });
}

function _bindGridEvents() {
  _installGridDelegation();

  // bindCarouselDots reste par-carte (touch listeners spécifiques au DOM)
  dom.grid.querySelectorAll('.k-card').forEach(card => bindCarouselDots(card));

  dom.grid.querySelectorAll('.k-sec-see-all').forEach(btn => {
    if (btn.dataset.bound === '1') return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      const cat = btn.dataset.seeCat;
      if (!cat) return;
      state.activeCat = cat;
      state.activeSubcat = null;
      $$('.k-chip').forEach(c => c.classList.remove('active'));
      const chip = document.querySelector('.k-chip[data-cat="' + cat + '"]');
      if (chip) { chip.classList.add('active'); centerActiveChip(chip); }
      renderGrid();
      // Fix: sync subcats rail + sidebar desktop (était absent → orphelins desktop)
      _toggleSidebarForCat(cat);
      if (isDesktop()) {
        import('./controllers/home-controller.js').then(function(m) {
          m.renderSubcatRail(cat);
        });
        document.querySelectorAll('.k-sidebar-cat').forEach(function(item) {
          item.classList.toggle('is-active', item.dataset.cat === cat);
        });
      }
      scrollPageToTop('smooth');
    });
  });
  if (typeof _renderFloatingIndex === 'function') _renderFloatingIndex();
}

/* ── SCROLL VERS SECTION ────────────────────────────────────────── */

export function scrollToCategorySection(cat) {
  if (!isDesktop() && dom.pageScroll &&
      dom.pageScroll.classList.contains('k-pager-active')) {
    if (!cat || cat === 'all') {
      var _g = document.getElementById('k-grid');
      if (_g) _g.scrollTo({ left: 0, behavior: 'smooth' });
    } else {
      _scrollPagerToCat(cat);
    }
    return;
  }
  if (!cat || cat === 'all') {
    scrollPageToTop('smooth');
    return;
  }
  var anchorId = 'k-sec-' + cat.replace(/[^a-zA-Z0-9]/g, '-');
  var el = document.getElementById(anchorId);
  if (!el) return;
  scroll.scrollingToSection = true;
  scrollPageToElement(el, -8, 'smooth');
  setTimeout(function() { scroll.scrollingToSection = false; }, 700);
}

/* ── CATS & SEARCH ──────────────────────────────────────────────── */

function setupCats() {
  // Délégué à home-controller.js (source unique des interactions catégories)
  _setupHomeController({
    renderGrid,
    scrollPagerToCat:       _scrollPagerToCat,
    scrollToCategorySection,
  });
}

function centerActiveChip(chip) {
  // FIX vérité unique : délégué à home-controller#centerRailChip.
  // Avant : duplication à l'identique → maintenance double et risque de drift.
  // Le bus 'chip:center' (ligne 72), syncRailActiveState et l'appel direct
  // depuis b-cart passent tous par cette même fonction.
  return _centerRailChip(chip);
}

function setupCatSwipeNav() {
  // FIX balayage instable : ne plus poser de listener click ici.
  // setupHomeController fait déjà la sélection + centrage via
  // syncRailActiveState(cat, { center: true }) → centerRailChip.
  // Empilement précédent : 1 listener par chip + 1 délégué ici + le bus
  // 'chip:center' → centerActiveChip = 3 RAF de scrollTo concurrents.
  // Conservé comme no-op pour ne pas casser les imports.
}

function setupSearch() {
  dom.searchInput.addEventListener('input', () => {
    clearTimeout(state.searchTimeout);
    const q = dom.searchInput.value.trim().toLowerCase();
    if (q.length < 2) {
      dom.searchDrop.classList.remove('open');
      // Fix: restaurer les produits de la catégorie active (pas tout le catalogue)
      state.filtered = (state.activeCat && state.activeCat !== 'all' && isDesktop())
        ? state.products.filter(p => _normalizeCat(p.category) === state.activeCat)
        : [...state.products];
      renderGrid();
      return;
    }
    state.searchTimeout = setTimeout(() => {
      // Fix: sur desktop avec une catégorie active, recherche dans la cat courante
      const pool = (isDesktop() && state.activeCat && state.activeCat !== 'all')
        ? state.products.filter(p => _normalizeCat(p.category) === state.activeCat)
        : state.products;
      const results = pool.filter(p =>
        p.name.toLowerCase().includes(q) ||
        (p.category || '').toLowerCase().includes(q) ||
        (p.description || '').toLowerCase().includes(q)
      );
      state.filtered = results;
      renderGrid();
      renderSearchDropdown(results.slice(0, 8));
    }, 250);
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.k-search')) dom.searchDrop.classList.remove('open');
  });
}

function renderSearchDropdown(results) {
  if (!results.length) {
    dom.searchDrop.innerHTML = '<div class="k-search-empty">Aucun résultat</div>';
    dom.searchDrop.classList.add('open');
    return;
  }
  dom.searchDrop.innerHTML = results.map(p => `
    <div class="k-search-item" data-id="${p.id}">
      <img src="${optimizeImgUrl(p.image_url, 80)}" alt="${sanitize(p.name)}" loading="lazy" decoding="async">
      <div class="k-search-item-info">
        <div class="k-search-item-name">${sanitize(p.emoji || '')} ${sanitize(p.name)}</div>
        <div class="k-search-item-price">${fmtPrice(p.price_kmf)}</div>
      </div>
    </div>
  `).join('');
  dom.searchDrop.classList.add('open');
  dom.searchDrop.querySelectorAll('.k-search-item').forEach(item => {
    item.addEventListener('click', () => {
      openModal(item.dataset.id);
      dom.searchDrop.classList.remove('open');
      dom.searchInput.value = '';
    });
  });
}

export {
  renderPromos, renderGrid, appendNextPage,
  setupCats, setupCatSwipeNav, centerActiveChip, setupSearch,
  loadProducts, _renderCard,
};
export { setupCats as initCats, setupSearch as initSearch };
