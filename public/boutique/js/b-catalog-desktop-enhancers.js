/**
 * @komerce-arch
 * @role          desktop-catalog-enhancer
 * @domain        catalog
 * @layer         ui-enhancer
 * @criticality   high
 * @inputs        catalog_state, desktop_viewport, view_events
 * @outputs       desktop_sidebar_sync, merch_cards, promo_strip, category_focus
 * @depends       b-bus.js, b-catalog.js, b-scroll-owner.js, controllers/home-controller.js, shop-schema.js
 * @used-by       boutique.js
 * @doctrine      boutique_canal_decouverte, desktop_premium, navigation_sans_friction
 * @impact-areas  desktop-catalog, category-navigation, home-layout, side-cart-layout
 * @version       2026-06
 */
'use strict';

/**
 * @module b-catalog-desktop-enhancers
 * @brief Enrichissements desktop ≥ 900px du catalogue et de la home.
 *
 *   - Mega-menu : dropdown de sous-catégories au hover des chips
 *   - Promo strip sous le hero (actuellement désactivé via early return)
 *   - Homepage merchandising : 4 cartes raccourcis (actuellement désactivé)
 *   - Hover overlay sur les cartes produit (Favori / Panier) — aperçu supprimé
 *   - Hero search bar : barre de recherche injectée dans .k-hero-media
 *   - Handler view:changed : masque merch / promo strip / scroll-top sur
 *     Favoris et Suivi
 *
 * Mobile : aucun effet (toutes les fonctions sortent sur !isDesktop()).
 *
 * Point d'entrée unique : setupCatalogDesktopEnhancers().
 * Extrait de b-desktop-upgrade.js (sections 1, 8, 9, 10b + hero search + view:changed).
 */

import { bus }              from './b-bus.js';
import { state }            from './b-store.js';
import {
  getCategorySectionEmoji,
  getSubcategories,
  getRailCategories,
}                           from './shop-schema.js';
import { setActiveCat }                              from './b-catalog.js';
import { syncRailActiveState, renderSubcatRail }    from './controllers/home-controller.js';
import { isDesktop, scrollPageToTop, getScrollY, scrollToPosition } from './b-scroll-owner.js';

'use strict';

// ═══════════════════════════════════════════════════════════════
//  1. SOUS-CATÉGORIES PERMANENTES au hover chip desktop
//     (remplace le mega-dropdown contextuel — lot NAV-DESKTOP-01, 2026-05-17)
//
//  Principe : hover sur une chip principale → renderSubcatRail(cat)
//  peuple immédiatement #k-subcats-wrap (barre sticky permanente).
//  Pas de panneau flottant, pas de position:fixed, pas d'animation d'entrée
//  séparée — le rail existant suffit.
// ═══════════════════════════════════════════════════════════════

function setupSubcatOnHover() {
  if (!isDesktop()) return;

  let catsEl = document.querySelector('.k-cats');
  if (!catsEl) return;

  let _hoverTimer = null;
  let _previewActive = false; // true = on est en mode aperçu (pas en sélection)

  catsEl.addEventListener('mouseenter', function(e) {
    let chip = e.target.closest('.k-chip');
    if (!chip) return;
    let cat = chip.dataset.cat;
    if (!cat || cat === 'all') return;

    // Même univers que l'actif → pas d'aperçu, c'est déjà le bon rendu
    if (cat === state.activeCat) {
      if (_hoverTimer) { clearTimeout(_hoverTimer); _hoverTimer = null; }
      return;
    }

    // Délai court anti-flash au passage rapide entre chips
    if (_hoverTimer) clearTimeout(_hoverTimer);
    _hoverTimer = setTimeout(function() {
      _previewActive = true;
      // Aperçu uniquement visuel : on peuple la barre sans toucher à
      // state.activeCat ni à la grille.
      renderSubcatRail(cat);
      syncRailActiveState(cat, { center: false });
    }, 80);
  }, true);

  // Quitter la zone chips → revenir à l'univers actif
  catsEl.addEventListener('mouseleave', function() {
    if (_hoverTimer) { clearTimeout(_hoverTimer); _hoverTimer = null; }
    if (_previewActive) {
      _previewActive = false;
      // Restaurer le rendu de l'univers actif sélectionné
      renderSubcatRail(state.activeCat || null);
      syncRailActiveState(state.activeCat || 'all', { center: false });
    }
  });
}

// ═══════════════════════════════════════════════════════════════
//  8. PROMO STRIP — Bannière sous le hero
// ═══════════════════════════════════════════════════════════════

function setupPromoStrip() {
  if (!isDesktop()) return;
  // [DÉSACTIVÉ] : la promo strip fait doublon avec le hero (qui contient déjà
  // "450+ produits · Paiement cash · Retrait relais"). Page d'accueil simplifiée
  // pour aller direct aux sections produits.
  return;
  let existingStrip = document.querySelector('.k-promo-strip');
  if (existingStrip) return; // already mounted

  let catalogWrap = document.getElementById('k-desktop-catalog-wrap');
  if (!catalogWrap) return;

  let strip = document.createElement('div');
  strip.className = 'k-promo-strip';
  strip.innerHTML =
    '<div class="k-promo-strip-inner">' +
      '<span class="k-promo-chip k-promo-chip--sale" data-action="soldes">' +
        '<span class="k-promo-chip-icon">🏷️</span> Soldes en cours' +
      '</span>' +
      '<span class="k-promo-chip k-promo-chip--trust">' +
        '<span class="k-promo-chip-icon">📦</span> Livraison aux Comores' +
      '</span>' +
      '<span class="k-promo-chip k-promo-chip--trust">' +
        '<span class="k-promo-chip-icon">💳</span> Paiement cash au retrait' +
      '</span>' +
      '<span class="k-promo-chip k-promo-chip--trust">' +
        '<span class="k-promo-chip-icon">🛡️</span> Retour sous 7 jours' +
      '</span>' +
      '<span class="k-promo-chip k-promo-chip--trust">' +
        '<span class="k-promo-chip-icon">⭐</span> 450+ produits' +
      '</span>' +
    '</div>';

  catalogWrap.parentNode.insertBefore(strip, catalogWrap);

  // Click on Soldes chip → navigate to Soldes category
  strip.querySelector('[data-action="soldes"]').addEventListener('click', function() {
    setActiveCat('Soldes');
    scrollPageToTop('smooth');
  });
}

// ═══════════════════════════════════════════════════════════════
//  9. HOMEPAGE MERCHANDISING — blocs éditoriaux desktop
// ═══════════════════════════════════════════════════════════════

function setupHomepageMerchandising() {
  if (!isDesktop()) return;
  // [DÉSACTIVÉ] : les 4 cartes raccourcis font doublon avec la nav par
  // catégories (sticky bar) + les sections elles-mêmes. Page allégée.
  return;
  if (document.querySelector('.k-home-merch')) return;

  let anchor = document.getElementById('k-desktop-catalog-wrap');
  if (!anchor || !anchor.parentNode) return;

  let merch = document.createElement('section');
  merch.className = 'k-home-merch';

  // Head — fixe
  merch.innerHTML =
    '<div class="k-home-merch-head">' +
      '<div>' +
        '<span class="k-home-merch-kicker">Sélections Komerce</span>' +
        '<h2>Les raccourcis pour trouver vite et bien</h2>' +
      '</div>' +
      '<button class="k-home-merch-all" type="button" data-cat="all">Voir tout le catalogue →</button>' +
    '</div>';

  // Grid — générée depuis shop-schema, source de vérité unique.
  // Ajouter un pilier dans shop-schema suffit — aucune modif ici requise.
  let _MERCH_DESC = {
    'Soldes':                 'Prix doux, arrivages malins, sélection rapide.',
    'Mode & Beauté':          'Les indispensables à offrir ou à se faire livrer.',
    'Maison':                 'Des produits concrets pour la famille.',
    'Tech':                   'Accessoires, gadgets et produits pratiques.',
    'Bricolage':              'Outillage et quincaillerie introuvables à Moroni.',
    'Créations personnelles': 'Tenues de cérémonie et cadeaux sur-mesure.',
    'Auto':                   'Pièces légères Toyota & Moto, sourcing Dubaï.',
  };
  let _grid = document.createElement('div');
  _grid.className = 'k-home-merch-grid';
  getRailCategories()
    .filter(function(c) { return c.key !== 'all'; })
    .forEach(function(c) {
      let btn = document.createElement('button');
      btn.className = 'k-home-merch-card' + (c.filterType === 'promo' ? ' k-home-merch-card--hot' : '');
      btn.type = 'button';
      btn.dataset.cat = c.key;
      btn.innerHTML =
        '<span class="k-home-merch-icon">' + getCategorySectionEmoji(c.key) + '</span>' +
        '<strong>' + c.label + '</strong>' +
        '<small>' + (_MERCH_DESC[c.key] || c.label) + '</small>';
      _grid.appendChild(btn);
    });
  merch.appendChild(_grid);

  anchor.parentNode.insertBefore(merch, anchor);

  merch.querySelectorAll('[data-cat]').forEach(function(btn) {
    btn.addEventListener('click', function() {
      let cat = btn.dataset.cat || 'all';

      if (!state.sectionSubcats) state.sectionSubcats = {};
      Object.keys(state.sectionSubcats).forEach(function(k) {
        state.sectionSubcats[k] = null;
      });

      setActiveCat(cat);

      let top = anchor.getBoundingClientRect().top + getScrollY() - 84;
      scrollToPosition(Math.max(0, top), 'smooth');
    });
  });
}

// ═══════════════════════════════════════════════════════════════
//  10. HOVER OVERLAY — Enrichissement cartes produit
//      Injection par DOM délégué (les cartes sont re-renderées souvent)
// ═══════════════════════════════════════════════════════════════

function setupCardHoverOverlay() {
  if (!isDesktop()) return;

  function esc(v) {
    return String(v || '').replace(/[&<>"']/g, function(ch) {
      return ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      })[ch];
    });
  }

  /* Construit l'HTML du bouton add dans l'overlay selon l'état in-cart.
     Si le produit est déjà dans le panier, on affiche le stepper − qty +
     directement dans l'overlay pour ne pas avoir à sortir du survol.     */
  function buildOverlayAddBtn(realAddBtn) {
    if (realAddBtn && realAddBtn.classList.contains('in-cart')) {
      // Stepper dans l'overlay — même structure que markAllCartButtons()
      let pid = realAddBtn.dataset.add || '';
      let qtyEl = realAddBtn.querySelector('.k-add-qty');
      let qty = qtyEl ? qtyEl.textContent : '1';
      return '<div class="k-card-hover-add k-card-hover-add--stepper" data-pid="' + pid + '">' +
               '<span class="k-hover-add-minus" data-pid="' + pid + '">−</span>' +
               '<span class="k-hover-add-qty">' + qty + '</span>' +
               '<span class="k-hover-add-plus" data-pid="' + pid + '">+</span>' +
             '</div>';
    }
    return '<button class="k-card-hover-add" type="button" aria-label="Ajouter au panier">' +
             '<img src="/images/panier_tresse_vert.png" width="22" height="22" alt="">' +
           '</button>';
  }

  document.querySelectorAll('.k-card').forEach(function(card) {
    if (card.querySelector('.k-card-hover-overlay')) return;

    let id = card.dataset.id || '';
    let nameEl = card.querySelector('.k-card-name');
    let priceEl = card.querySelector('.k-card-price');
    let descEl = card.querySelector('.k-card-desc');
    let realAddBtn = card.querySelector('.k-card-add');
    let name = nameEl ? nameEl.textContent.trim() : '';
    let price = priceEl ? priceEl.textContent.trim() : '';
    let desc = descEl ? descEl.textContent.trim() : '';
    let liked = !!card.querySelector('.k-card-fav.liked, .k-card-fav.is-liked');

    let overlay = document.createElement('div');
    overlay.className = 'k-card-hover-overlay';
    overlay.innerHTML =
      '<div class="k-card-hover-content">' +
        '<div class="k-card-hover-name">' + esc(name) + '</div>' +
        (desc ? '<div class="k-card-hover-desc">' + esc(desc) + '</div>' : '') +
        (price ? '<div class="k-card-price-eur-hover">' + esc(price) + '</div>' : '') +
        '<div class="k-card-hover-actions">' +
          '<button class="k-card-hover-fav' + (liked ? ' liked' : '') + '" type="button" aria-label="Favori">♡</button>' +
          buildOverlayAddBtn(realAddBtn) +
        '</div>' +
      '</div>';

    card.appendChild(overlay);

    // Sync de l'état overlay → mise à jour du bouton add quand le DOM de
    // .k-card-add change (markAllCartButtons modifie son innerHTML/className).
    if (realAddBtn) {
      let addObserver = new MutationObserver(function() {
        let addWrap = overlay.querySelector('.k-card-hover-add, .k-card-hover-add--stepper');
        if (!addWrap) return;
        let fresh = buildOverlayAddBtn(realAddBtn);
        let tmp = document.createElement('div');
        tmp.innerHTML = fresh;
        let newNode = tmp.firstElementChild;
        if (newNode) addWrap.parentNode.replaceChild(newNode, addWrap);
      });
      addObserver.observe(realAddBtn, { attributes: true, childList: true, subtree: true });
    }
  });

  if (!window.__komerceCardHoverOverlayBound) {
    window.__komerceCardHoverOverlayBound = true;

    document.addEventListener('click', function(e) {
      let fav    = e.target.closest('.k-card-hover-fav');
      let add    = e.target.closest('.k-card-hover-add');
      let minus  = e.target.closest('.k-hover-add-minus');
      let plus   = e.target.closest('.k-hover-add-plus');

      if (!fav && !add) return;

      e.preventDefault();
      e.stopPropagation();

      let card = e.target.closest('.k-card');
      if (!card) return;

      if (fav) {
        let realFav = card.querySelector('.k-card-fav');
        if (realFav) realFav.click();
        fav.classList.toggle('liked');
        return;
      }

      if (add) {
        let realAdd = card.querySelector('.k-card-add');
        if (!realAdd) return;

        if (minus) {
          // Clic sur − dans le stepper overlay → quickRemove
          let minusEl = realAdd.querySelector('.k-add-minus');
          if (minusEl) minusEl.click();
          else realAdd.click(); // fallback si structure inattendue
        } else if (plus) {
          // Clic sur + dans le stepper overlay → quickAdd
          let plusEl = realAdd.querySelector('.k-add-plus-ic');
          if (plusEl) plusEl.click();
          else realAdd.click();
        } else {
          // Clic sur le bouton panier (état non-in-cart) → ajouter au panier
          realAdd.click();
        }
        return;
      }
    }, true);
  }
}

function setupCardHoverObserver() {
  if (!isDesktop()) return;

  let grid = document.getElementById('k-grid');
  if (!grid || grid.__komerceHoverObserver) return;

  grid.__komerceHoverObserver = new MutationObserver(function() {
    if (!isDesktop()) return;
    requestAnimationFrame(setupCardHoverOverlay);
  });

  grid.__komerceHoverObserver.observe(grid, {
    childList: true,
    subtree: true
  });
}

// ═══════════════════════════════════════════════════════════════
//  HERO SEARCH BAR — barre de recherche injectée dans .k-hero-media
// ═══════════════════════════════════════════════════════════════

/* Injecte #k-optionb-search dans .k-hero-media uniquement sur desktop.
   La barre délègue la recherche au champ header existant (#k-search-input
   ou l'input .k-header-search, selon ce qui est présent dans le DOM).
   Mobile non touché : .k-hero-media est display:none mobile. */
function setupHeroSearchBar() {
  // DÉSACTIVÉ (31/05) : vestige "Option B". Cette barre injectée dans
  // .k-hero-media faisait doublon avec la recherche du header et se
  // superposait au hero éditorial 2-colonnes. La recherche du header
  // (#k-search-input) reste la barre unique. Code conservé si besoin futur.
  return;

  if (!isDesktop()) return;

  let media = document.querySelector('#k-hero-fixed-wrap .k-hero-media');
  if (!media) return;

  // Éviter double-injection
  if (document.getElementById('k-optionb-search')) return;

  let wrap = document.createElement('div');
  wrap.id = 'k-optionb-search';
  wrap.setAttribute('role', 'search');
  wrap.setAttribute('aria-label', 'Rechercher dans la boutique');

  let input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Envoyez ce qui compte, partout aux Comores…';
  input.setAttribute('autocomplete', 'off');
  input.setAttribute('aria-label', 'Recherche produits');

  let btn = document.createElement('button');
  btn.type = 'button';
  btn.setAttribute('aria-label', 'Lancer la recherche');
  btn.innerHTML = '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';

  wrap.appendChild(input);
  wrap.appendChild(btn);
  media.appendChild(wrap);

  // Délégation : synchroniser avec le champ de recherche du header si présent
  function _delegateSearch(val) {
    let headerInput = document.getElementById('k-search-input') ||
                      document.querySelector('.k-header-search input') ||
                      document.querySelector('[data-search-input]');
    if (headerInput) {
      headerInput.value = val;
      headerInput.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  input.addEventListener('input', function() { _delegateSearch(input.value); });
  input.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') { _delegateSearch(input.value); input.blur(); }
  });
  btn.addEventListener('click', function() { _delegateSearch(input.value); });
}

// ═══════════════════════════════════════════════════════════════
//  VIEW:CHANGED — masquage des éléments desktop hors vue shop
// ═══════════════════════════════════════════════════════════════

function _setupViewChangedGuard() {
  // Masquer les éléments desktop exclusifs à la vue shop sur Favoris / Suivi
  bus.on('view:changed', function(tab) {
    let isShop = tab === 'shop';
    let merch    = document.querySelector('.k-home-merch');
    let strip    = document.querySelector('.k-promo-strip');
    let scrollTop = document.querySelector('.k-scroll-top');
    if (merch)     merch.style.display        = isShop ? '' : 'none';
    if (strip)     strip.style.display        = isShop ? '' : 'none';
    if (scrollTop) scrollTop.classList.toggle('is-visible', isShop && getScrollY() > 600);
  });
}

// ═══════════════════════════════════════════════════════════════
//  NAV-STICKY-DESKTOP — variable --nav-stack-h (header + barre sticky)
//  Consommée par scroll-margin-top (layout.css) pour que les ancres
//  (CTA héro → #k-catalog-section, deep-links → .k-sec-header) ne
//  passent jamais sous la barre épinglée. La barre change de hauteur
//  quand la ligne sous-cats apparaît/disparaît → ResizeObserver.
// ═══════════════════════════════════════════════════════════════

function setupNavStackVar() {
  if (!isDesktop()) return;

  let bar    = document.getElementById('k-sticky-bar');   // .k-hero-cats-sticky
  let header = document.querySelector('.k-header');
  if (!bar) return;

  let root = document.documentElement;
  let raf  = 0;

  function measure() {
    raf = 0;
    let headerH = header ? header.getBoundingClientRect().height : 72;
    let barH    = bar.getBoundingClientRect().height;
    root.style.setProperty('--nav-stack-h', Math.round(headerH + barH) + 'px');
  }
  function update() {
    if (raf) return;
    raf = requestAnimationFrame(measure);
  }

  update();

  if (typeof ResizeObserver !== 'undefined') {
    let ro = new ResizeObserver(update);
    ro.observe(bar);
    if (header) ro.observe(header);
  }
  window.addEventListener('resize', update, { passive: true });
}

// ═══════════════════════════════════════════════════════════════
//  ENTRY POINT
// ═══════════════════════════════════════════════════════════════

export function setupCatalogDesktopEnhancers() {
  if (!isDesktop()) return;
  // [HOVER-PREVIEW] setupSubcatOnHover() — réactivé avec séparation preview/état :
  // survol = aperçu transitoire (barre seulement, grille intacte) ; mouseleave =
  // retour à l'univers actif ; clic = sélection réelle (comportement inchangé).
  // Scopé desktop + barre épinglée (isDesktop() guard dans la fonction).
  setupSubcatOnHover();
  setupPromoStrip();
  setupHomepageMerchandising();
  setupHeroSearchBar();
  setupNavStackVar();
  // Overlay désactivé : le fix CSS (suppression opacity:0 !important sur
  // .k-card-add au hover) suffit. Le voile vert masquait les boutons via
  // mix-blend-mode:multiply sur l'image du panier. Plus de doublon à gérer.
  // setupCardHoverObserver();
  _setupViewChangedGuard();
}
