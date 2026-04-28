/**
 * b-catalog.js — Module ES · §4 CATALOG + §6 GRID SECTIONS + §8 CATS & SEARCH
 * Extrait de boutique.js Sprint 2F — Option C
 *
 * Exports : renderPromos, renderGrid, renderSection,
 *           initCats, initSearch, filterProducts
 */

import { bus }           from './b-bus.js';
import {
  state, SUBCATS, dom, $, $$, PAGE_SIZE,
}                         from './b-store.js';
import {
  optimizeImgUrl, sanitize, promoImgUrl, fmt, fmtPrice,
  productEmoji, _currency, _rates,
  renderProductCarousel, bindCarouselDots,
}                         from './b-utils.js';
import {
  showToast, cartQty, updateCartBadge, isFav, saveCart,
}                         from './b-cart-core.js';
import {
  renderCartBody,
  toggleFav, quickAdd, quickRemove, markAllCartButtons,
}                         from './b-cart.js';
import {
  _setupMobilePager,
  _setupSectionAutoAdvance,
  _setupHorizontalWrap,
  _syncChipToScroll,
  _onPagerScroll,
  _scrollPagerToCat,
  _scrollPagerToGhost,
  _reshuffleToutInDOM,
  _setupInfiniteLoop,
}                         from './b-pager.js';
import { openModal }      from './b-modal.js';

'use strict';

// Pager → catalog : centrer la chip active (découplage circulaire)
bus.on('chip:center', function(chip) { centerActiveChip(chip); });


  // ║  §4 · CATALOG — Promos, grille, cartes, shuffle                  ║
  // ╚══════════════════════════════════════════════════════════════════╝
  //  → Futur module: b-catalog.js

  /**
   * Charge la page suivante de produits (pagination infinie — desktop).
   * Utilisé en scroll ↕ sur la vue desktop classique.
   * @param {string} [catSlug] - Slug catégorie à charger (null = tout)
   */
  function appendNextPage() {
    const spinner = document.getElementById('k-load-more-spinner');

    // ── MODE FLAT SUBCAT : pagination gérée par IO par page (pas de global append) ──
    if (state.flatSubcat && window.innerWidth < 900) {
      if (spinner) spinner.classList.remove('show');
      return;
    }

    // Même logique que renderGrid : si activeCat === 'all', on prend filtered tel quel
    // sinon on filtre filtered par catégorie (cohérent avec renderGrid)
    let list = state.activeCat === 'all'
      ? state.filtered
      : state.filtered.filter(p => p.category === state.activeCat);
    // Subcategory filter
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
    const fragment = nextItems.map(p => {
      const inCart = state.cart.find(i => String(i.product.id) === String(p.id));
      const qty = inCart ? inCart.qty : 0;
      return `
        <div class="k-card" data-id="${p.id}">
          <div class="k-card-img-wrap">
            ${renderProductCarousel(p, 400)}
            ${p.promo_pct ? `<span class="k-card-promo">-${p.promo_pct}%</span>` : ''}
            <button class="k-card-fav${isFav(p.id) ? ' liked' : ''}" data-fav="${p.id}" aria-label="Favori">
              ${isFav(p.id) ? '❤️' : '🤍'}
            </button>
          </div>
          <div class="k-card-info">
            <div class="k-card-name">${sanitize(p.name)}</div>
            ${p.description ? '<div class="k-card-desc">' + sanitize(p.description).slice(0, 60) + '</div>' : ''}
            <div class="k-card-bottom k-card-prices-row">
              <div class="k-card-price-col">
                <span class="k-card-price">${fmtPrice(p.price_kmf)}</span>
                <span class="k-card-price-eur">≈ ${fmt(p.price_kmf, 'EUR')}</span>
                ${p.promo_pct ? '<span class="k-card-old-price">' + fmtPrice(Math.round(p.price_kmf / (1 - p.promo_pct / 100))) + '</span>' : ''}
              </div>
              <button class="k-card-add${qty > 0 ? ' in-cart' : ''}" data-add="${p.id}" aria-label="Ajouter">
                ${qty > 0 ? '<span class="k-add-minus" data-pid="' + p.id + '">−</span><span class="k-add-qty">' + qty + '</span><span class="k-add-plus-ic">+</span>' : '<img src="/images/panier_tresse_vert.png" class="k-card-add-basket" alt="+" width="28" height="28">'}
              </button>
            </div>
          </div>
        </div>`;
    }).join('');
    dom.grid.insertAdjacentHTML('beforeend', fragment);
    // Re-bind events on new cards
    dom.grid.querySelectorAll('.k-card:not([data-bound])').forEach(card => {
      card.dataset.bound = '1';
      bindCarouselDots(card);
      card.addEventListener('click', (e) => {
        if (e.target.closest('.k-card-fav') || e.target.closest('.k-card-add') || e.target.closest('.k-card-tab') || e.target.closest('.k-card-dots')) return;
        if (card.dataset.justSwiped === '1') return;
        openModal(card.dataset.id);
      });
    });
    dom.grid.querySelectorAll('.k-card-fav:not([data-bound])').forEach(btn => {
      btn.dataset.bound = '1';
      btn.addEventListener('click', (e) => { e.stopPropagation(); toggleFav(btn.dataset.fav, btn); });
    });
    dom.grid.querySelectorAll('.k-card-add:not([data-bound])').forEach(btn => {
      btn.dataset.bound = '1';
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (e.target.closest('.k-add-minus')) { quickRemove(btn.dataset.add, btn); }
        else { quickAdd(btn.dataset.add, btn); }
      });
    });
    if (spinner) spinner.classList.remove('show');
  }

  /* ── LOAD PRODUCTS ──────────────────────────────────────── */
  /**
 * Charge les produits depuis l'API et initialise le catalogue.
 * Lance le rendu pager Temu (mobile) ou grille classique (desktop).
 * @returns {Promise<void>}
 */
  async function loadProducts() {
  
  try {
    if (typeof K === 'undefined' || !K.products) {
      throw new Error("K non disponible");
    }

    const data = await K.products.list({ limit: 1000 });

    state.products = (Array.isArray(data) ? data : data.products || [])
      .filter(p => p.is_available !== false);

    localStorage.setItem('komerce_products_cache', JSON.stringify(state.products));

  } catch (e) {
    console.warn("[loadProducts] API KO → fallback cache");

    const cached = localStorage.getItem('komerce_products_cache');

    if (cached) {
      state.products = JSON.parse(cached);
    } else {
      showToast("Pas de connexion", "error");
      return;
    }
  }

  state.filtered = [...state.products];
  renderGrid();
  if (dom.promoRail) renderPromos();
  markAllCartButtons();
  // FEATURE 2 : vérifier si des favoris sont en promo et màj badge bnav
  try {
    const favProducts = state.products.filter(p => state.favs.includes(p.id));
    const promoFavs = favProducts.filter(p => (p.promo_pct || 0) > 0);
    if (typeof updateFavPromoBadge === 'function') updateFavPromoBadge(promoFavs.length);
  } catch(e) { console.warn('[fav-promo-badge]', e.message); }

  // FIX : nettoyer le panier des produits qui n'existent plus en DB
  const validIds = new Set(state.products.map(p => String(p.id)));
  const before = state.cart.length;
  state.cart = state.cart.filter(item => {
    const ok = validIds.has(String(item.product.id));
    if (!ok) console.warn('[cart] Produit obsolète retiré :', item.product.id, item.product.name);
    return ok;
  });
  if (state.cart.length !== before) {
    saveCart();
    renderCartBody();
    if (typeof updateCartBadge === 'function') updateCartBadge();
    const removed = before - state.cart.length;
    showToast(`${removed} produit${removed > 1 ? 's' : ''} obsolète${removed > 1 ? 's' : ''} retiré${removed > 1 ? 's' : ''} du panier`, 'info');
  }
}

  /* ── RENDER PROMOS ──────────────────────────────────────── */

  /* ═══════════════════════════════════════════════════════════════
     MOBILE FIX v7.0 — Force inline styles via JS
     Runs after every render to guarantee mobile layout
     ═══════════════════════════════════════════════════════════════ */

  /**
 * Rend le bandeau de promotions scrollable horizontalement.
 * @param {Array} products - Produits avec promo_price
 */
  function renderPromos() {
    const promos = state.products.filter(p => p.promo_pct > 0).slice(0, 10);

    // Refresh 28/04/26 : masquer la section "Soldes du moment" si zéro promo.
    // Le CSS (homepage-refresh.css) gère l'affichage via [data-empty="1"].
    const promoSection = document.getElementById('k-promos-section');
    if (promoSection) {
      if (promos.length === 0) {
        promoSection.setAttribute('data-empty', '1');
        return; // pas la peine de construire un rail vide
      }
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

    // Wrap in inner div for seamless auto-scroll
    const inner = document.createElement('div');
    inner.className = 'k-promo-rail-inner';
    inner.innerHTML = dom.promoRail.innerHTML + dom.promoRail.innerHTML;
    dom.promoRail.innerHTML = '';
    dom.promoRail.appendChild(inner);
    // Pause on touch (mobile)
    inner.addEventListener('touchstart', () => inner.style.animationPlayState = 'paused');
    inner.addEventListener('touchend', () => inner.style.animationPlayState = 'running');
    
    inner.querySelectorAll('.k-promo-card').forEach(card => {
      card.addEventListener('click', () => openModal(card.dataset.id));
    });
  }

  /* ── RENDER GRID ────────────────────────────────────────── */
  /**
 * Rend la grille principale des produits (desktop).
 * @param {Array} products - Tous les produits
 */

  // ── Flat subcat chrome cleanup (stub — mode non actif en ES modules) ──
  function _unmountFlatSubcatChrome() {
    var overlay = document.getElementById('k-flat-subcat-overlay');
    if (overlay) overlay.remove();
    var nav = document.getElementById('k-flat-subcat-nav');
    if (nav) nav.remove();
  }

  function renderGrid() {
    state.page = 0;
    const _isMobile = window.innerWidth < 900;

    // ── TEMU FLAT SUBCAT MODE (mobile only) ──
    // Pager horizontal : 1 page par sous-cat, scroll vertical infini par page.
    // Court-circuite le rendu sections quand flatSubcat est actif.
    if (_isMobile && state.flatSubcat) {
      dom.grid.classList.add('k-grid-has-sections');
      dom.grid.classList.add('k-grid-flat-subcat');
      dom.grid.innerHTML = _renderFlatSubcat();
      _mountFlatSubcatChrome();
      _bindGridEvents();
      _bindFlatSubcatControls();
      var _psf = document.getElementById('k-page-scroll');
      if (_psf) _psf.classList.add('k-pager-active');
      _recalcPagerHeight();
      _setupFlatSubcatPager();
      return;
    }
    // Pas en mode flat : cleanup de la classe et du chrome éventuels
    dom.grid.classList.remove('k-grid-flat-subcat');
    _unmountFlatSubcatChrome();

    // Mobile pager: always show all products grouped by category
    let list = (state.activeCat === 'all' || _isMobile)
      ? state.filtered
      : state.filtered.filter(p => p.category === state.activeCat);
    // Subcategory filter (desktop focused mode only)
    if (!_isMobile && state.activeSubcat) {
      const subF = list.filter(p => p.subcategory === state.activeSubcat);
      if (subF.length > 0) list = subF;
    }

    // ── TEMU PAGER (mobile): always sections ──
    // ── Desktop: sections only in "Tout" mode ──
    const useSections = state.activeCat === 'all' || _isMobile;

    let pageItems;
    if (useSections) {
      // Mobile pager: more products per page (20 per cat); Desktop: balanced 48
      pageItems = _isMobile ? _balancedPick(list, 160) : _balancedPick(list, 48);
    } else {
      pageItems = list.slice(0, state.pageSize);
    }

    if (useSections) {
      dom.grid.classList.add('k-grid-has-sections');
      dom.grid.innerHTML = _renderGridWithSections(pageItems);
      _bindGridEvents();
      // ── Temu pager setup (mobile) ──
      if (_isMobile) {
        var _ps = document.getElementById('k-page-scroll');
        if (_ps) _ps.classList.add('k-pager-active');
        _setupMobilePager();
        _setupInfiniteLoop();
        _setupSectionAutoAdvance();
        if (state.activeCat !== 'all') {
          setTimeout(function() { _scrollPagerToCat(state.activeCat); }, 50);
        }
      } else {
        var _ps2 = document.getElementById('k-page-scroll');
        if (_ps2) _ps2.classList.remove('k-pager-active');
      }
      return;
    }
    // Sinon : mode grille classique, s'assurer qu'on n'a pas la classe sections
    dom.grid.classList.remove('k-grid-has-sections');
    var _ps3 = document.getElementById('k-page-scroll');
    if (_ps3) _ps3.classList.remove('k-pager-active');

    dom.grid.innerHTML = pageItems.map(p => {
      const inCart = state.cart.find(i => String(i.product.id) === String(p.id));
      const qty = inCart ? inCart.qty : 0;
      return `
        <div class="k-card" data-id="${p.id}">
          <div class="k-card-img-wrap">
            ${renderProductCarousel(p, 400)}
            ${p.promo_pct ? `<span class="k-card-promo">-${p.promo_pct}%</span>` : ''}
            <button class="k-card-fav${isFav(p.id) ? ' liked' : ''}" data-fav="${p.id}" aria-label="Favori">
              ${isFav(p.id) ? '❤️' : '🤍'}
            </button>
          </div>
          <div class="k-card-info">
            <div class="k-card-name">${sanitize(p.name)}</div>
            ${p.description ? '<div class="k-card-desc">' + sanitize(p.description).slice(0, 60) + '</div>' : ''}
            <div class="k-card-bottom k-card-prices-row">
              <div class="k-card-price-col">
                <span class="k-card-price">${fmtPrice(p.price_kmf)}</span>
                <span class="k-card-price-eur">≈ ${fmt(p.price_kmf, 'EUR')}</span>
                ${p.promo_pct ? '<span class="k-card-old-price">' + fmtPrice(Math.round(p.price_kmf / (1 - p.promo_pct / 100))) + '</span>' : ''}
              </div>
              <button class="k-card-add${qty > 0 ? ' in-cart' : ''}" data-add="${p.id}" aria-label="Ajouter">
                ${qty > 0 ? '<span class="k-add-minus" data-pid="' + p.id + '">−</span><span class="k-add-qty">' + qty + '</span><span class="k-add-plus-ic">+</span>' : '<img src="/images/panier_tresse_vert.png" class="k-card-add-basket" alt="+" width="28" height="28">'}
              </button>
            </div>
          </div>
        </div>`;
    }).join('');

    // Events
    dom.grid.querySelectorAll('.k-card').forEach(card => {
      bindCarouselDots(card);
      card.addEventListener('click', (e) => {
        if (e.target.closest('.k-card-fav') || e.target.closest('.k-card-add') || e.target.closest('.k-card-tab') || e.target.closest('.k-card-dots')) return;
        if (card.dataset.justSwiped === '1') return;
        openModal(card.dataset.id);
      });
    });

    dom.grid.querySelectorAll('.k-card-fav').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleFav(btn.dataset.fav, btn);
      });
    });

    dom.grid.querySelectorAll('.k-card-add:not([data-bound])').forEach(btn => {
      btn.dataset.bound = '1';
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (e.target.closest('.k-add-minus')) { quickRemove(btn.dataset.add, btn); }
        else { quickAdd(btn.dataset.add, btn); }
      });
    });
  }


  // ── HELPERS pour rendu sections catégorie en mode "Tout" ────────────
  /**
   * @brief _renderCard — Génère le HTML d'une carte produit
   * @param {Object} p - Objet produit (id, name, description, price_kmf, promo_pct, image_url)
   * @returns {string} HTML de la carte (incluant stepper si qty > 0)
   */
    function _renderCard(p) {
    const inCart = state.cart.find(i => String(i.product.id) === String(p.id));
    const qty = inCart ? inCart.qty : 0;
    return `
      <div class="k-card" data-id="${p.id}">
        <div class="k-card-img-wrap">
          ${renderProductCarousel(p, 400)}
          ${p.promo_pct ? `<span class="k-card-promo">-${p.promo_pct}%</span>` : ''}
          <button class="k-card-fav${isFav(p.id) ? ' liked' : ''}" data-fav="${p.id}" aria-label="Favori">
            ${isFav(p.id) ? '❤️' : '🤍'}
          </button>
        </div>
        <div class="k-card-info">
          <div class="k-card-name">${sanitize(p.name)}</div>
          ${p.description ? '<div class="k-card-desc">' + sanitize(p.description).slice(0, 60) + '</div>' : ''}
          <div class="k-card-bottom k-card-prices-row">
            <div class="k-card-price-col">
              <span class="k-card-price">${fmtPrice(p.price_kmf)}</span>
              <span class="k-card-price-eur">≈ ${fmt(p.price_kmf, 'EUR')}</span>
              ${p.promo_pct ? '<span class="k-card-old-price">' + fmtPrice(Math.round(p.price_kmf / (1 - p.promo_pct / 100))) + '</span>' : ''}
            </div>
            <button class="k-card-add${qty > 0 ? ' in-cart' : ''}" data-add="${p.id}" aria-label="Ajouter">
              ${qty > 0 ? '<span class="k-add-minus" data-pid="' + p.id + '">−</span><span class="k-add-qty">' + qty + '</span><span class="k-add-plus-ic">+</span>' : '<img src="/images/panier_tresse_vert.png" class="k-card-add-basket" alt="+" width="28" height="28">'}
            </button>
          </div>
        </div>
      </div>`;
  }

  /**
   * Piochage équilibré par catégorie :
   *   - Parcourt `list` en ordre d'apparition pour grouper par catégorie
   *   - Garde seulement les catégories qui ont >= MIN_PER_SECTION produits
   *   - Les catégories "maigres" (< MIN) sont fusionnées en une section "Autres" à la fin
   *   - Résultat : jamais de cartes orphelines dans la grille 3-cols
   */
  // ── Fisher-Yates shuffle (chaos contrôlé pour page "Tout") ──
  /**
   * Fisher-Yates shuffle in-place.
   * Utilisé pour le chaos aléatoire de la page "Tout" + dopamine loop ghost.
   * @param {Array} arr - Tableau à mélanger
   * @returns {Array} Le même tableau mélangé
   */
  function _shuffle(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
    }
    return arr;
  }

  /**
   * Sélectionne N produits répartis équitablement entre toutes les catégories.
   * Garantit 20 produits/catégorie dans le pager Temu.
   * @param {Array} products - Tous les produits
   * @param {number} n - Nombre à sélectionner
   * @returns {Array} Sélection équilibrée
   */
  function _balancedPick(list, pageSize) {
    const MIN_PER_SECTION = 4; // min produits par section (pair pour grille 2-cols)

    // Grouper par cat dans l'ordre d'apparition
    const byCat = new Map();
    const order = [];
    for (const p of list) {
      const cat = p.category || 'Autres';
      if (!byCat.has(cat)) { byCat.set(cat, []); order.push(cat); }
      byCat.get(cat).push(p);
    }

    const rich = [];   // catégories qui ont >= MIN
    const thin = [];   // produits des catégories maigres → regrouper en "Autres"

    for (const cat of order) {
      const prods = byCat.get(cat);
      if (prods.length >= MIN_PER_SECTION) {
        rich.push({ cat, prods });
      } else {
        thin.push(...prods);
      }
    }
    if (thin.length >= MIN_PER_SECTION) {
      rich.push({ cat: 'Autres', prods: thin });
    }

    // ── Distribution équitable : chaque catégorie reçoit sa part ──
    const nCats = rich.length || 1;
    const basePerCat = Math.floor(pageSize / nCats);
    // Arrondir au pair inférieur (grille 2-cols, pas de carte orpheline)
    const perCat = basePerCat >= 2 ? (basePerCat % 2 === 0 ? basePerCat : basePerCat - 1) : 2;

    const flat = [];
    for (const section of rich) {
      _shuffle(section.prods); // ← chaos contrôlé : ordre aléatoire dans chaque catégorie
      const take = Math.min(perCat, section.prods.length);
      // Aussi arrondir au pair
      const count = take >= 2 ? (take % 2 === 0 ? take : take - 1) : 0;
      for (let i = 0; i < count; i++) flat.push(section.prods[i]);
    }
    return flat;
  }


  // ╔══════════════════════════════════════════════════════════════════╗

  // ║  §6 · GRID SECTIONS — Sections catégories + événements grille    ║
  // ╚══════════════════════════════════════════════════════════════════╝
  //  → Futur module: b-catalog.js (même module §4)

  /**
   * Génère la grille produits 2 colonnes pour une section pager.
   * Format Temu : 20 produits/catégorie, cartes ~183px.
   * @param {Array} products - Produits à afficher
   * @param {HTMLElement} container - Conteneur cible
   * @param {string} catSlug - Slug catégorie (pour boutons ajout)
   */
  function _renderGridWithSections(items) {
    // ── FIXED ORDER matching chips ──
    const CHIP_ORDER = ['Mode', 'Beauté', 'Tech', 'Enfant', 'Maison', 'Sport', 'Sur-mesure'];
    const EMOJI_CAT = {
      'Tout': '🔥', 'Soldes': '🏷️',
      'Mode': '👕', 'Beauté': '🌸', 'Tech': '📱', 'Enfant': '🧒',
      'Maison': '🏠', 'Sport': '⚽', 'Sur-mesure': '✨', 'Autres': '📦',
    };
    // Group by category
    const byCat = {};
    for (const p of items) {
      const cat = p.category || 'Autres';
      if (!byCat[cat]) byCat[cat] = [];
      byCat[cat].push(p);
    }
    // Total per category (all products, not just balanced)
    const totalByCat = {};
    for (const p of state.filtered) {
      const cat = p.category || 'Autres';
      totalByCat[cat] = (totalByCat[cat] || 0) + 1;
    }
    const parts = [];
    const _isMobile = window.innerWidth < 900;

    if (_isMobile) {
      // ── 1. PAGE "TOUT" — chaos mélangé ──
      var _allShuffled = _shuffle(items.slice()).slice(0, 40);
      parts.push('<div class="k-cat-section" data-cat="all">');
      parts.push(
        '<div class="k-sec-header" data-cat="all">' +
        '<span class="k-sec-header-emoji">🔥</span>' +
        '<span class="k-sec-header-name">Tout</span>' +
        '<span class="k-sec-header-count">' + items.length + '</span>' +
        '</div>'
      );
      parts.push('<div class="k-sec-grid">');
      for (var _ai = 0; _ai < _allShuffled.length; _ai++) parts.push(_renderCard(_allShuffled[_ai]));
      parts.push('</div></div>');

      // ── 2. PAGE "SOLDES" ──
      var _soldes = _shuffle(state.filtered.filter(function(p){ return p.promo_pct > 0; })).slice(0, 30);
      if (_soldes.length > 0) {
        parts.push('<div class="k-cat-section" data-cat="Soldes">');
        parts.push(
          '<div class="k-sec-header" data-cat="Soldes">' +
          '<span class="k-sec-header-emoji">🏷️</span>' +
          '<span class="k-sec-header-name">Soldes</span>' +
          '<span class="k-sec-header-count">' + _soldes.length + '</span>' +
          '</div>'
        );
        parts.push('<div class="k-sec-grid">');
        for (var _si = 0; _si < _soldes.length; _si++) parts.push(_renderCard(_soldes[_si]));
        parts.push('</div></div>');
      }

      // ── 3. CATÉGORIES — ORDRE FIXE ──
      for (var _ci = 0; _ci < CHIP_ORDER.length; _ci++) {
        var cat = CHIP_ORDER[_ci];
        var prods = byCat[cat];
        if (!prods || prods.length === 0) continue;
        var emoji = EMOJI_CAT[cat] || '📦';
        var total = totalByCat[cat] || prods.length;
        parts.push('<div class="k-cat-section" data-cat="' + sanitize(cat) + '">');
        parts.push(
          '<div class="k-sec-header" data-cat="' + sanitize(cat) + '">' +
          '<span class="k-sec-header-emoji">' + emoji + '</span>' +
          '<span class="k-sec-header-name">' + sanitize(cat) + '</span>' +
          '<span class="k-sec-header-count">' + total + '</span>' +
          '<button class="k-sec-see-all" data-see-cat="' + sanitize(cat) + '">Voir tout →</button>' +
          '</div>'
        );
        var sectionProds = prods;
        parts.push('<div class="k-sec-grid">');
        for (var _pi = 0; _pi < sectionProds.length; _pi++) parts.push(_renderCard(sectionProds[_pi]));
        parts.push('</div></div>');
      }
    } else {
      // ── DESKTOP — sections empilées (pas de Tout ni Soldes page) ──
      // Build ordered array: use CHIP_ORDER, add any remaining cats
      var desktopOrder = [];
      for (var _di = 0; _di < CHIP_ORDER.length; _di++) {
        if (byCat[CHIP_ORDER[_di]]) desktopOrder.push(CHIP_ORDER[_di]);
      }
      for (var _k in byCat) {
        if (desktopOrder.indexOf(_k) === -1) desktopOrder.push(_k);
      }
      for (var _oi = 0; _oi < desktopOrder.length; _oi++) {
        var cat = desktopOrder[_oi];
        var emoji = EMOJI_CAT[cat] || '📦';
        var prods = byCat[cat];
        var total = totalByCat[cat] || prods.length;
        var anchorId = 'k-sec-' + cat.replace(/[^a-zA-Z0-9]/g, '-');
        parts.push('<div class="k-cat-section" data-cat="' + sanitize(cat) + '">');
        parts.push(
          '<div class="k-sec-header" id="' + anchorId + '" data-cat="' + sanitize(cat) + '">' +
          '<span class="k-sec-header-emoji">' + emoji + '</span>' +
          '<span class="k-sec-header-name">' + sanitize(cat) + '</span>' +
          '<span class="k-sec-header-count">' + total + '</span>' +
          '<button class="k-sec-see-all" data-see-cat="' + sanitize(cat) + '">Voir tout →</button>' +
          '</div>'
        );
        var sectionProds = prods;
        parts.push('<div class="k-sec-grid">');
        for (var _pi = 0; _pi < sectionProds.length; _pi++) parts.push(_renderCard(sectionProds[_pi]));
        parts.push('</div></div>');
      }
    }
    return parts.join('');
  }

  /**
   * Délègue les événements click sur la grille desktop (cartes + stepper + favoris).
   * Utilise event delegation sur le container global pour performance.
   */
  function _bindGridEvents() {
    // ── Cartes : ouvrir modal ──
    dom.grid.querySelectorAll('.k-card').forEach(card => {
      bindCarouselDots(card);
      card.addEventListener('click', (e) => {
        if (e.target.closest('.k-card-fav') || e.target.closest('.k-card-add') || e.target.closest('.k-card-tab') || e.target.closest('.k-card-dots')) return;
        if (card.dataset.justSwiped === '1') return;
        openModal(card.dataset.id);
      });
    });
    // ── Favoris ──
    dom.grid.querySelectorAll('.k-card-fav').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleFav(btn.dataset.fav, btn);
      });
    });
    // ── Ajout panier ──
    dom.grid.querySelectorAll('.k-card-add:not([data-bound])').forEach(btn => {
      btn.dataset.bound = '1';
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (e.target.closest('.k-add-minus')) { quickRemove(btn.dataset.add, btn); }
        else { quickAdd(btn.dataset.add, btn); }
      });
    });
    // ── "Voir tout →" dans les en-têtes de section ──
    dom.grid.querySelectorAll('.k-sec-see-all').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const cat = btn.dataset.seeCat;
        if (!cat) return;
        state.activeCat = cat;
        state.activeSubcat = null;
        $$('.k-chip').forEach(c => c.classList.remove('active'));
        const chip = document.querySelector('.k-chip[data-cat="' + cat + '"]');
        if (chip) { chip.classList.add('active'); centerActiveChip(chip); }
        renderGrid();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    });
    // ── Sous-catégories locales ──
    // ⚠️ Handler déplacé dans le listener global délégué (document.addEventListener
    // 'click' en capture). Pas de duplication ici pour éviter les conflits.
    // (voir section "LISTENER GLOBAL DÉLÉGUÉ pour .k-sec-subchip")
    // ── Index flottant + observer nav chips ──
    if (typeof _renderFloatingIndex === 'function') _renderFloatingIndex();
  }

  // ── Saut vers une section depuis le header (chip tap) ou l'index flottant ──
  window._scrollingToSection = false;
  window.scrollToCategorySection = function(cat) {
    // Mobile pager: scroll horizontally
    if (window.innerWidth < 900 && document.getElementById('k-page-scroll') &&
        document.getElementById('k-page-scroll').classList.contains('k-pager-active')) {
      if (!cat || cat === 'all') {
        var _g = document.getElementById('k-grid');
        if (_g) _g.scrollTo({ left: 0, behavior: 'smooth' });
      } else {
        _scrollPagerToCat(cat);
      }
      return;
    }
    // Desktop: vertical scroll
    var scroller = document.getElementById('k-page-scroll');
    if (!scroller) return;
    if (!cat || cat === 'all') {
      scroller.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    var anchorId = 'k-sec-' + cat.replace(/[^a-zA-Z0-9]/g, '-');
    var el = document.getElementById(anchorId);
    if (!el) return;
    window._scrollingToSection = true;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setTimeout(function() { window._scrollingToSection = false; }, 700);
  };


  /* ── FLY TO CART ANIMATION ──────────────────────────────── */

  // ╔══════════════════════════════════════════════════════════════════╗

  // ║  §8 · CATS & SEARCH — Pills catégories + barre de recherche      ║
  // ╚══════════════════════════════════════════════════════════════════╝
  //  → Futur module: b-catalog.js (même module §4)

  /**
   * Initialise la barre de catégories horizontale (pills Temu-style).
   * Bind les clics + synchronise avec le pager via offsetLeft.
   * Mode desktop : scroll vertical classique par catégorie.
   */
  function setupCats() {
    // Split emoji + label pour le layout en carré empilé
    const emojiRx = /^(\p{Emoji_Presentation}|\p{Emoji}\uFE0F)\s*/u;
    $$('.k-chip').forEach(chip => {
      const raw = chip.textContent.trim();
      const m = raw.match(emojiRx);
      if (m) {
        const emoji = m[1];
        const label = raw.slice(m[0].length);
        chip.innerHTML =
          `<span class="k-chip-emoji">${emoji}</span>` +
          `<span class="k-chip-label">${label}</span>`;
      }
      chip.addEventListener('click', () => {
        const cat = chip.dataset.cat;

        // ── Quitte le mode flat sous-cat si actif ──
        // Re-render en mode sections, puis continue avec le flux normal
        if (state.flatSubcat) {
          state.flatSubcat = null;
          renderGrid();
        }

        // ── Mobile pager: scroll to page instead of re-rendering ──
        if (window.innerWidth < 900 && document.getElementById('k-page-scroll') &&
            document.getElementById('k-page-scroll').classList.contains('k-pager-active')) {
          $$('.k-chip').forEach(c => c.classList.remove('active'));
          chip.classList.add('active');
          centerActiveChip(chip);
          if (cat === 'all') {
            var _g = document.getElementById('k-grid');
            if (_g) _g.scrollTo({ left: 0, behavior: 'smooth' });
          } else {
            _scrollPagerToCat(cat);
          }
          return;
        }

        // ── "Tout" chip ──
        if (cat === 'all') {
          if (state.activeCat === 'all') {
            // Already in Tout → scroll to top
            window.scrollTo({ top: 0, behavior: 'smooth' });
            return;
          }
          // Retour au mode sections
          $$('.k-chip').forEach(c => c.classList.remove('active'));
          chip.classList.add('active');
          state.activeCat = 'all';
          state.activeSubcat = null;
          state.sectionSubcats = {};
          renderGrid();
          window.scrollTo({ top: 0, behavior: 'smooth' });
          return;
        }

        // ── En mode "Tout" (sections) → scroll vers la section ──
        if (state.activeCat === 'all') {
          // Feedback visuel immédiat
          $$('.k-chip').forEach(c => c.classList.remove('active'));
          chip.classList.add('active');
          centerActiveChip(chip);
          scrollToCategorySection(cat);
          return;
        }

        // ── En mode focalisé : même chip → retour à "Tout" ──
        if (cat === state.activeCat) {
          $$('.k-chip').forEach(c => c.classList.remove('active'));
          const allChip = document.querySelector('.k-chip[data-cat="all"]');
          if (allChip) allChip.classList.add('active');
          state.activeCat = 'all';
          state.activeSubcat = null;
          state.sectionSubcats = {};
          renderGrid();
          window.scrollTo({ top: 0, behavior: 'smooth' });
          return;
        }

        // ── En mode focalisé : autre chip → changer de catégorie ──
        $$('.k-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        state.activeCat = cat;
        state.activeSubcat = null;
        renderGrid();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    });
  }

  /* ── CATEGORY SWIPE NAV (mobile) ────────────────────────── */
  /* Scroll horizontal sur les chips → auto-switch catégorie  */
  /* ── Center active chip on click (Temu-style) ── */
  /**
 * Centre le chip actif dans la barre de catégories.
 * @param {HTMLElement} chip - Chip à centrer
 */
  function centerActiveChip(chip) {
    var catsEl = document.getElementById('k-cats');
    if (!chip || !catsEl || window.innerWidth >= 900) return;
    var left = chip.offsetLeft - (catsEl.clientWidth / 2) + (chip.clientWidth / 2);
    catsEl.scrollTo({ left: left, behavior: 'smooth' });
  }

  /**
   * Active la navigation par swipe ↔ entre catégories (pager mobile).
   * Utilise scroll-snap-type: x proximity + detection offsetLeft.
   * rAF pour sync pill active + scrollend pour confirmation finale.
   */
  function setupCatSwipeNav() {
    if (window.innerWidth > 899) return;
    var catsEl = document.getElementById('k-cats');
    if (!catsEl) return;

    // Center active chip on click
    catsEl.addEventListener('click', function(e) {
      var chip = e.target.closest('.k-chip');
      if (!chip) return;
      requestAnimationFrame(function() { centerActiveChip(chip); });
    });

    // Center active chip on load
    var activeChip = catsEl.querySelector('.k-chip.active');
    if (activeChip) centerActiveChip(activeChip);
    // Scroll horizontal = visuel uniquement, pas de changement auto de catégorie
  }

  /* ── CATALOG SWIPE removed — navigation v2 uses scroll-to-section ── */

    /* ── SEARCH ─────────────────────────────────────────────── */
  /**
 * Initialise la barre de recherche avec dropdown live.
 */
  function setupSearch() {
    dom.searchInput.addEventListener('input', () => {
      clearTimeout(state.searchTimeout);
      const q = dom.searchInput.value.trim().toLowerCase();
      if (q.length < 2) {
        dom.searchDrop.classList.remove('open');
        state.filtered = [...state.products];
        renderGrid();
        return;
      }
      state.searchTimeout = setTimeout(() => {
        const results = state.products.filter(p =>
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

  /**
   * Affiche les suggestions de recherche en temps réel.
   * Filtre produits par nom/description (debounce 200ms).
   * @param {string} query - Terme recherché
   */
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

  /* ── PRODUCT MODAL — Carousel (Temu-style with Komerce spirit) ────── */

  // Build carousel slides dynamically (1 or N images)

export {
  renderPromos, renderGrid, appendNextPage,
  setupCats, setupCatSwipeNav, centerActiveChip, setupSearch,
  loadProducts, _renderCard,
};
// Backward-compat aliases (boutique.js Phase 10 legacy imports)
export { setupCats as initCats, setupSearch as initSearch };
