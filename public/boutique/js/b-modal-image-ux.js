/**
 * @komerce-arch
 * @role          product-modal-image-ux
 * @domain        shared-cart-modal
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
 *   avec boucle fantôme, sortie par swipe haut et pinch-zoom natif (touch-action: pinch-zoom).
 *   Mobile uniquement — désactivé sur desktop (zoom loupe géré par setupZoom).
 *
 * Bouton "Voir en grand" :
 *   Injecté dynamiquement dans .k-modal-img-wrap par ce module.
 *   Retiré sur desktop via CSS.
 *
 * Point d'entrée : setupImageUX().
 * Appelé impérativement (pas via bus.on) juste après bus.emit('modal:opened')
 * dans b-modal-core.js, et par les renderers PDC (b-modal-desktop-product.js,
 * b-modal-mobile-product.js) après une reconstruction média. En interne, seul
 * carousel:changed est réellement écouté (bus.on, cf. _setupCarouselSync()).
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
let _fsTouchY    = 0;
let _fsMultiTouch = false;
let _fsGestureMoved = false;
let _fsIgnoreClick = false;
let _fsImages    = [];
let _fsPreviousOverflow = '';
let _fsPreviousFocus = null;
let _fsGhostPending = false;
let _fsResetTimer = null;
let _fsTrack     = null;
let _fsCounter   = null;
let _fsRoot      = null;
let _installed   = false;
let _carouselTouchX = 0;
let _carouselTouchY = 0;

// ═══════════════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════════════

function _getSlides() {
  let track = modalZone('.k-modal-carousel-track');
  if (!track) return [];
  return Array.from(track.querySelectorAll('.k-modal-slide'));
}

function _syncFsImagesFromRenderedSlides() {
  _fsImages = _getSlides().map(function(s) {
    return s.currentSrc || s.src || s.getAttribute('src') || '';
  }).filter(Boolean);
  return _fsImages;
}

function _isEnrichedMobileDetail() {
  return Boolean(state.modalProductDetail)
    && window.matchMedia('(max-width: 899px)').matches;
}

// ═══════════════════════════════════════════════════════════════
//  COMPTEUR 1/N
// ═══════════════════════════════════════════════════════════════

/**
 * Place le compteur dans la zone réellement dessinée par object-fit: contain.
 * Un simple right:10px sur le wrapper 4:3 le laisse hors de la photo
 * lorsqu'une image portrait est centrée (PDP mobile Samsung/Chromium).
 * Les dimensions sont recalculées lors du chargement, du swipe et du resize.
 */
function _positionCounterOnVisiblePhoto(idx, counterEl) {
  const wrap = counterEl?.closest('.k-modal-img-wrap');
  const slide = _getSlides()[idx];
  if (!wrap || !slide || !slide.naturalWidth || !slide.naturalHeight) {
    counterEl?.style.removeProperty('--k-counter-right');
    counterEl?.style.removeProperty('--k-counter-bottom');
    return;
  }
  const { width, height } = wrap.getBoundingClientRect();
  if (!width || !height) return;
  const scale = Math.min(width / slide.naturalWidth, height / slide.naturalHeight);
  const visibleWidth = slide.naturalWidth * scale;
  const visibleHeight = slide.naturalHeight * scale;
  const insetRight = Math.max(10, (width - visibleWidth) / 2 + 10);
  const insetBottom = Math.max(10, (height - visibleHeight) / 2 + 10);
  counterEl.style.setProperty('--k-counter-right', `${Math.round(insetRight)}px`);
  counterEl.style.setProperty('--k-counter-bottom', `${Math.round(insetBottom)}px`);
}

function _refreshCounter(idx) {
  let counterEl = modalZone('.k-modal-counter');
  if (!counterEl) return;
  let total = _fsImages.length;
  const showCounter = total > COUNTER_THRESHOLD
    || (_isEnrichedMobileDetail() && total > 1);

  if (showCounter) {
    counterEl.textContent = (idx + 1) + '\u202f/\u202f' + total;
    counterEl.classList.add('is-visible');
    _positionCounterOnVisiblePhoto(idx, counterEl);
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

  // Mobile : le hero est désormais suffisamment grand.
  // Le tap direct sur l'image conserve la lightbox/pinch-zoom.
  const isMobile =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(max-width: 899px)').matches;

  if (isMobile) return;

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
    openCurrentImageFullscreen(state.carouselIndex || 0);
  });
}

// ═══════════════════════════════════════════════════════════════
//  FULLSCREEN LIGHTBOX
// ═══════════════════════════════════════════════════════════════


/**
 * Ghost loop, uniquement dans la lightbox : [dernier fantôme, 1..N, premier
 * fantôme]. Aucun clone n'est ajouté au carousel PDC ni au contrat média.
 */
function _buildFsSlides() {
  if (!_fsTrack) return;
  _fsTrack.innerHTML = '';
  const sources = _fsImages.length > 1
    ? [_fsImages[_fsImages.length - 1], ..._fsImages, _fsImages[0]]
    : _fsImages;
  sources.forEach((src, index) => {
    const slide = document.createElement('div');
    slide.className = 'k-modal-fullscreen-slide';
    if (_fsImages.length > 1 && (index === 0 || index === sources.length - 1)) {
      slide.dataset.ghost = '1';
      slide.setAttribute('aria-hidden', 'true');
    }
    const img = document.createElement('img');
    img.src = src.replace(/(,w_)\d+(\/|,)/, '$11600$2');
    img.alt = '';
    img.loading = 'lazy';
    img.draggable = false;
    slide.appendChild(img);
    _fsTrack.appendChild(slide);
  });
}

function _finishFsGhostStep() {
  if (!_fsGhostPending || !_fsTrack) return;
  _fsGhostPending = false;
  clearTimeout(_fsResetTimer);
  _fsResetTimer = null;
  _fsTrack.style.transition = 'none';
  _fsTrack.style.transform = 'translateX(-' + ((_fsIdx + (_fsImages.length > 1 ? 1 : 0)) * 100) + '%)';
  // Force le snap invisible avant réactivation de l'animation suivante.
  void _fsTrack.offsetWidth;
  _fsTrack.style.transition = '';
}

function _goTo(index, animate = true) {
  const count = _fsImages.length;
  if (!count || !_fsTrack || _fsGhostPending) return;
  const hasGhosts = count > 1;
  _fsIdx = ((index % count) + count) % count;
  // index=-1 ou count : l'animation parcourt le ghost avant snap invisible.
  const ghostStep = hasGhosts && (index < 0 || index >= count);
  const physicalIndex = ghostStep
    ? (index < 0 ? 0 : count + 1)
    : _fsIdx + (hasGhosts ? 1 : 0);
  _fsTrack.style.transition = animate ? '' : 'none';
  _fsTrack.style.transform = 'translateX(' + (-physicalIndex * 100) + '%)';
  if (_fsCounter) _fsCounter.textContent = (_fsIdx + 1) + '\u202f/\u202f' + count;
  if (ghostStep) {
    _fsGhostPending = true;
    _fsResetTimer = setTimeout(_finishFsGhostStep, 380); // fallback transitionend
  }
}

export function isImageFullscreenOpen() { return _fsOpen; }

function _ensureFs() {
  let fs = document.querySelector('.k-modal-fullscreen');
  if (!fs) {
    fs = document.createElement('div');
    fs.className = 'k-modal-fullscreen';
    fs.innerHTML =
      '<button type="button" class="k-modal-fullscreen-close" aria-label="Fermer">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true">' +
          '<path d="M18 6L6 18M6 6l12 12"/>' +
        '</svg>' +
      '</button>' +
      '<div class="k-modal-fullscreen-counter"></div>' +
      '<div class="k-modal-fullscreen-track"></div>';
    document.body.appendChild(fs);
  }

  // Le markup peut déjà exister (fixtures, ancien shell ou réouverture) :
  // l'enrichissement a11y ne dépend pas de qui a créé l'overlay.
  fs.setAttribute('role', 'dialog');
  fs.setAttribute('aria-modal', 'true');
  fs.setAttribute('aria-label', 'Image produit agrandie');

  if (_fsRoot !== fs) {
    _setupFsHandlers(fs);
    _fsRoot = fs;
  }
  return fs;
}

function _openFs(startIdx) {
  if (_fsOpen || _fsImages.length === 0) return;
  let fs = _ensureFs();
  if (!fs) return;
  _fsOpen = true;
  _fsPreviousOverflow = document.body.style.overflow;
  _fsPreviousFocus = document.activeElement;
  _fsGhostPending = false;
  _buildFsSlides();
  _goTo(startIdx, false);
  fs.classList.add('is-open');
  fs.querySelector('.k-modal-fullscreen-close')?.focus();
  document.body.style.overflow = 'hidden';
}

/**
 * Ouvre le média actuellement rendu par le carousel canonique.
 * La liste fullscreen est relue depuis le DOM à chaque ouverture : elle suit
 * donc selected_media/detail.media et ne peut pas retomber sur une ancienne
 * copie de state.modalProduct.images.
 */
export function openCurrentImageFullscreen(startIdx = state.carouselIndex || 0) {
  _syncFsImagesFromRenderedSlides();
  _openFs(startIdx);
}


function _closeFs({ syncGallery = true } = {}) {
  if (!_fsOpen) return;
  _fsOpen = false;
  clearTimeout(_fsResetTimer);
  _fsResetTimer = null;
  _fsGhostPending = false;
  const fs = document.querySelector('.k-modal-fullscreen');
  if (fs) fs.classList.remove('is-open');
  document.body.style.overflow = _fsPreviousOverflow;
  _fsPreviousOverflow = '';
  if (syncGallery) {
    // Le propriétaire du carrousel normal reprend l'image N affichée dans le
    // zoom (sans importer b-modal-product.js et créer un cycle de dépendances).
    bus.emit('carousel:fullscreen-return', _fsIdx);
    if (_fsPreviousFocus?.isConnected && typeof _fsPreviousFocus.focus === 'function') {
      _fsPreviousFocus.focus({ preventScroll: true });
    }
  }
  _fsPreviousFocus = null;
}

function _setupFsHandlers(fs) {
  if (!fs) return;
  _fsTrack = fs.querySelector('.k-modal-fullscreen-track');
  _fsCounter = fs.querySelector('.k-modal-fullscreen-counter');
  fs.querySelector('.k-modal-fullscreen-close')?.addEventListener('click', () => _closeFs());

  _fsTrack?.addEventListener('transitionend', (event) => {
    if (event.target === _fsTrack && (!event.propertyName || event.propertyName === 'transform')) {
      _finishFsGhostStep();
    }
  });

  fs.addEventListener('touchstart', (event) => {
    if (!_fsOpen) return;
    if (event.touches?.length !== 1) {
      _fsMultiTouch = true;
      return;
    }
    _fsMultiTouch = false;
    _fsGestureMoved = false;
    _fsTouchX = event.touches[0].clientX;
    _fsTouchY = event.touches[0].clientY ?? 0;
  }, { passive: true });

  fs.addEventListener('touchmove', (event) => {
    if (event.touches?.length !== 1) {
      _fsMultiTouch = true; // pinch : jamais interprété comme un swipe
      return;
    }
    if (Math.abs(event.touches[0].clientX - _fsTouchX) > 10
      || Math.abs((event.touches[0].clientY ?? 0) - _fsTouchY) > 10) {
      _fsGestureMoved = true;
    }
  }, { passive: true });

  fs.addEventListener('touchcancel', () => {
    _fsMultiTouch = true;
    _fsGestureMoved = false;
  }, { passive: true });

  fs.addEventListener('touchend', (event) => {
    if (!_fsOpen || _fsMultiTouch || !event.changedTouches?.length) return;
    const dx = event.changedTouches[0].clientX - _fsTouchX;
    const dy = (event.changedTouches[0].clientY ?? 0) - _fsTouchY;
    const zoomed = (window.visualViewport?.scale || 1) > 1.05;
    if (Math.abs(dx) > 12 || Math.abs(dy) > 12 || _fsGestureMoved) {
      _fsIgnoreClick = true;
      setTimeout(() => { _fsIgnoreClick = false; }, 260);
    }
    if (zoomed) return; // ne pas voler le déplacement d'une photo agrandie
    if (dy <= -90 && Math.abs(dy) > Math.abs(dx) * 1.25) {
      _closeFs(); // swipe haut = quitter le zoom, PAS fermer la PDP
    } else if (Math.abs(dx) > 44 && Math.abs(dx) > Math.abs(dy) * 1.2) {
      _goTo(_fsIdx + (dx < 0 ? 1 : -1));
    }
  }, { passive: true });

  fs.addEventListener('click', (event) => {
    if (_fsIgnoreClick) return;
    if (event.target === fs || event.target.classList.contains('k-modal-fullscreen-slide')) {
      _closeFs();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && _fsOpen) {
      event.stopImmediatePropagation();
      _closeFs();
    }
  });
}

// ═══════════════════════════════════════════════════════════════
//  TAP SUR L'IMAGE PRINCIPALE → lightbox (mobile uniquement)
// ═══════════════════════════════════════════════════════════════

function _setupCarouselTap() {
  let carousel = modalZone('.k-modal-carousel');
  if (!carousel) return;

  // Le core historique écoute touchend sur .k-modal-img-wrap et possède encore
  // un ancien fullscreen basé sur state.modalProduct.images. Intercepter
  // uniquement le TAP court ici empêche ce chemin legacy de gagner la course,
  // tout en laissant les swipes horizontaux/verticaux remonter au core.
  carousel.addEventListener('touchstart', function(e) {
    if (!e.touches || e.touches.length !== 1) return;
    _carouselTouchX = e.touches[0].clientX;
    _carouselTouchY = e.touches[0].clientY;
  }, { passive: true });

  carousel.addEventListener('touchend', function(e) {
    const isMobile = window.matchMedia('(max-width: 899px)').matches;
    if (!isMobile || !e.changedTouches || e.changedTouches.length !== 1) return;
    const dx = e.changedTouches[0].clientX - _carouselTouchX;
    const dy = e.changedTouches[0].clientY - _carouselTouchY;
    if (Math.abs(dx) > 8 || Math.abs(dy) > 8) return;

    e.preventDefault();
    e.stopPropagation();
    openCurrentImageFullscreen(state.carouselIndex || 0);
  }, { passive: false });

  carousel.addEventListener('click', function() {
    const isMobile = window.matchMedia('(max-width: 899px)').matches;

    // Mobile conserve la lightbox tactile.
    // Desktop : le hero est désormais la vue produit finale.
    if (isMobile) {
      openCurrentImageFullscreen(state.carouselIndex || 0);
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
  bus.on('modal:closed', () => _closeFs({ syncGallery: false }));
  // Les images peuvent terminer leur chargement après l'ouverture du produit.
  // Capture=true : load ne remonte pas en bubbling depuis un <img>.
  document.addEventListener('load', function(event) {
    if (event.target?.matches?.('#k-modal .k-modal-slide')) {
      _refreshCounter(state.carouselIndex || 0);
    }
  }, true);
  window.addEventListener('resize', function() {
    _refreshCounter(state.carouselIndex || 0);
  }, { passive: true });
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
    _syncFsImagesFromRenderedSlides();

    _refreshCounter(state.carouselIndex || 0);
    _injectViewFullBtn();

    if (!_installed) {
      _installed = true;
      _setupCarouselTap();
      _setupCarouselSync();
    }
  });
}
