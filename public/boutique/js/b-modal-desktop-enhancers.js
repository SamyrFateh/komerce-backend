/**
 * @module b-modal-desktop-enhancers
 * @brief Enrichissements desktop ≥ 900px de la modal produit.
 *
 * Branchés sur bus.on('modal:opened') émis par b-modal.js, ils injectent
 * dans la modal :
 *   - breadcrumb catégorie (topbar)
 *   - boutons partage WhatsApp + copier (info)
 *   - accordéon "Détails du produit" (info)
 *   - badges de réassurance paiement/retrait/stock (info)
 *   - sous-total dynamique (actions)
 *   - section "Vu récemment" (bas de scroll)
 *   - lentille de zoom Temu-style sur l'image
 *
 * Mobile : aucun effet (toutes les fonctions sortent sur !isDesktop()).
 *
 * Point d'entrée unique : setupModalDesktopEnhancers().
 * Extrait de b-desktop-upgrade.js (sections 2-7 + 10c + ORCHESTRATION).
 */

import { bus }                  from './b-bus.js';
import { state, dom }           from './b-store.js';
import { fmtPrice }             from './b-utils.js';
import { showToast }            from './b-cart-core.js';
import { openModal }            from './b-modal.js';
import { setActiveCat }         from './b-catalog.js';
import { normalizeCategoryKey } from './shop-schema.js';
import { isDesktop }            from './b-scroll-owner.js';

'use strict';

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
//  ORCHESTRATION — Hook into modal open + qty observer
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
//  ENTRY POINT
// ═══════════════════════════════════════════════════════════════

export function setupModalDesktopEnhancers() {
  if (!isDesktop()) return;
  bus.on('modal:opened', _onModalOpened);
  _setupQtyObserver();
}
