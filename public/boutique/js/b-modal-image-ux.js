/**
 * @komerce-arch
 * @role          product-modal-image-ux
 * @domain        boutique
 * @layer         ui-enhancer
 * @criticality   medium
 * @inputs        product_images, modal_media_state, pointer_events
 * @outputs       image_zoom_state, carousel_interactions, media_focus
 * @depends       b-store.js
 * @used-by       b-modal-core.js, b-modal-mobile-product.js
 * @doctrine      image_produit_inspectable, modal_produit_sans_chevauchement
 * @impact-areas  product-modal, media-carousel, product-discovery
 * @version       2026-07
 */
'use strict';

/**
 * @module b-modal-image-ux
 * @brief Expérience image de la modal produit — compteur 1/N et lightbox mobile.
 *
 * Compteur 1/N :
 *   Ancien parcours : affiché quand le produit a > 5 images.
 *   Product Detail mobile PDC-4 : affiché dès qu'il existe > 1 média, pour que
 *   le swipe et la position dans les mises en scène soient immédiatement lisibles.
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
 * À appeler depuis bus.on('modal:opened') ou après une reconstruction média PDC-4.
 *
 * Dépendances : b-bus.js, b-store.js
 */

import { bus }        from './b-bus.js';
import { state }      from './b-store.js';
import { modalZone }  from './b-store.js';

'use strict';

const COUNTER_THRESHOLD = 5;

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
  let track = modalZone('.k-modal-carousel-track');
  if (!track) return [];
  return Array.from(track.querySelectorAll('.k-modal-slide'));
}

function _isEnrichedMobileDetail() {
  return Boolean(state.modalProductDetail)
    && window.matchMedia('(max-width: 899px)').matches;
}

// ═══════════════════════════════════════════════════════════════
//  COMPTEUR 1/N
// ═══════════════════════════════════════════════════════════════

function _refreshCounter(idx) {
  let counterEl = modalZone('.k-modal-counter');
  if (!counterEl) return;
  let total = _fsImages.length;
  const showCounter = total > COUNTER_THRESHOLD
    || (_isEnrichedMobileDetail() && total > 1);

  if (showCounter) {
    counterEl.textContent = (idx + 1) + '\u202f/\u202f' + total;
    counterEl.classList.add('is-visible');
    let dots = modalZone('.k-modal-dots');
    if (dots) dots.style.display = 'none';
  } else {
    counterEl.classList.remove('is-visible');
    let dots = modalZone('.k-modal-dots');
    if (dots) dots.style.display = '';
  }
}

// ═══════════════════════════════════════════════════════════════
//  BOUTON "VOIR EN GRAND" — injecté dans .k-modal-img-wrap
// ═══════════════════════════════════════════════════════════════

function _injectViewFullBtn() {
  let imgWrap = modalZone('.k-modal-img-wrap');
  if (!imgWrap) return;

  let existing = imgWrap.querySelector('.k-modal-view-full');
  if (existing) existing.remove();

  let btn = document.createElement('button');
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
    let slide = document.createElement('div');
    slide.className = 'k-modal-fullscreen-slide';
    let img = document.createElement('img');
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
  let fs = document.querySelector('.k-modal-fullscreen');
  if (fs) fs.classList.add('is-open');
  document.body.style.overflow = 'hidden';
}

function _closeFs() {
  if (!_fsOpen) return;
  _fsOpen = false;
  let fs = document.querySelector('.k-modal-fullscreen');
  if (fs) fs.classList.remove('is-open');
  document.body.style.overflow = '';
}

function _setupFsHandlers() {
  let fs = document.querySelector('.k-modal-fullscreen');
  if (!fs) return;

  _fsTrack   = fs.querySelector('.k-modal-fullscreen-track');
  _fsCounter = fs.querySelector('.k-modal-fullscreen-counter');

  let closeBtn = fs.querySelector('.k-modal-fullscreen-close');
  if (closeBtn) closeBtn.addEventListener('click', _closeFs);

  fs.addEventListener('touchstart', function(e) {
    _fsTouchX = e.touches[0].clientX;
  }, { passive: true });

  fs.addEventListener('touchend', function(e) {
    let dx = e.changedTouches[0].clientX - _fsTouchX;
    if (Math.abs(dx) > 44) {
      _goTo(_fsIdx + (dx < 0 ? 1 : -1));
    }
  }, { passive: true });

  fs.addEventListener('click', function(e) {
    if (
      e.target === fs ||
      e.target.classList.contains('k-modal-fullscreen-slide')
    ) {
      _closeFs();
    }
  });

  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && _fsOpen) _closeFs();
  });
}

// ═══════════════════════════════════════════════════════════════
//  TAP SUR L'IMAGE PRINCIPALE → lightbox (mobile uniquement)
// ═══════════════════════════════════════════════════════════════

function _setupCarouselTap() {
  let carousel = modalZone('.k-modal-carousel');
  if (!carousel) return;
  carousel.addEventListener('click', function() {
    if (window.matchMedia('(max-width: 899px)').matches) {
      _openFs(state.carouselIndex || 0);
    }
  });
}

// ═══════════════════════════════════════════════════════════════
//  SYNC AVEC LE CAROUSEL MODAL
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
 * Idempotent : les handlers globaux ne sont installés qu'une seule fois ; les
 * images fullscreen et le compteur sont relus à chaque appel.
 */
export function setupImageUX() {
  requestAnimationFrame(function() {
    let slides = _getSlides();
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
