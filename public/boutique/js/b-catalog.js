/**
 * @komerce-arch
 * @role          boutique-catalog-renderer
 * @domain        catalog
 * @layer         ui-component
 * @criticality   high
 * @inputs        products, active_category, active_subcategory, search, pagination
 * @outputs       product_grid, home_sections, category_state
 * @depends       b-store.js, b-subcat.js, b-pager.js, b-modal.js, shop-schema.js, render/render-product-card.js, render/render-home-sections.js, product-store.js
 * @used-by       boutique.js, b-desktop-sidebar.js, b-subcat.js, b-nav.js
 * @doctrine      boutique_canal_decouverte, categorie_souscategorie_switch_fluide, navigation_sans_friction
 * @impact-areas  product-discovery, category-navigation, modal-entry, side-cart-layout
 * @version       2026-06
 */
'use strict';

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
  optimizeImgUrl, sanitize, promoImgUrl, fmt, fmtPrice, productImageFallbackAttr,
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
  matchesSubcategory,
}                         from './shop-schema.js';
import { renderProductCard }  from './render/render-product-card.js';
import { renderHomeSections } from './render/render-home-sections.js';
import {
  setupHomeController  as _setupHomeController,
  centerRailChip       as _centerRailChip,
  renderSubcatRail     as _renderSubcatRail,
} from './controllers/home-controller.js';
import { isDesktop, clearInlinePagerStyles, ensureDesktopScrollOwner, scrollPageToTop, scrollPageToElement } from './b-scroll-owner.js';
import {
  setProducts, getAllProducts, getPromoProducts, writeCache,
}                             from './product-store.js';

'use strict';

// _normalizeCat → délégué à shop-schema (source unique de vérité)
const _normalizeCat = normalizeCategoryKey;

// Pager → catalog : centrer la chip active (découplage circulaire)
bus.on('chip:center', function(chip) { centerActiveChip(chip); });

// REF-2026-07d : bus.on('cat:select', ...) retiré — son seul émetteur était
// le bouton "Voir les N autres dans [catégorie]" de la recherche interne
// modale, supprimée avec toute la fonctionnalité (barre inline + dropdown +
// récents + vocal). Plus aucun code n'émet cat:select. Événement déplacé
// dans le cimetière JSDoc de b-bus.js. Si le besoin de découplage circulaire
// (BUG-M4) revient, réémettre via bus.emit('cat:select', cat) suffit — le
// listener ci-dessus n'a rien à faire de plus que setActiveCat(cat).

// Fix: écouter catalog:cat-changed émis par b-desktop-upgrade.js (merch cards, promo strip)
// pour synchroniser le rail de chips desktop.
bus.on('catalog:cat-changed', function(cat) {
  // Sync chip rail
  $$('.k-chip').forEach(function(c) {
    c.classList.toggle('active', c.dataset.cat === cat);
  });
  let chip = document.querySelector('.k-chip[data-cat="' + cat + '"]');
  if (chip) centerActiveChip(chip);
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
/* Réserve de hauteur catalogue (desktop) : pose/retire k-cat-has-more sur
   #k-catalog-section. Tant qu'il reste des pages à charger, le CSS réserve le
   viewport → le footer ne surgit pas en plein scroll infini (anti-saut). */
function _setCatHasMore(hasMore) {
  const sec = document.getElementById('k-catalog-section');
  if (sec) sec.classList.toggle('k-cat-has-more', !!hasMore);
}

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
    list = list.filter(p => matchesSubcategory(state.activeCat, state.activeSubcat, p.subcategory));
  }
  const start = (state.page + 1) * state.pageSize;
  if (start >= list.length) {
    if (spinner) spinner.classList.remove('show');
    _setCatHasMore(false);            // pager épuisé → libère la réserve de hauteur
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
  _setCatHasMore((state.page + 1) * state.pageSize < list.length); // reste-t-il des pages ?
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
    writeCache(raw);                       // FIX BUG-C2 : persistance offline
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

  // Re-sync le rail de chips avec l'ordre DB : le schema async peut s'être résolu
  // après le premier renderCategoryRail() synchrone du boot (race condition).
  // setupCats() re-rend les chips ET repose les listeners de click si le HTML a changé.
  setupCats();

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
    const divisor = 1 - p.promo_pct / 100;
    const oldPrice = divisor > 0 ? Math.round(p.price_kmf / divisor) : p.price_kmf;
    return `
      <div class="k-promo-card" data-id="${p.id}">
        <img class="k-promo-card-img" src="${promoImgUrl(p.image_url, 400)}" alt="${sanitize(p.name)}" loading="lazy" decoding="async" ${productImageFallbackAttr()}>
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

/* ── ANIMATION ENTRÉE GRILLE ────────────────────────────────────
 * Pose k-grid-entering sur dom.grid pour déclencher le slide-up
 * staggeré défini dans categories.css. Retire la classe après la
 * dernière carte animée (~280ms) pour ne pas bloquer les interactions.
 * Gère aussi le micro-pop sur le chip actif.
 * ─────────────────────────────────────────────────────────────── */
function _triggerGridEnterAnim() {
  if (!dom.grid) return;
  dom.grid.classList.remove('k-grid-entering');
  void dom.grid.offsetWidth;
  dom.grid.classList.add('k-grid-entering');
  setTimeout(function() {
    if (dom.grid) dom.grid.classList.remove('k-grid-entering');
  }, 520);

  if (state.activeCat) {
    let chip = document.querySelector('.k-chip[data-cat="' + state.activeCat + '"]');
    if (chip) {
      chip.classList.remove('chip-pop');
      void chip.offsetWidth;
      chip.classList.add('chip-pop');
      chip.addEventListener('animationend', function() {
        chip.classList.remove('chip-pop');
      }, { once: true });
    }
  }
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
    _triggerGridEnterAnim();
    _mountFlatSubcatChrome();
    _bindGridEvents();
    _bindFlatSubcatControls();
    let _psf = dom.pageScroll;
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
  // Compteur univers (avant filtrage sous-cat) — alimente la barre contextuelle desktop.
  const _catCount = list.length;
  if (!_isMobile && state.activeSubcat) {
    list = list.filter(p => matchesSubcategory(state.activeCat, state.activeSubcat, p.subcategory));
  }

  const useSections = state.activeCat === 'all' || _isMobile;

  // ── RECHERCHE ACTIVE : jamais d'équilibrage ──────────────────────────────
  // _balancedPick est un sélecteur de VITRINE (éviter qu'une catégorie riche
  // écrase la home). Appliqué à un résultat de recherche, il DÉTRUIT des
  // résultats que l'utilisateur a explicitement demandés, via trois mécanismes :
  //   1. MIN_PER_SECTION=4  → une catégorie < 4 résultats part au reliquat ;
  //                           un reliquat < 4 est jeté.
  //   2. count = take%2 ? take-1 : take → tout nombre impair perd un produit
  //                           (contrainte de grille visuelle appliquée à de la
  //                           pertinence).
  //   3. take >= 2 ? ... : 0 → un résultat UNIQUE donne toujours ZÉRO.
  //
  // Mesuré en prod (969 produits, 2026-07-17) — filtre vs rendu :
  //   "chaussure" 15 trouvés → 14 rendus | "football"  10 → 8
  //   "elite"      1 trouvé  →  0 rendus | "elite pro"  1 → 0
  // Soit : plus la recherche est précise, moins le client trouve. Un client
  // cherchant le nom exact d'un produit en stock obtenait une page vide.
  //
  // On conserve le chemin de rendu (useSections pilote renderHomeSections ET
  // tout le pager mobile — le basculer casserait le scroll). On retire
  // uniquement la sélection. render-home-sections.js n'a aucun seuil de
  // section maigre : lui passer la liste entière est sûr.
  const _searching = !!(dom.searchInput && dom.searchInput.value.trim().length >= 2);

  let pageItems;
  if (useSections) {
    // Desktop : 16 par section max (4 visibles + 12 révélables via "Voir plus").
    // Mobile : inchangé.
    pageItems = _searching
      ? list
      : (_isMobile ? _balancedPick(list, 160) : _balancedPick(list, 160, 16));
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
    _triggerGridEnterAnim();
    _bindGridEvents();
    if (_isMobile) {
      let _ps = dom.pageScroll;
      // Poser --pager-top/--pager-h AVANT k-pager-active (variables CSS requises
      // par le position:fixed du pager). On appelle uniquement _recalcPagerVars()
      // — pas _setupMobilePager() entier — pour ne pas attacher les scroll
      // listeners avant que _setupInfiniteLoop ait stabilisé le DOM.
      if (_ps) _ps.classList.add('k-pager-active');
      dom.grid.classList.add('k-grid-cat-pager');
      requestAnimationFrame(function() {
        _recalcPagerVars();        // mesure APRÈS que le DOM (hero fixe + chips) soit stabilisé
        _setupInfiniteLoop();      // ghost loop : clone Tout à la fin — DOIT être avant _setupMobilePager
        _setupMobilePager();       // listeners scroll/touch — DOM ghost déjà stabilisé
        _setupSectionAutoAdvance(); // bounce bas → catégorie suivante
        if (state.activeCat !== 'all') {
          setTimeout(function() { _scrollPagerToCat(state.activeCat, 'instant'); }, 80);
        }
      });
    } else {
      let _ps2 = dom.pageScroll;
      if (_ps2) _ps2.classList.remove('k-pager-active');
      dom.grid.classList.remove('k-grid-cat-pager');

      // Univers « Tout » : aucune barre contextuelle (rail sous-cat masqué).
      _renderSubcatRail(null);

      // PATCH #233 — late desktop pager cleanup
      requestAnimationFrame(function() {
        destroyMobilePager();
        ensureDesktopScrollOwner();
      });
    }
    _setCatHasMore(false); // vue sections/accueil : pas de pager auto → plancher seul
    return;
  }

  dom.grid.classList.remove('k-grid-has-sections');
  let _ps3 = dom.pageScroll;
  if (_ps3) _ps3.classList.remove('k-pager-active');

  if (!_isMobile) {
    requestAnimationFrame(function() {
      destroyMobilePager();
    });
  }

  // ── Univers desktop (hors "all") : la barre contextuelle sticky
  //    (#k-subcats-wrap, owner home-controller.js) porte titre + compteur +
  //    sous-cats. b-catalog NE rend plus de header/subchips dans la grille
  //    (suppression du doublon — cf. ownership doctrine). La grille = cartes seules.
  if (!_isMobile && state.activeCat && state.activeCat !== 'all') {
    _renderSubcatRail(state.activeCat, { count: _catCount });
  }

  if (pageItems.length === 0) {
    // Catégorie sans produit : message au lieu d'un grand vide avant le footer.
    dom.grid.innerHTML =
      '<div class="k-sec-empty"><span class="k-sec-empty-icon">📦</span>' +
      '<span class="k-sec-empty-msg">Bientôt disponible dans cette catégorie</span></div>';
    _setCatHasMore(false);
  } else {
    dom.grid.innerHTML = pageItems.map(p => renderProductCard(p)).join('');
    // Desktop : réserve la hauteur tant que le pager (sentinel) peut charger plus.
    _setCatHasMore(!_isMobile && list.length > pageItems.length);
  }
  _triggerGridEnterAnim();
  dom.grid.querySelectorAll('.k-card').forEach(card => bindCarouselDots(card));
}

/* ── HELPERS PAGINATION ─────────────────────────────────────────── */

function _shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    let j = Math.floor(Math.random() * (i + 1));
    let tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
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
    const shuffled = _shuffle([...section.prods]);
    const take = Math.min(perCat, shuffled.length);
    const count = take >= 2 ? (take % 2 === 0 ? take : take - 1) : 0;
    for (let i = 0; i < count; i++) flat.push(shuffled[i]);
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
      if (id) {
        toggleFav(id, favBtn);
        if (grid.id === 'k-fav-grid') bus.emit('favorites:view-refresh');
      }
      return;
    }

    // ADD / STEPPER ──────────────────────────────────────────────
    const addControl = e.target.closest('.k-card-add');
    if (addControl) {
      e.preventDefault();
      e.stopPropagation();
      const id = addControl.dataset.add || card.dataset.id;
      if (!id) return;
      let actionBtn = e.target.closest('button[data-action]');
      let action = actionBtn?.dataset.action;

      // Compatibilité avec les cartes/tests historiques pendant la migration DOM :
      // le markup canonique utilise de vrais boutons data-action, mais un ancien
      // contrôle vide ou un span .k-add-minus reste interprété sans créer un
      // second moteur de listeners.
      if (!action) {
        const legacyMinus = e.target.closest('.k-add-minus');
        const legacyPlus = e.target.closest('.k-add-plus-ic');
        if (legacyMinus) {
          action = 'decrement';
          actionBtn = legacyMinus;
        } else if (legacyPlus) {
          action = 'increment';
          actionBtn = legacyPlus;
        } else if (!addControl.querySelector('button[data-action]')) {
          action = 'add';
          actionBtn = addControl;
        }
      }

      if (!action) return;
      if (action === 'decrement') {
        quickRemove(id, actionBtn);
      } else if (action === 'review') {
        openModal(id);
      } else if (addControl.dataset.hasVariants === '1') {
        quickAdd(id, actionBtn, { hasVariants: true });
      } else {
        quickAdd(id, actionBtn);
      }
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

  // ── VOIR PLUS — révèle les cartes cachées de la section inline ──
  dom.grid.querySelectorAll('.k-sec-see-more').forEach(btn => {
    if (btn.dataset.bound === '1') return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      const wrap = btn.closest('.k-cat-section');
      if (!wrap) return;
      // Révèle les cartes cachées en retirant le wrapper span invisible
      wrap.querySelectorAll('.k-sec-more-card').forEach(span => {
        const card = span.firstElementChild;
        if (card) {
          span.replaceWith(card);
          bindCarouselDots(card);
        }
      });
      // Masque le bouton "Voir plus" — plus rien à révéler
      btn.closest('.k-sec-see-more-wrap').remove();
    });
  });

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
      let _g = document.getElementById('k-grid');
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
  let anchorId = 'k-sec-' + cat.replace(/[^a-zA-Z0-9]/g, '-');
  let el = document.getElementById(anchorId);
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

/**
 * Restaure state.filtered à la vitrine de la catégorie active (pas tout le
 * catalogue) et re-rend la grille.
 *
 * ── Pourquoi ce helper existe (bug « plus aucune carte après une recherche ») ──
 * `_searching` (renderGrid, ~L399) est dérivé de dom.searchInput.value, alors
 * que la liste rendue vit dans state.filtered. Ces deux sources DOIVENT être
 * remises à zéro ensemble. Le clic sur un résultat du dropdown vidait l'input
 * sans restaurer state.filtered ni re-rendre : au rendu suivant (fermeture de
 * modale, clic catégorie, événement bus), `_searching` repassait à false et
 * _balancedPick() s'appliquait à la liste étroite laissée par la recherche.
 * Or _balancedPick jette toute section < MIN_PER_SECTION (4) et tout reliquat
 * impair → grille VIDE, rafraîchissement obligatoire.
 * Un seul point de restauration, appelé partout où la recherche se termine.
 */
function _resetSearchFilter() {
  state.filtered = (state.activeCat && state.activeCat !== 'all' && isDesktop())
    ? state.products.filter(p => _normalizeCat(p.category) === state.activeCat)
    : [...state.products];
  renderGrid();
}

function setupSearch() {
  dom.searchInput.addEventListener('input', () => {
    clearTimeout(state.searchTimeout);
    const q = dom.searchInput.value.trim().toLowerCase();
    if (q.length < 2) {
      dom.searchDrop.classList.remove('open');
      _resetSearchFilter();
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
      // Vider l'input NE SUFFIT PAS : state.filtered contient encore les seuls
      // résultats de la recherche. Sans cette restauration, le prochain rendu
      // voit _searching=false (input vide) et applique _balancedPick() à cette
      // liste étroite → 0 carte. Cf. _resetSearchFilter().
      _resetSearchFilter();
    });
  });
}

export {
  renderPromos, renderGrid, appendNextPage,
  setupCats, setupCatSwipeNav, centerActiveChip, setupSearch,
  loadProducts, _renderCard,
};
