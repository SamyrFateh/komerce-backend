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
import {
  buildModalViewModel, applyModalClasses,
} from './view-models/modal-view-model.js'; // PR-M1 — classes contractuelles modal

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
//  PRIX HÉRO — KMF coral grande taille + prix barré + équivalent EUR
// ═══════════════════════════════════════════════════════════════
// Remplace injectAedPrice (dual-currency AED, inutile pour le marché comorien).
// Taux KMF → EUR : 1 KMF ≈ 0.00204 EUR (approximatif, à remplacer par API de change).

var _KMF_TO_EUR = 0.00204;

function injectPriceHero() {
  if (!isDesktop()) return;
  var el = document.getElementById('k-modal-aed-price');
  if (!el) return;
  var product = state.modalProduct;
  // PR-M3 : visibilité gérée par CSS via .k-modal--has-promo (ModalViewModel).
  // Ne pas poser de style.display inline — le CSS fait le travail.
  if (!product || !product.price_kmf) { el.innerHTML = ''; return; }

  el.innerHTML = '';

  // Ligne unique : "≈ 6 €" + badge promo si présent
  // Le prix KMF est déjà affiché par k-modal-price-row — on ne le duplique pas.
  var eurVal = Math.round(product.price_kmf * _KMF_TO_EUR);

  if (eurVal > 0) {
    var eurEl = document.createElement('span');
    eurEl.className = 'k-modal-eur-ref';

    // Prix barré EUR si promo
    if (product.original_price_kmf && product.original_price_kmf > product.price_kmf) {
      var oldEur = Math.round(product.original_price_kmf * _KMF_TO_EUR);
      eurEl.innerHTML =
        '≈ <strong>' + eurVal + ' €</strong>'
        + '<s>' + oldEur + ' €</s>';
    } else {
      eurEl.innerHTML = '≈ <strong>' + eurVal + ' €</strong>';
    }
    el.appendChild(eurEl);
  }

  // Badge % sobre si promo_pct
  if (product.promo_pct) {
    var pctEl = document.createElement('span');
    pctEl.className = 'k-modal-aed-pct';
    pctEl.textContent = '-' + product.promo_pct + '%';
    el.appendChild(pctEl);
  }

  // Chantier 2 — mention "· économie X KMF" en fin de ligne aed-price.
  // L'ancien prix dérive de promo_pct via la même formule que b-modal.js
  // openModal : Math.round(price / (1 - promo_pct / 100)). Source unique.
  if (product.promo_pct && product.price_kmf) {
    var oldPrice = Math.round(product.price_kmf / (1 - product.promo_pct / 100));
    var saving = oldPrice - product.price_kmf;
    if (saving > 0) {
      var saveEl = document.createElement('span');
      saveEl.className = 'k-modal-price-saving';
      saveEl.innerHTML = '<span class="k-modal-price-saving-sep" aria-hidden="true">·</span>'
                       + 'économie ' + new Intl.NumberFormat('fr-FR').format(saving) + ' KMF';
      el.appendChild(saveEl);
    }
  }
}

// ═══════════════════════════════════════════════════════════════
//  NEW — FLASH TIMER + BARRE DE STOCK
// ═══════════════════════════════════════════════════════════════

let _flashTimerInterval = null;
let _enhancersInstalled = false;
let _vmListenerInstalled = false; // PR-M1 — flag séparé pour le listener ModalViewModel (mobile + desktop)

function _stopFlashTimer() {
  if (_flashTimerInterval) {
    clearInterval(_flashTimerInterval);
    _flashTimerInterval = null;
  }
}

function _startFlashTimer(totalSeconds) {
  _stopFlashTimer();
  var remaining = totalSeconds;
  function _tick() {
    var el = document.getElementById('k-modal-flash-timer');
    if (!el) { _stopFlashTimer(); return; }
    var m = Math.floor(remaining / 60);
    var s = remaining % 60;
    el.textContent = String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
    if (remaining <= 0) { _stopFlashTimer(); return; }
    remaining--;
  }
  _tick();
  _flashTimerInterval = setInterval(_tick, 1000);
}

function injectFlashAndStock() {
  if (!isDesktop()) return;
  var product = state.modalProduct;
  if (!product) return;

  // FIX 2026-05-20 — Bandeau promo sobre, SANS timer aléatoire.
  // Conditionné sur product.promo_pct (donnée réelle backend).
  // Pour un vrai compte à rebours lié à une offre datée :
  //   conditionner sur product.flash_end_at et calculer la durée restante.
  var flashEl = document.getElementById('k-modal-flash-bar');
  if (flashEl) {
    flashEl.innerHTML = '';
    if (product.promo_pct) {
      flashEl.innerHTML =
        '<span class="k-modal-flash-icon" aria-hidden="true"></span>' +
        '<span class="k-modal-flash-label">Offre promotionnelle</span>' +
        '<span class="k-modal-flash-pct">-' + product.promo_pct + '%</span>' +
        '<span class="k-modal-flash-suffix">sur ce produit</span>';
    }
  }

  // FIX 2026-05-20 — Stock réel, texte sobre, PAS de barre ni de % simulé.
  // Affiché uniquement si product.stock est connu (> 0) et faible (≤ 20).
  // Le seuil 20 est ajustable selon les réalités du catalogue.
  var stockBarEl = document.getElementById('k-modal-stock-bar');
  if (stockBarEl) {
    stockBarEl.innerHTML = '';
    var stockVal = Number(product.stock || 0);
    if (stockVal > 0 && stockVal <= 20) {
      stockBarEl.innerHTML =
        '<span class="k-modal-stock-line-icon" aria-hidden="true"></span>' +
        stockVal + '\u202farticle' + (stockVal > 1 ? 's' : '') +
        ' disponible' + (stockVal > 1 ? 's' : '');
    }
  }
}

// ═══════════════════════════════════════════════════════════════
//  NEW — SECTION LIVRAISON (point relais, 3-5 semaines)
// ═══════════════════════════════════════════════════════════════

function injectDelivery() {
  if (!isDesktop()) return;
  var el = document.getElementById('k-modal-delivery');
  if (!el) return;
  el.innerHTML = '';

  el.innerHTML =
    '<div class="k-modal-section-title">Livraison</div>' +
    '<div class="k-modal-delivery-opt is-active" data-delivery="relay">' +
      '<div class="k-modal-opt-radio"></div>' +
      '<div class="k-modal-opt-body">' +
        '<div class="k-modal-opt-row1">' +
          '<span class="k-modal-opt-icon">📦</span>' +
          '<span>Point relais</span>' +
          '<span class="k-modal-opt-free">Gratuit</span>' +
        '</div>' +
        '<div class="k-modal-opt-row2">Délai estimé : 3 à 5 semaines</div>' +
        '<div class="k-modal-islands">' +
          '<span class="k-modal-island-chip">Grande Comore</span>' +
          '<span class="k-modal-island-chip">Anjouan</span>' +
          '<span class="k-modal-island-chip">Mohéli</span>' +
        '</div>' +
      '</div>' +
    '</div>';
}

// ═══════════════════════════════════════════════════════════════
//  NEW — SECTION PAIEMENT (4 options)
// ═══════════════════════════════════════════════════════════════

function injectPayment() {
  if (!isDesktop()) return;
  var el = document.getElementById('k-modal-payment');
  if (!el) return;
  el.innerHTML = '';

  var opts = [
    {
      key: 'stripe',
      icon: '💳',
      label: 'Carte bancaire',
      sub: 'Visa, Mastercard — paiement sécurisé',
      badge: '<span class="k-modal-pay-badge k-modal-pay-badge--stripe">Stripe</span>',
      active: true,
    },
    {
      key: 'cash',
      icon: '💵',
      label: 'Paiement à la livraison',
      sub: 'En espèces à la réception',
      badge: '',
      active: false,
    },
    {
      key: 'group',
      icon: '👥',
      label: 'Panier partagé',
      sub: 'Invitez des proches à contribuer',
      badge: '<span class="k-modal-pay-badge k-modal-pay-badge--group">Partage</span>',
      active: false,
    },
    {
      key: 'pot',
      icon: '🎁',
      label: 'Cagnotte collective',
      sub: 'Offrir ensemble, payer ensemble',
      badge: '<span class="k-modal-pay-badge k-modal-pay-badge--group">Collectif</span>',
      active: false,
    },
  ];

  var html = '<div class="k-modal-section-title">Paiement</div><div class="k-modal-payment-opts">';
  opts.forEach(function(o) {
    html +=
      '<div class="k-modal-payment-opt' + (o.active ? ' is-active' : '') + '" data-pay="' + o.key + '">' +
        '<div class="k-modal-opt-radio"></div>' +
        '<span class="k-modal-pay-icon">' + o.icon + '</span>' +
        '<span class="k-modal-pay-label">' +
          o.label +
          '<span class="k-modal-pay-sub">' + o.sub + '</span>' +
        '</span>' +
        o.badge +
      '</div>';
  });
  html += '</div>';
  el.innerHTML = html;

  // Interaction : sélection radio
  el.querySelectorAll('.k-modal-payment-opt').forEach(function(opt) {
    opt.addEventListener('click', function() {
      el.querySelectorAll('.k-modal-payment-opt').forEach(function(o) {
        o.classList.remove('is-active');
      });
      opt.classList.add('is-active');
    });
  });
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
//  PR-M1 — ModalViewModel : classes contractuelles (mobile + desktop)
// ═══════════════════════════════════════════════════════════════

/**
 * Traduit le produit ouvert en ViewModel et pose les classes contractuelles
 * sur .k-modal. Idempotent : peut s'exécuter en plus du code existant qui
 * pose déjà k-modal--has-promo manuellement dans b-modal.js (pas de conflit,
 * applyModalClasses normalise tout).
 *
 * S'exécute mobile ET desktop — les classes pilotent le CSS dans les deux
 * contextes (ex: F1 prix coral mobile utilise déjà k-modal--has-promo).
 *
 * @param {Object} product - Produit brut émis par bus 'modal:opened'.
 */
function _applyModalContractClasses(product) {
  if (!product || !dom.modal) return;
  try {
    const vm = buildModalViewModel(product);
    applyModalClasses(dom.modal, vm);
    // Exposer le ViewModel pour debug / inspection en console
    state._currentModalViewModel = vm;
  } catch (err) {
    // En cas d'erreur de normalisation : on ne casse rien, on log et on continue.
    // Le code legacy de b-modal.js continue de poser ses propres classes.
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('[modal-view-model] build failed, falling back to legacy classes:', err);
    }
  }
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
    // ── Nouvelles zones Temu-style ──
    injectPriceHero();
    injectFlashAndStock();
    injectDelivery();
    injectPayment();
    // ── Zones existantes ──
    injectTrustBadges();
    injectSpecs();
    injectShareRow();
    injectRecentlyViewed();
    updateSubtotal();
    // DÉSACTIVÉ 2026-05-19 : zoom loupe Temu sur l'image retiré sur demande
    // produit. Pour réactiver : décommenter la ligne ci-dessous. Les fonctions
    // setupZoom / _onZoomMove / _onZoomLeave restent dans le fichier.
    // setupZoom();
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

/**
 * PR-M1 — Setup du listener ModalViewModel.
 *
 * Appelé depuis main.js TOUJOURS (mobile + desktop), contrairement à
 * setupModalDesktopEnhancers() qui ne tourne qu'en desktop.
 *
 * Idempotent : flag _vmListenerInstalled empêche les doubles branchements.
 */
export function setupModalContractClasses() {
  if (_vmListenerInstalled) return;
  _vmListenerInstalled = true;
  bus.on('modal:opened', _applyModalContractClasses);
}

export function setupModalDesktopEnhancers() {
  if (!isDesktop()) return;
  if (_enhancersInstalled) return;
  _enhancersInstalled = true;
  bus.on('modal:opened', _onModalOpened);
  // Nettoyer le timer flash quand la modal se ferme
  bus.on('modal:close', function() { _stopFlashTimer(); });
  _setupQtyObserver();
}
