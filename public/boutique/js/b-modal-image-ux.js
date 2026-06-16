/**
 * @komerce-arch
 * @role          product-modal-image-ux
 * @domain        boutique
 * @layer         ui-enhancer
 * @criticality   medium
 * @inputs        product_images, modal_media_state, pointer_events
 * @outputs       image_zoom_state, carousel_interactions, media_focus
 * @depends       b-store.js
 * @used-by       b-modal-core.js
 * @doctrine      image_produit_inspectable, modal_produit_sans_chevauchement
 * @impact-areas  product-modal, media-carousel, product-discovery
 * @version       2026-06
 */

/**
 * @module b-modal-image-ux
 * @brief Expérience image de la modal produit — compteur 1/N et lightbox mobile.
 *
 * Compteur 1/N :
 *   Affiché en bas-droite de l'image quand le produit a > 5 images,
 *   en remplacement des dots (illisibles au-delà de 5).
 *   Fonctionne mobile + desktop.
 *
 * Lightbox plein écran :
 *   Tap sur l'image ou "Voir en grand" → .k-modal-fullscreen
 *   avec swipe horizontal et pinch-zoom natif (touch-action: pinch-zoom).
 *   Mobile uniquement — désactivé sur desktop (zoom loupe géré par setupZoom).
 *
 * Bouton "Voir en grand" :
 *   Injecté dynamiquement dans .k-modal-img-wrap par ce module.
 *   Retiré sur desktop via CSS.
 *
 * Point d'entrée : setupImageUX().
 * À appeler depuis bus.on('modal:opened') dans le bootstrap principal.
 *
 * Dépendances : b-bus.js, b-store.js
 */

import { bus }        from './b-bus.js';
import { state }      from './b-store.js';
import { modalZone }  from './b-store.js';           // S5 — hook DOM centralisé

'use strict';

// Seuil à partir duquel on bascule sur le compteur 1/N au lieu des dots
const COUNTER_THRESHOLD = 5;

// ── État local ────────────────────────────────────────────────
let _fsOpen      = false;
let _fsIdx       = 0;
let _fsTouchX    = 0;
let _fsImages    = [];
let _fsTrack     = null;
let _fsCounter   = null;
let _installed   = false;

// ═══════════════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════════════

function _getSlides() {
  var track = modalZone('.k-modal-carousel-track');
  if (!track) return [];
  return Array.from(track.querySelectorAll('.k-modal-slide'));
}

// ═══════════════════════════════════════════════════════════════
//  COMPTEUR 1/N
// ═══════════════════════════════════════════════════════════════

function _refreshCounter(idx) {
  var counterEl = modalZone('.k-modal-counter');
  if (!counterEl) return;
  var total = _fsImages.length;
  if (total > COUNTER_THRESHOLD) {
    counterEl.textContent = (idx + 1) + '\u202f/\u202f' + total;
    counterEl.classList.add('is-visible');
    // Masquer les dots — illisibles quand il y en a > 5
    var dots = modalZone('.k-modal-dots');
    if (dots) dots.style.display = 'none';
  } else {
    counterEl.classList.remove('is-visible');
    // Réafficher les dots si on revient sur un produit avec peu d'images
    var dots = modalZone('.k-modal-dots');
    if (dots) dots.style.display = '';
  }
}

// ═══════════════════════════════════════════════════════════════
//  BOUTON "VOIR EN GRAND" — injecté dans .k-modal-img-wrap
// ═══════════════════════════════════════════════════════════════

function _injectViewFullBtn() {
  var imgWrap = modalZone('.k-modal-img-wrap');
  if (!imgWrap) return;

  // Éviter les doublons à chaque ouverture
  var existing = imgWrap.querySelector('.k-modal-view-full');
  if (existing) existing.remove();

  var btn = document.createElement('button');
  btn.className = 'k-modal-view-full';
  btn.setAttribute('aria-label', 'Voir en grand');
  btn.type = 'button';
  btn.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
      '<path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3m8 0h3a2 2 0 0 0 2-2v-3"/>' +
    '</svg>' +
    'Voir en grand';

  imgWrap.appendChild(btn);

  btn.addEventListener('click', function(e) {
    e.stopPropagation();
    _openFs(state.carouselIndex || 0);
  });
}

// ═══════════════════════════════════════════════════════════════
//  FULLSCREEN LIGHTBOX
// ═══════════════════════════════════════════════════════════════

function _buildFsSlides() {
  if (!_fsTrack) return;
  _fsTrack.innerHTML = '';
  _fsImages.forEach(function(src) {
    var slide = document.createElement('div');
    slide.className = 'k-modal-fullscreen-slide';
    var img = document.createElement('img');
    // Haute résolution pour le fullscreen : ,w_800/ → ,w_1600/
    img.src = src.replace(/(,w_)\d+(\/|,)/, '$11600$2');
    img.alt = '';
    img.loading = 'lazy';
    slide.appendChild(img);
    _fsTrack.appendChild(slide);
  });
}

function _goTo(i) {
  _fsIdx = Math.max(0, Math.min(_fsImages.length - 1, i));
  _fsTrack.style.transform = 'translateX(-' + (_fsIdx * 100) + '%)';
  if (_fsCounter) {
    _fsCounter.textContent = (_fsIdx + 1) + '\u202f/\u202f' + _fsImages.length;
  }
}

function _openFs(startIdx) {
  if (_fsOpen || _fsImages.length === 0) return;
  _fsOpen = true;
  _buildFsSlides();
  _goTo(startIdx);
  var fs = document.querySelector('.k-modal-fullscreen');
  if (fs) fs.classList.add('is-open');
  document.body.style.overflow = 'hidden';
}

function _closeFs() {
  if (!_fsOpen) return;
  _fsOpen = false;
  var fs = document.querySelector('.k-modal-fullscreen');
  if (fs) fs.classList.remove('is-open');
  document.body.style.overflow = '';
}

function _setupFsHandlers() {
  var fs = document.querySelector('.k-modal-fullscreen');
  if (!fs) return;

  _fsTrack   = fs.querySelector('.k-modal-fullscreen-track');
  _fsCounter = fs.querySelector('.k-modal-fullscreen-counter');

  var closeBtn = fs.querySelector('.k-modal-fullscreen-close');
  if (closeBtn) closeBtn.addEventListener('click', _closeFs);

  // Swipe horizontal pour changer d'image
  fs.addEventListener('touchstart', function(e) {
    _fsTouchX = e.touches[0].clientX;
  }, { passive: true });

  fs.addEventListener('touchend', function(e) {
    var dx = e.changedTouches[0].clientX - _fsTouchX;
    if (Math.abs(dx) > 44) {
      _goTo(_fsIdx + (dx < 0 ? 1 : -1));
    }
  }, { passive: true });

  // Tap sur le fond ou le slide (pas sur l'image elle-même) → fermer
  fs.addEventListener('click', function(e) {
    if (
      e.target === fs ||
      e.target.classList.contains('k-modal-fullscreen-slide')
    ) {
      _closeFs();
    }
  });

  // Fermer sur Escape (desktop, au cas où)
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && _fsOpen) _closeFs();
  });
}

// ═══════════════════════════════════════════════════════════════
//  TAP SUR L'IMAGE PRINCIPALE → lightbox (mobile uniquement)
// ═══════════════════════════════════════════════════════════════

function _setupCarouselTap() {
  var carousel = modalZone('.k-modal-carousel');
  if (!carousel) return;
  // cursor:zoom-in piloté par CSS sur mobile ; pas de cursor sur desktop
  // (le zoom loupe est géré par setupZoom dans b-modal-desktop-enhancers.js)
  carousel.addEventListener('click', function() {
    // isDesktop() n'est pas importé ici : on détecte via media query
    if (window.matchMedia('(max-width: 899px)').matches) {
      _openFs(state.carouselIndex || 0);
    }
  });
}

// ═══════════════════════════════════════════════════════════════
//  SYNC AVEC LE CAROUSEL MODAL
//  bus.on('carousel:changed', idx) émis par b-modal.js à chaque slide
// ═══════════════════════════════════════════════════════════════

function _setupCarouselSync() {
  bus.on('carousel:changed', function(idx) {
    _refreshCounter(idx);
  });
}

// ═══════════════════════════════════════════════════════════════
//  ENTRY POINT
// ═══════════════════════════════════════════════════════════════

/**
 * setupImageUX()
 * À appeler depuis bus.on('modal:opened') dans le bootstrap.
 * Idempotent : les handlers globaux (swipe, Escape, carousel:changed)
 * ne sont installés qu'une seule fois ; les éléments DOM (slides FS,
 * bouton "Voir en grand") sont reconstruits à chaque ouverture de produit.
 */
export function setupImageUX() {
  // Reconstruire à chaque ouverture (nouveau produit, nouvelles images)
  requestAnimationFrame(function() {
    var slides = _getSlides();
    _fsImages = slides.map(function(s) {
      return s.src || s.getAttribute('src') || '';
    });

    _refreshCounter(state.carouselIndex || 0);
    _injectViewFullBtn();

    if (!_installed) {
      _installed = true;
      _setupFsHandlers();
      _setupCarouselTap();
      _setupCarouselSync();
    }
  });
}
