/**
 * @module b-catalog-desktop-enhancers
 * @brief Enrichissements desktop ≥ 900px du catalogue et de la home.
 *
 *   - Mega-menu : dropdown de sous-catégories au hover des chips
 *   - Promo strip sous le hero (actuellement désactivé via early return)
 *   - Homepage merchandising : 4 cartes raccourcis (actuellement désactivé)
 *   - Hover overlay riche sur les cartes produit (Aperçu / Favori / Panier)
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
import { openModal }        from './b-modal.js';
import {
  getCategorySectionEmoji,
  getSubcategories,
  getRailCategories,
}                           from './shop-schema.js';
import { setActiveCat }                              from './b-catalog.js';
import { syncRailActiveState, renderSubcatRail }    from './controllers/home-controller.js';
import { isDesktop }        from './b-scroll-owner.js';

'use strict';

// ═══════════════════════════════════════════════════════════════
//  1. MEGA-MENU — Dropdown sous-catégories au hover chip desktop
// ═══════════════════════════════════════════════════════════════

let _megaEl      = null;
let _megaTimer   = null;
let _megaCurrent = null;

function _getMegaEl() {
  if (!_megaEl) {
    _megaEl = document.createElement('div');
    _megaEl.className = 'k-mega-dropdown';
    _megaEl.setAttribute('role', 'menu');
    document.body.appendChild(_megaEl);
    _megaEl.addEventListener('mouseenter', _clearTimer);
    _megaEl.addEventListener('mouseleave', _scheduleClose);
  }
  return _megaEl;
}

function _clearTimer() {
  if (_megaTimer) { clearTimeout(_megaTimer); _megaTimer = null; }
}

function _scheduleClose(delay) {
  _clearTimer();
  _megaTimer = setTimeout(_close, typeof delay === 'number' ? delay : 180);
}

function _close() {
  if (_megaEl) { _megaEl.classList.remove('is-open'); _megaEl.innerHTML = ''; }
  _megaCurrent = null;
  var catsShell = document.querySelector('.k-cats-shell');
  if (catsShell) catsShell.classList.remove('k-mega-open');
}

function _openForChip(chip) {
  if (!isDesktop()) return;
  var cat = chip.dataset.cat;
  if (!cat || cat === 'all') { _scheduleClose(80); return; }

  var subcats = getSubcategories(cat);
  if (!subcats || !subcats.length) { _scheduleClose(80); return; }

  if (_megaCurrent === cat) { _clearTimer(); return; }
  _megaCurrent = cat;
  _clearTimer();

  var el = _getMegaEl();

  // Position : pleine largeur, collé sous le .k-cats-shell
  // FIX Bug mega : position:fixed → coordonnées viewport (getBoundingClientRect suffit, pas de + scrollY)
  var shell = document.querySelector('.k-cats-shell');
  var shellRect = shell ? shell.getBoundingClientRect() : { bottom: 120, left: 0, width: window.innerWidth };
  el.style.top   = shellRect.bottom + 'px';   /* viewport-relative, correct avec position:fixed */
  el.style.left  = shellRect.left + 'px';
  el.style.width = shellRect.width + 'px';

  var emoji = getCategorySectionEmoji(cat) || '';
  var catLabel = chip.querySelector('.k-chip-label');
  var label = catLabel ? catLabel.textContent.trim() : cat;

  el.innerHTML =
    '<div class="k-mega-inner">' +
      '<div class="k-mega-head">' +
        '<span class="k-mega-head-emoji" aria-hidden="true">' + emoji + '</span>' +
        '<span class="k-mega-head-label">' + label + '</span>' +
      '</div>' +
      '<ul class="k-mega-list">' +
        subcats.map(function(sc) {
          var scLabel = sc.label || sc.key || String(sc);
          var scKey   = sc.key   || scLabel;
          var scEmoji = sc.emoji || '';
          return '<li class="k-mega-item" role="menuitem" tabindex="0" data-cat="' + cat + '" data-subcat="' + scKey + '">' +
            (scEmoji ? '<span class="k-mega-item-emoji" aria-hidden="true">' + scEmoji + '</span>' : '') +
            '<span class="k-mega-item-label">' + scLabel + '</span>' +
          '</li>';
        }).join('') +
      '</ul>' +
    '</div>';

  el.classList.add('is-open');
  if (shell) shell.classList.add('k-mega-open');

  el.querySelectorAll('.k-mega-item').forEach(function(item) {
    var go = function() {
      var c  = item.dataset.cat;
      var sc = item.dataset.subcat;
      // FIX Bug A — passer subcat directement à setActiveCat au lieu d'émettre
      // un event 'subcat:select' qui n'avait aucun consommateur dans la codebase.
      setActiveCat(c, sc || null);
      syncRailActiveState(c, { center: true });
      renderSubcatRail(c);
      _close();
    };
    item.addEventListener('click', go);
    item.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
    });
  });
}

function setupMegaMenu() {
  if (!isDesktop()) return;

  // Délégation sur .k-cats — fonctionne même si les chips sont re-rendues
  var catsEl = document.querySelector('.k-cats');
  if (!catsEl) return;

  catsEl.addEventListener('mouseenter', function(e) {
    var chip = e.target.closest('.k-chip');
    if (chip) { _clearTimer(); _openForChip(chip); }
  }, true);

  catsEl.addEventListener('mouseleave', function(e) {
    // Ne pas fermer si on entre dans le mega
    var to = e.relatedTarget;
    if (_megaEl && _megaEl.contains(to)) return;
    _scheduleClose();
  });

  // Escape ferme
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') _close();
  });

  // Clic hors chips + mega → ferme
  document.addEventListener('click', function(e) {
    if (!_megaEl || !_megaEl.classList.contains('is-open')) return;
    if (_megaEl.contains(e.target)) return;
    if (e.target.closest('.k-cats')) return;
    _close();
  }, true);
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
  var existingStrip = document.querySelector('.k-promo-strip');
  if (existingStrip) return; // already mounted

  var catalogWrap = document.getElementById('k-desktop-catalog-wrap');
  if (!catalogWrap) return;

  var strip = document.createElement('div');
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
    window.scrollTo({ top: 0, behavior: 'smooth' });
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

  var anchor = document.getElementById('k-desktop-catalog-wrap');
  if (!anchor || !anchor.parentNode) return;

  var merch = document.createElement('section');
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
  var _MERCH_DESC = {
    'Soldes':                 'Prix doux, arrivages malins, sélection rapide.',
    'Mode & Beauté':          'Les indispensables à offrir ou à se faire livrer.',
    'Maison':                 'Des produits concrets pour la famille.',
    'Tech':                   'Accessoires, gadgets et produits pratiques.',
    'Bricolage':              'Outillage et quincaillerie introuvables à Moroni.',
    'Créations personnelles': 'Tenues de cérémonie et cadeaux sur-mesure.',
    'Auto':                   'Pièces légères Toyota & Moto, sourcing Dubaï.',
  };
  var _grid = document.createElement('div');
  _grid.className = 'k-home-merch-grid';
  getRailCategories()
    .filter(function(c) { return c.key !== 'all'; })
    .forEach(function(c) {
      var btn = document.createElement('button');
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
      var cat = btn.dataset.cat || 'all';

      if (!state.sectionSubcats) state.sectionSubcats = {};
      Object.keys(state.sectionSubcats).forEach(function(k) {
        state.sectionSubcats[k] = null;
      });

      setActiveCat(cat);

      var top = anchor.getBoundingClientRect().top + window.scrollY - 84;
      window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
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

  document.querySelectorAll('.k-card').forEach(function(card) {
    if (card.querySelector('.k-card-hover-overlay')) return;

    var id = card.dataset.id || '';
    var nameEl = card.querySelector('.k-card-name');
    var priceEl = card.querySelector('.k-card-price');
    var descEl = card.querySelector('.k-card-desc');
    var name = nameEl ? nameEl.textContent.trim() : '';
    var price = priceEl ? priceEl.textContent.trim() : '';
    var desc = descEl ? descEl.textContent.trim() : '';
    var liked = !!card.querySelector('.k-card-fav.liked, .k-card-fav.is-liked');

    var overlay = document.createElement('div');
    overlay.className = 'k-card-hover-overlay';
    overlay.innerHTML =
      '<div class="k-card-hover-content">' +
        '<div class="k-card-hover-name">' + esc(name) + '</div>' +
        (desc ? '<div class="k-card-hover-desc">' + esc(desc) + '</div>' : '') +
        (price ? '<div class="k-card-price-eur-hover">' + esc(price) + '</div>' : '') +
        '<div class="k-card-hover-actions">' +
          '<button class="k-card-quick-view" type="button" data-id="' + esc(id) + '">' +
            '<svg viewBox="0 0 24 24"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>' +
            'Aperçu' +
          '</button>' +
          '<button class="k-card-hover-fav' + (liked ? ' liked' : '') + '" type="button" aria-label="Favori">♡</button>' +
          '<button class="k-card-hover-add" type="button" aria-label="Ajouter au panier">' +
            '<img src="/images/panier_tresse_vert.png" width="22" height="22" alt="">' +
          '</button>' +
        '</div>' +
      '</div>';

    card.appendChild(overlay);
  });

  if (!window.__komerceCardHoverOverlayBound) {
    window.__komerceCardHoverOverlayBound = true;

    document.addEventListener('click', function(e) {
      var quick = e.target.closest('.k-card-quick-view');
      var fav = e.target.closest('.k-card-hover-fav');
      var add = e.target.closest('.k-card-hover-add');

      if (!quick && !fav && !add) return;

      e.preventDefault();
      e.stopPropagation();

      var card = e.target.closest('.k-card');
      if (!card) return;

      if (quick) {
        var id = quick.dataset.id || card.dataset.id;
        if (id) openModal(id);
        return;
      }

      if (fav) {
        var realFav = card.querySelector('.k-card-fav');
        if (realFav) realFav.click();
        fav.classList.toggle('liked');
        return;
      }

      if (add) {
        var realAdd = card.querySelector('.k-card-add');
        if (realAdd) realAdd.click();
        return;
      }
    }, true);
  }
}

function setupCardHoverObserver() {
  if (!isDesktop()) return;

  var grid = document.getElementById('k-grid');
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
  if (!isDesktop()) return;

  var media = document.querySelector('#k-hero-fixed-wrap .k-hero-media');
  if (!media) return;

  // Éviter double-injection
  if (document.getElementById('k-optionb-search')) return;

  var wrap = document.createElement('div');
  wrap.id = 'k-optionb-search';
  wrap.setAttribute('role', 'search');
  wrap.setAttribute('aria-label', 'Rechercher dans la boutique');

  var input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Envoyez ce qui compte, partout aux Comores…';
  input.setAttribute('autocomplete', 'off');
  input.setAttribute('aria-label', 'Recherche produits');

  var btn = document.createElement('button');
  btn.type = 'button';
  btn.setAttribute('aria-label', 'Lancer la recherche');
  btn.innerHTML = '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';

  wrap.appendChild(input);
  wrap.appendChild(btn);
  media.appendChild(wrap);

  // Délégation : synchroniser avec le champ de recherche du header si présent
  function _delegateSearch(val) {
    var headerInput = document.getElementById('k-search-input') ||
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
    var isShop = tab === 'shop';
    var merch    = document.querySelector('.k-home-merch');
    var strip    = document.querySelector('.k-promo-strip');
    var scrollTop = document.querySelector('.k-scroll-top');
    if (merch)     merch.style.display        = isShop ? '' : 'none';
    if (strip)     strip.style.display        = isShop ? '' : 'none';
    if (scrollTop) scrollTop.classList.toggle('is-visible', isShop && window.scrollY > 600);
  });
}

// ═══════════════════════════════════════════════════════════════
//  ENTRY POINT
// ═══════════════════════════════════════════════════════════════

export function setupCatalogDesktopEnhancers() {
  if (!isDesktop()) return;
  setupMegaMenu();
  setupPromoStrip();
  setupHomepageMerchandising();
  setupHeroSearchBar();
  // Bug 12 fix : setupCardHoverOverlay() retiré ici — appelé à ce stade sur 0 cartes
  // (loadProducts pas encore résolu). setupCardHoverObserver() pose un MutationObserver
  // qui l'appelle dès que les cartes apparaissent.
  setupCardHoverObserver();
  _setupViewChangedGuard();
}
