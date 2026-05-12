/**
 * b-desktop-upgrade.js — Module ES · Refonte desktop Temu-inspired
 *
 * Fonctionnalités greffées (desktop ≥ 900px uniquement) :
 *   1. Mega-menu hover sur la sidebar (sous-catégories en panneau)
 *   2. Zoom image au hover dans la modal (Temu-style lens)
 *   3. Breadcrumb catégorie dans la topbar modal
 *   4. Panneau partage WhatsApp dans la modal
 *   5. Accordéon specs/détails dans la modal
 *   6. Trust badges (retrait relais, paiement cash, stock garanti)
 *   7. Sous-total dynamique dans les actions modal
 *   8. Bannière promo strip sous le hero
 *   9. Scroll-to-top button
 *  10. Hover overlay riche sur les cartes produit
 *
 * Architecture :
 *   - Aucun module existant modifié (pas de changement à b-modal.js, b-catalog.js, etc.)
 *   - Se branche via bus events + DOM délégué
 *   - Tout est no-op si < 900px
 *
 * Intégration :
 *   - Importé dans main.js APRÈS boutique.js
 *   - CSS chargé via desktop-upgrade.css dans index.html
 */

import { bus }              from './b-bus.js';
import { state, dom }       from './b-store.js';
import { fmtPrice }         from './b-utils.js';
import { cartQty, showToast } from './b-cart-core.js';
import { openModal }          from './b-modal.js';
import { isFav }              from './b-cart-core.js';
import {
  normalizeCategoryKey,
  getCategorySectionEmoji,
  getSubcategories,
}                           from './shop-schema.js';
import { setActiveCat }                   from './b-catalog.js';
import { syncRailActiveState, renderSubcatRail } from './controllers/home-controller.js';
import { isDesktop }        from './b-scroll-owner.js';

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
  var shell = document.querySelector('.k-cats-shell');
  var shellRect = shell ? shell.getBoundingClientRect() : { bottom: 120, left: 0, width: window.innerWidth };
  el.style.top   = (shellRect.bottom + window.scrollY) + 'px';
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
//  2. ZOOM IMAGE — Loupe Temu dans la modal
// ═══════════════════════════════════════════════════════════════

let _zoomLens = null;
let _zoomPreview = null;

function setupZoom() {
  if (!isDesktop()) return;

  var imgWrap = dom.modal ? dom.modal.querySelector('.k-modal-img-wrap') : null;
  if (!imgWrap) return;

  var carousel = imgWrap.querySelector('.k-modal-carousel');
  if (!carousel) return;

  imgWrap.querySelectorAll('.k-modal-zoom-lens, .k-modal-zoom-preview').forEach(function(el) {
    el.remove();
  });

  // Lentille : carré semi-transparent qui suit le curseur sur l'image source
  _zoomLens = document.createElement('div');
  _zoomLens.className = 'k-modal-zoom-lens';
  imgWrap.appendChild(_zoomLens);

  _zoomPreview = document.createElement('div');
  _zoomPreview.className = 'k-modal-zoom-preview';
  imgWrap.appendChild(_zoomPreview);

  carousel.removeEventListener('mousemove', _onZoomMove);
  carousel.removeEventListener('mouseleave', _onZoomLeave);
  carousel.addEventListener('mousemove', _onZoomMove);
  carousel.addEventListener('mouseleave', _onZoomLeave);
}

function _onZoomMove(e) {
  if (!_zoomPreview) return;

  var carousel = e.currentTarget;
  var rect = carousel.getBoundingClientRect();
  var x = e.clientX - rect.left;
  var y = e.clientY - rect.top;

  var track = carousel.querySelector('.k-modal-carousel-track');
  if (!track) return;

  var slides = track.querySelectorAll('.k-modal-slide');
  var idx = state.carouselIndex || 0;
  var img = slides[idx];
  if (!img || !img.src) return;

  // Toujours utiliser la version haute résolution pour le zoom (sinon flou)
  // Cloudinary format : ,w_800/ → ,w_1600/
  var zoomSrc = img.src.replace(/(,w_)\d+(\/|,)/, '$11600$2');
  if (zoomSrc === img.src && img.dataset.zoomSrc) zoomSrc = img.dataset.zoomSrc;

  var px = Math.max(0, Math.min(100, (x / rect.width) * 100));
  var py = Math.max(0, Math.min(100, (y / rect.height) * 100));

  _zoomPreview.style.backgroundImage = 'url(' + zoomSrc + ')';
  _zoomPreview.style.backgroundPosition = px + '% ' + py + '%';
  _zoomPreview.classList.add('is-active');

  // Lentille : centrée sur le curseur, clampée dans le conteneur.
  // Sa taille est 36% du wrap (cohérent avec --zoom-bg-size 280%).
  if (_zoomLens) {
    var lensW = rect.width  * 0.36;
    var lensH = rect.height * 0.36;
    var lx = Math.max(0, Math.min(rect.width  - lensW, x - lensW / 2));
    var ly = Math.max(0, Math.min(rect.height - lensH, y - lensH / 2));
    _zoomLens.style.width  = lensW + 'px';
    _zoomLens.style.height = lensH + 'px';
    _zoomLens.style.left   = lx + 'px';
    _zoomLens.style.top    = ly + 'px';
    _zoomLens.classList.add('is-active');
  }
}

function _onZoomLeave() {
  if (_zoomLens) _zoomLens.classList.remove('is-active');
  if (_zoomPreview) _zoomPreview.classList.remove('is-active');
}

// ═══════════════════════════════════════════════════════════════
//  3. BREADCRUMB — Navigation contexte dans la topbar modal
// ═══════════════════════════════════════════════════════════════

function injectBreadcrumb() {
  if (!isDesktop()) return;
  var topbar = dom.modal ? dom.modal.querySelector('.k-modal-topbar') : null;
  if (!topbar) return;
  var product = state.modalProduct;
  if (!product) return;

  // Remove old breadcrumb
  var old = topbar.querySelector('.k-modal-breadcrumb');
  if (old) old.remove();

  var cat = product.category || '';
  var name = product.name || '';

  var bc = document.createElement('div');
  bc.className = 'k-modal-breadcrumb';
  bc.innerHTML =
    '<span class="k-modal-breadcrumb-cat" data-cat="' + cat + '">Boutique</span>' +
    '<span class="k-modal-breadcrumb-sep">›</span>' +
    '<span class="k-modal-breadcrumb-cat" data-cat="' + cat + '">' + cat + '</span>' +
    '<span class="k-modal-breadcrumb-sep">›</span>' +
    '<span class="k-modal-breadcrumb-name">' + name + '</span>';

  // Insert after the back button
  var backBtn = topbar.querySelector('.k-modal-back');
  if (backBtn && backBtn.nextSibling) {
    topbar.insertBefore(bc, backBtn.nextSibling);
  } else {
    topbar.appendChild(bc);
  }

  // Click on breadcrumb cat → close modal, filter catalog
  bc.querySelectorAll('.k-modal-breadcrumb-cat').forEach(function(el) {
    el.addEventListener('click', function() {
      var c = el.dataset.cat;
      if (c) {
        var _cat = normalizeCategoryKey(c) || c;
        bus.emit('modal:close');
        setActiveCat(_cat);
      }
    });
  });
}

// ═══════════════════════════════════════════════════════════════
//  4. SHARE — Bouton partage WhatsApp dans la modal
// ═══════════════════════════════════════════════════════════════

function injectShareRow() {
  if (!isDesktop()) return;
  var info = dom.modal ? dom.modal.querySelector('.k-modal-info') : null;
  if (!info) return;
  var product = state.modalProduct;
  if (!product) return;

  // Remove old
  var old = info.querySelector('.k-modal-share-row');
  if (old) old.remove();

  var url = window.location.origin + '/?p=' + product.id;
  var text = encodeURIComponent(
    '👀 Regarde ce que j\'ai trouvé sur Komerce !\n' +
    (product.name || '') + ' — ' + fmtPrice(product.price_kmf) + '\n' + url
  );

  var row = document.createElement('div');
  row.className = 'k-modal-share-row';
  row.innerHTML =
    '<button class="k-modal-share-btn k-modal-share-btn--wa" data-href="https://wa.me/?text=' + text + '">' +
      '<svg viewBox="0 0 24 24" fill="#fff"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.625.846 5.059 2.284 7.034L.789 23.492l4.634-1.215A11.95 11.95 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.75c-2.115 0-4.142-.578-5.906-1.672l-.424-.252-4.396 1.153 1.174-4.291-.276-.44A9.71 9.71 0 012.25 12 9.75 9.75 0 0112 2.25 9.75 9.75 0 0121.75 12 9.75 9.75 0 0112 21.75z"/></svg>' +
      'Partager via WhatsApp' +
    '</button>' +
    '<button class="k-modal-share-btn" data-action="copy">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>' +
      'Copier le lien' +
    '</button>';

  info.appendChild(row);

  row.querySelector('.k-modal-share-btn--wa').addEventListener('click', function() {
    window.open(this.dataset.href, '_blank');
  });
  row.querySelector('[data-action="copy"]').addEventListener('click', function() {
    navigator.clipboard.writeText(url).then(function() {
      // FIX Bug E — bus.emit('toast') n'avait aucun listener ; appel direct comme partout ailleurs.
      showToast('🔗 Lien copié !');
    });
  });
}

// ═══════════════════════════════════════════════════════════════
//  5. SPECS ACCORDION — Détails produit dans la modal
// ═══════════════════════════════════════════════════════════════

function injectSpecs() {
  if (!isDesktop()) return;
  var info = dom.modal ? dom.modal.querySelector('.k-modal-info') : null;
  if (!info) return;
  var product = state.modalProduct;
  if (!product) return;

  var old = info.querySelector('.k-modal-specs');
  if (old) old.remove();

  var stockVal = Number(product.stock || 0);
  var cat = product.category || 'Non catégorisé';
  var weight = product.weight_kg ? (product.weight_kg + ' kg') : '—';

  var specs = document.createElement('div');
  specs.className = 'k-modal-specs';
  // PR-D 2.1 : ouvert par défaut sur desktop (les specs sont la zone d'info
  // technique, on évite à l'utilisateur de cliquer pour voir des données utiles).
  specs.innerHTML =
    '<button class="k-modal-spec-toggle is-open">' +
      'Détails du produit' +
      '<svg class="k-modal-spec-toggle-arrow" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg>' +
    '</button>' +
    '<div class="k-modal-spec-body is-open">' +
      '<table class="k-modal-spec-table">' +
        '<tr><td>Catégorie</td><td>' + cat + '</td></tr>' +
        '<tr><td>Référence</td><td>#' + product.id + '</td></tr>' +
        '<tr><td>Stock</td><td>' + (stockVal > 0 ? stockVal + ' unité' + (stockVal > 1 ? 's' : '') : 'Rupture') + '</td></tr>' +
        '<tr><td>Poids estimé</td><td>' + weight + '</td></tr>' +
        (product.promo_pct ? '<tr><td>Promotion</td><td>-' + product.promo_pct + '%</td></tr>' : '') +
      '</table>' +
    '</div>';

  // Insert before share row if exists, otherwise append
  var shareRow = info.querySelector('.k-modal-share-row');
  if (shareRow) {
    info.insertBefore(specs, shareRow);
  } else {
    info.appendChild(specs);
  }

  var toggle = specs.querySelector('.k-modal-spec-toggle');
  var body = specs.querySelector('.k-modal-spec-body');
  toggle.addEventListener('click', function() {
    var open = toggle.classList.toggle('is-open');
    body.classList.toggle('is-open', open);
  });
}

// ═══════════════════════════════════════════════════════════════
//  6. TRUST BADGES — Réassurance dans la modal
// ═══════════════════════════════════════════════════════════════

function injectTrustBadges() {
  if (!isDesktop()) return;
  var info = dom.modal ? dom.modal.querySelector('.k-modal-info') : null;
  if (!info) return;

  var old = info.querySelector('.k-modal-trust');
  if (old) old.remove();

  var trust = document.createElement('div');
  trust.className = 'k-modal-trust';
  trust.innerHTML =
    '<span class="k-modal-trust-item">' +
      '<svg viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>' +
      'Paiement sécurisé' +
    '</span>' +
    '<span class="k-modal-trust-item">' +
      '<svg viewBox="0 0 24 24"><rect x="1" y="3" width="15" height="13" rx="2"/><path d="M16 8l4 2v6l-4 2"/></svg>' +
      'Retrait en relais' +
    '</span>' +
    '<span class="k-modal-trust-item">' +
      '<svg viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>' +
      'Stock garanti' +
    '</span>';

  // Insert before specs
  var specsEl = info.querySelector('.k-modal-specs');
  if (specsEl) {
    info.insertBefore(trust, specsEl);
  } else {
    info.appendChild(trust);
  }
}

// ═══════════════════════════════════════════════════════════════
//  7. SUBTOTAL — Prix dynamique dans les actions modal
// ═══════════════════════════════════════════════════════════════

function updateSubtotal() {
  // Visible sur mobile ET desktop : sous-total dynamique dans les actions modal
  var actions = dom.modal ? dom.modal.querySelector('.k-modal-actions') : null;
  if (!actions) return;
  var product = state.modalProduct;
  if (!product) return;

  var qty = state.modalQty || 1;
  var sub = product.price_kmf * qty;

  var el = actions.querySelector('.k-modal-subtotal');
  if (!el) {
    el = document.createElement('div');
    el.className = 'k-modal-subtotal';
    actions.appendChild(el);
  }
  el.innerHTML = 'Sous-total : <strong>' + fmtPrice(sub) + '</strong>';
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
  merch.innerHTML =
    '<div class="k-home-merch-head">' +
      '<div>' +
        '<span class="k-home-merch-kicker">Sélections Komerce</span>' +
        '<h2>Les raccourcis pour trouver vite et bien</h2>' +
      '</div>' +
      '<button class="k-home-merch-all" type="button" data-cat="all">Voir tout le catalogue →</button>' +
    '</div>' +
    '<div class="k-home-merch-grid">' +
      '<button class="k-home-merch-card k-home-merch-card--hot" type="button" data-cat="Soldes">' +
        '<span class="k-home-merch-icon">🏷️</span>' +
        '<strong>Promos & bonnes affaires</strong>' +
        '<small>Prix doux, arrivages malins, sélection rapide.</small>' +
      '</button>' +
      '<button class="k-home-merch-card" type="button" data-cat="Mode & Beauté">' +
        '<span class="k-home-merch-icon">✨</span>' +
        '<strong>Mode & beauté</strong>' +
        '<small>Les indispensables à offrir ou à se faire livrer.</small>' +
      '</button>' +
      '<button class="k-home-merch-card" type="button" data-cat="Tech">' +
        '<span class="k-home-merch-icon">📱</span>' +
        '<strong>Tech utile</strong>' +
        '<small>Accessoires, gadgets et produits pratiques.</small>' +
      '</button>' +
      '<button class="k-home-merch-card" type="button" data-cat="Maison">' +
        '<span class="k-home-merch-icon">🏠</span>' +
        '<strong>Maison & quotidien</strong>' +
        '<small>Des produits concrets pour la famille.</small>' +
      '</button>' +
    '</div>';

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
//  10. SCROLL-TO-TOP BUTTON
// ═══════════════════════════════════════════════════════════════

function setupScrollToTop() {
  if (!isDesktop()) return;
  var existing = document.querySelector('.k-scroll-top');
  if (existing) return;

  var btn = document.createElement('button');
  btn.className = 'k-scroll-top';
  btn.setAttribute('aria-label', 'Retour en haut');
  btn.innerHTML = '<svg viewBox="0 0 24 24"><polyline points="18 15 12 9 6 15"/></svg>';
  document.body.appendChild(btn);

  btn.addEventListener('click', function() {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  // Show/hide on scroll
  var _ticking = false;
  window.addEventListener('scroll', function() {
    if (_ticking) return;
    _ticking = true;
    requestAnimationFrame(function() {
      btn.classList.toggle('is-visible', window.scrollY > 600);
      _ticking = false;
    });
  }, { passive: true });
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
//  10. RECENTLY VIEWED — Section "Vu récemment" en bas du modal (desktop)
// ═══════════════════════════════════════════════════════════════

/**
 * Affiche les 8 derniers produits vus (hors le courant) sous les suggestions.
 * Desktop uniquement — sur mobile, garder la modal légère.
 * Lecture depuis state.viewedHistory (alimenté dans b-modal.js openModal,
 * persisté en localStorage).
 */
function injectRecentlyViewed() {
  if (!isDesktop()) return;
  var scrollEl = dom.modal ? dom.modal.querySelector('.k-modal-scroll') : null;
  if (!scrollEl) return;
  var product = state.modalProduct;
  if (!product) return;

  // Reconstruit la liste : IDs récents, hors le courant, croisés avec products dispo,
  // puis on garde les 8 derniers (les plus récents en queue de viewedHistory).
  var history = (state.viewedHistory || []).slice();
  var recentIds = history.filter(function(id) { return id !== product.id; });
  // On les renverse pour avoir le plus récent en premier
  recentIds.reverse();
  var recents = recentIds
    .map(function(id) { return state.products.find(function(p) { return p.id === id; }); })
    .filter(Boolean)
    .slice(0, 8);

  // Si rien à afficher, on retire l'éventuelle ancienne section
  var old = scrollEl.querySelector('.k-modal-recent');
  if (old) old.remove();
  if (recents.length === 0) return;

  var section = document.createElement('div');
  section.className = 'k-modal-recent';
  section.innerHTML =
    '<h3 class="k-modal-recent-title">Vu récemment</h3>' +
    '<div class="k-modal-recent-grid">' +
      recents.map(function(p) {
        return '<button class="k-modal-recent-card" data-pid="' + p.id + '" type="button">' +
          '<div class="k-modal-recent-img">' +
            '<img src="' + (p.image_url || '') + '" alt="" loading="lazy">' +
          '</div>' +
          '<div class="k-modal-recent-name">' + (p.name || '') + '</div>' +
          '<div class="k-modal-recent-price">' + fmtPrice(p.price_kmf) + '</div>' +
        '</button>';
      }).join('') +
    '</div>';

  scrollEl.appendChild(section);

  // Click → ouvrir la fiche du produit
  section.querySelectorAll('.k-modal-recent-card').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var id = btn.getAttribute('data-pid');
      if (id) openModal(id, true);
    });
  });
}

// ═══════════════════════════════════════════════════════════════
//  ORCHESTRATION — Hook into modal open + init
// ═══════════════════════════════════════════════════════════════

/**
 * Called after each modal open to inject desktop enhancements.
 * Listens on bus 'modal:opened' emitted by b-modal.js after classList.add('open').
 */
function _onModalOpened() {
  if (!isDesktop()) return;
  // Small delay to let b-modal.js finish rendering
  requestAnimationFrame(function() {
    injectBreadcrumb();
    injectTrustBadges();
    injectSpecs();
    injectShareRow();
    injectRecentlyViewed();
    updateSubtotal();
    setupZoom();
  });
}

// Listen for qty changes to update subtotal
function _setupQtyObserver() {
  if (!isDesktop()) return;
  var qtyVal = document.getElementById('k-qty-val');
  if (!qtyVal) return;
  var obs = new MutationObserver(function() {
    updateSubtotal();
  });
  obs.observe(qtyVal, { childList: true, characterData: true, subtree: true });
}

// ═══════════════════════════════════════════════════════════════
//  INIT — Point d'entrée unique
// ═══════════════════════════════════════════════════════════════

// ── Side cart sticky top — source de vérité unique ─────────────────────
// Calcule --sc-sticky-top = hauteur des éléments sticky au-dessus du catalogue:
//   header + k-cats-shell (chips) + k-subcats-wrap (rail subcats si visible) + 16px marge
// Appelé au load, au resize, et quand k-subcats-wrap change (MutationObserver).
function _updateSideCartStickyTop() {
  if (!isDesktop()) return;
  var header    = document.querySelector('.k-header');
  var cats      = document.querySelector('.k-cats-shell');   // display:none desktop → 0
  var pavilions = document.getElementById('k-pavilions');    // sticky en desktop, remplace les chips
  var subcats   = document.getElementById('k-subcats-wrap');
  var h = (header    ? header.offsetHeight    : 76)
        + (cats      ? cats.offsetHeight      : 0)
        + (pavilions ? pavilions.offsetHeight : 0)           // pavillons sticky sous le header
        + (subcats && subcats.offsetHeight && subcats.children.length ? subcats.offsetHeight : 0)
        + 16;
  document.documentElement.style.setProperty('--sc-sticky-top', h + 'px');
}

export function setupDesktopUpgrade() {
  if (!isDesktop()) return;

  setupMegaMenu();
  setupPromoStrip();
  setupHomepageMerchandising();
  setupScrollToTop();
  // Bug 12 fix : setupCardHoverOverlay() retiré ici — appelé à ce stade sur 0 cartes (loadProducts pas encore résolu).
  // setupCardHoverObserver() pose un MutationObserver qui l'appelle dès que les cartes apparaissent.
  setupCardHoverObserver();

  // Bug 7 fix : _onModalOpened() était déclenché deux fois (MutationObserver + bus.on).
  // b-modal.js fait classList.add('open') puis bus.emit('modal:opened') de façon synchrone →
  // les deux fires étaient simultanés. On garde uniquement bus.on qui est la source de vérité.
  bus.on('modal:opened', _onModalOpened);

  // Qty observer for subtotal
  _setupQtyObserver();

  // Fix side cart sticky: calcul initial + reactif resize + mutation subcats
  _updateSideCartStickyTop();
  window.addEventListener('resize', _updateSideCartStickyTop, { passive: true });
  var _scSubcatsWrap = document.getElementById('k-subcats-wrap');
  if (_scSubcatsWrap) {
    new MutationObserver(_updateSideCartStickyTop).observe(_scSubcatsWrap, {
      childList: true,
      attributes: true,
      attributeFilter: ['style'],
    });
  }
  // Bug 4 fix : k-cats-shell est dans le DOM au DOMContentLoaded mais ses chips
  // sont rendues de façon asynchrone → offsetHeight = 0 au premier calcul.
  // ResizeObserver rappelle _updateSideCartStickyTop dès que la hauteur change.
  var _scCatsShell = document.querySelector('.k-cats-shell');
  if (_scCatsShell && typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(_updateSideCartStickyTop).observe(_scCatsShell);
  }
  // Pavillons : sticky en desktop, remplacent les chips → observer leur hauteur aussi.
  var _scPavilions = document.getElementById('k-pavilions');
  if (_scPavilions && typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(_updateSideCartStickyTop).observe(_scPavilions);
  }

  // Masquer les éléments desktop exclusifs à la vue shop sur Favoris / Suivi
  bus.on('view:changed', function(tab) {
    var isShop = tab === 'shop';
    var sidebar  = document.getElementById('k-desktop-sidebar');
    var merch    = document.querySelector('.k-home-merch');
    var strip    = document.querySelector('.k-promo-strip');
    var scrollTop = document.querySelector('.k-scroll-top');
    if (sidebar)   sidebar.style.visibility   = isShop ? '' : 'hidden';
    if (merch)     merch.style.display        = isShop ? '' : 'none';
    if (strip)     strip.style.display        = isShop ? '' : 'none';
    if (scrollTop) scrollTop.classList.toggle('is-visible', isShop && window.scrollY > 600);
  });
}

/* ── OPTION B — Injection barre de recherche hero desktop ──────
   Extension ajoutée sans modifier le code existant ci-dessus.
   Injecte #k-optionb-search dans .k-hero-media uniquement sur desktop.
   La barre délègue la recherche au champ header existant (#k-search-input
   ou l'input .k-header-search, selon ce qui est présent dans le DOM).
   Mobile non touché : la div est masquée via display:none @<900px implicitement
   (elle n'existe que dans .k-hero-media qui est display:none mobile). */
(function initOptionBSearch() {
  // Seulement en contexte desktop
  if (window.innerWidth < 900) return;

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
})();
