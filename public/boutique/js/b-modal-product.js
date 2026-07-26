/**
 * @komerce-arch
 * @role          product-modal-content-renderer
 * @domain        shared-cart-modal
 * @layer         ui-renderer
 * @criticality   high
 * @inputs        product, media_state
 * @outputs       modal_product_content, carousel_state, product_detail_sections
 * @depends       b-store.js, b-utils.js, b-bus.js
 * @used-by       b-modal-core.js
 * @doctrine      boutique_preuve_confiance, fiche_produit_lisible, modal_produit_sans_chevauchement
 * @impact-areas  product-modal, product-discovery, participant-verification, media-carousel
 * @version       2026-07
 */
'use strict';

/**
 * @module b-modal-product
 * @brief Rendu de la fiche produit dans la modal â€” extrait de b-modal.js (ARCH-2, PR1).
 *
 * PÃ©rimÃ¨tre (responsabilitÃ© Â« Rendu fiche produit Â» du dÃ©coupage ARCH-2) :
 *   - Carousel d'images : buildCarouselSlides, goToSlide (dots, miniatures, compteur N/N)
 *   - Encarts mobile : _syncScrollPadding
 *   - Topbar enrichie / retour-haut : setupModalFAB, setupEnrichedTopbar, hideModalFAB,
 *     scrollModalToTop (ces deux derniers privÃ©s, usage intra-module uniquement)
 *   - Guide des tailles : openSizeGuide, closeSizeGuide
 *
 * PDC-6 : _renderVariants et ses helpers exclusifs (_buildSizeGrid,
 *   _openVariantSheet, _closeVariantSheet, _vsOverlay) ont Ã©tÃ© supprimÃ©s â€”
 *   c'Ã©tait l'intelligence produit legacy (lecture directe de opt.stock /
 *   product.stock) alimentÃ©e par le fetch /api/products/:id retirÃ© de
 *   b-modal-core.js. La disponibilitÃ© et les variantes sont dÃ©sormais
 *   projetÃ©es depuis state.modalSelection (Product Detail Contract).
 *
 * DÃ©couplage : ce module ne dÃ©pend QUE de b-bus / b-store / b-utils.
 *   Il n'importe rien de b-modal.js â†’ aucun cycle (garde-fou check:imports I-2).
 *
 * Consommateurs : b-modal.js (rÃ©-exporte buildCarouselSlides, goToSlide,
 *   openSizeGuide, closeSizeGuide pour prÃ©server sa surface publique, et
 *   importe _syncScrollPadding,
 *   setupModalFAB et hideModalFAB pour openModal/closeModal).
 *
 * DÃ©pendances : b-bus.js, b-store.js, b-utils.js
 */

import { bus }                   from './b-bus.js';
import { state, dom }            from './b-store.js';
import { optimizeImgUrl, fmtPrice } from './b-utils.js';

'use strict';

  /* â•â•â•â• CAROUSEL IMAGES â•â•â•â• */

  /**
   * MDM-9 Â§1/Â§2 â€” Calcule le bounding box rÃ©el du sujet (pixels non-blancs)
   * dans l'image via un canvas same-origin, puis pose --k-modal-subject-scale
   * sur le wrapper pour que le CSS (modal-mobile-canonical.css, mode single
   * uniquement) zoome le sujet sans jamais rogner ses bords utiles.
   *
   * StratÃ©gie : le zoom est plafonnÃ© Ã  la fraction limitante du sujet
   * (largeur OU hauteur, la plus contraignante) avec une marge de sÃ©curitÃ©
   * de 12 % â€” le sujet ne touche donc jamais les bords du wrapper â€” et un
   * plafond global (MAX_SCALE) pour Ã©viter un zoom absurde sur un sujet
   * minuscule. Ã‰chec silencieux (image cross-origin, canvas indisponible,
   * jsdom en tests unitaires) : on retire simplement la variable et l'image
   * s'affiche sans zoom (comportement d'avant MDM-9).
   *
   * @param {HTMLElement} wrap - .k-modal-img-wrap
   * @param {HTMLImageElement} img - image chargÃ©e (img.complete === true)
   */
  function _applySubjectScale(wrap, img) {
    if (!wrap || !img) return;
    try {
      let nw = img.naturalWidth;
      let nh = img.naturalHeight;
      if (!nw || !nh) return;

      let canvas = document.createElement('canvas');
      let maxDim = 200; // suffisant pour un bounding box, coÃ»t de scan nÃ©gligeable
      let scaleFactor = Math.min(1, maxDim / Math.max(nw, nh));
      let cw = Math.max(1, Math.round(nw * scaleFactor));
      let ch = Math.max(1, Math.round(nh * scaleFactor));
      canvas.width = cw;
      canvas.height = ch;
      let ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) { wrap.style.removeProperty('--k-modal-subject-scale'); return; }

      ctx.drawImage(img, 0, 0, cw, ch);
      let data = ctx.getImageData(0, 0, cw, ch).data;
      let WHITE = 245;
      let minX = cw, minY = ch, maxX = 0, maxY = 0, found = false;
      for (let y = 0; y < ch; y++) {
        for (let x = 0; x < cw; x++) {
          let idx = (y * cw + x) * 4;
          if (data[idx] < WHITE || data[idx + 1] < WHITE || data[idx + 2] < WHITE) {
            found = true;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }

      if (!found || maxX <= minX || maxY <= minY) {
        wrap.style.removeProperty('--k-modal-subject-scale');
        return;
      }

      let subjectFracW = (maxX - minX + 1) / cw;
      let subjectFracH = (maxY - minY + 1) / ch;
      let limitingFrac = Math.max(subjectFracW, subjectFracH);
      if (limitingFrac <= 0) { wrap.style.removeProperty('--k-modal-subject-scale'); return; }

      let SAFETY = 0.88;   // marge pour ne jamais toucher les bords du wrapper
      let MAX_SCALE = 2.5; // plafond raisonnable (sujet minuscule â†’ pas de zoom absurde)
      let scale = Math.min(MAX_SCALE, (1 / limitingFrac) * SAFETY);
      scale = Math.max(1, scale); // jamais de zoom arriÃ¨re

      wrap.style.setProperty('--k-modal-subject-scale', scale.toFixed(3));
    } catch (_) {
      // Canvas cross-origin ou indisponible (ex. jsdom en test unitaire) â€”
      // on retombe sur l'affichage d'origine (object-fit:contain, scale 1).
      wrap.style.removeProperty('--k-modal-subject-scale');
    }
  }

  /**
   * Construit le carousel d'images dans le modal produit.
   * Swipe â†” mandatory snap + dots indicateurs.
   * @param {Array<string>} images - URLs des images
   * @param {HTMLElement} container - Conteneur carousel
   */
  function buildCarouselSlides(product) {
    let track = dom.modalCarouselTrack;
    let dots = dom.modalDots;
    let images = product.images || [product.image_url];
    images = images.filter(Boolean);
    if (!images.length) images = [product.image_url || ''];

    // â”€â”€ Slides principales â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    track.innerHTML = '';
    // Reset skeleton state â€” ne redÃ©marre le shimmer que si la premiÃ¨re image change
    let imgWrapForSkeleton = dom.modal.querySelector('.k-modal-img-wrap');
    let _existingFirstSrc = track.querySelector('.k-modal-slide') ? track.querySelector('.k-modal-slide').src : '';
    let _newFirstSrc = optimizeImgUrl(images[0], 800);
    if (imgWrapForSkeleton && _existingFirstSrc !== _newFirstSrc) {
      imgWrapForSkeleton.classList.remove('is-image-loaded');
    }

    // â”€â”€ MDM-9 : mode galerie (single vs multiple) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // PilotÃ© par CSS (modal-mobile-canonical.css) pour compresser la
    // hauteur du wrapper en mode single sans rÃ©duire le sujet visuellement
    // (voir _applySubjectScale ci-dessous â€” --k-modal-subject-scale).
    let galleryMode = images.length > 1 ? 'multiple' : 'single';
    if (imgWrapForSkeleton) {
      imgWrapForSkeleton.dataset.galleryMode = galleryMode;
      imgWrapForSkeleton.dataset.mediaCount = String(images.length);
      // Toujours repartir d'un Ã©tat propre : le mode multiple ne zoome jamais,
      // le mode single recalcule sa propre valeur une fois l'image chargÃ©e.
      imgWrapForSkeleton.style.removeProperty('--k-modal-subject-scale');
    }
    images.forEach(function(url, i) {
      let img = document.createElement('img');
      img.className = 'k-modal-slide';
      img.src = optimizeImgUrl(url, 800);
      img.alt = product.name || '';
      img.draggable = false;
      img.loading = i < 3 ? 'eager' : 'lazy';
      // PremiÃ¨re image : on coupe le shimmer dÃ¨s qu'elle est chargÃ©e
      if (i === 0 && imgWrapForSkeleton) {
        let killShimmer = function() { imgWrapForSkeleton.classList.add('is-image-loaded'); };
        img.addEventListener('load', killShimmer, { once: true });
        img.addEventListener('error', killShimmer, { once: true });
        // Si l'image est dÃ©jÃ  en cache (load dÃ©jÃ  tirÃ©), on rattrape
        if (img.complete && img.naturalWidth > 0) killShimmer();
        // Fallback Android Chrome : si load/error ne se dÃ©clenchent pas en 3s, on retire le shimmer
        setTimeout(killShimmer, 3000);

        // MDM-9 Â§1 : en mode single, une fois l'image rÃ©ellement dÃ©codÃ©e,
        // on mesure le sujet (bounding box pixels non-blancs) et on pose
        // --k-modal-subject-scale pour que le CSS zoome dessus sans jamais
        // rogner ses bords (cf. _applySubjectScale).
        if (galleryMode === 'single') {
          let applyScale = function() { _applySubjectScale(imgWrapForSkeleton, img); };
          if (img.complete && img.naturalWidth > 0) {
            applyScale();
          } else {
            img.addEventListener('load', applyScale, { once: true });
          }
        }
      }
      track.appendChild(img);
    });
    dom.modalImg = track.querySelector('.k-modal-slide');

    // â”€â”€ Dots mobile â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Au-delÃ  de 5 images, les dots deviennent illisibles (largeur insuffisante)
    // â†’ on bascule sur un compteur "X/Y" (Temu-style) Ã  droite de l'image.
    let DOTS_MAX = 5;
    let useCounter = images.length > DOTS_MAX;
    dots.innerHTML = '';
    if (images.length > 1 && !useCounter) {
      images.forEach(function(_, i) {
        let dot = document.createElement('span');
        dot.className = 'k-modal-dot' + (i === 0 ? ' is-active' : '');
        dot.addEventListener('click', function() { goToSlide(i); });
        dots.appendChild(dot);
      });
    }

    // â”€â”€ Compteur "3/12" mobile (s'affiche si > DOTS_MAX images) â”€
    // Toujours crÃ©Ã©/mis-Ã -jour pour pouvoir reflÃ©ter l'Ã©tat du carousel.
    // VisibilitÃ© contrÃ´lÃ©e par la classe .is-visible (CSS).
    let imgWrapForCounter = dom.modal.querySelector('.k-modal-img-wrap');
    let counter = imgWrapForCounter ? imgWrapForCounter.querySelector('.k-modal-counter') : null;
    if (!counter && imgWrapForCounter) {
      counter = document.createElement('div');
      counter.className = 'k-modal-counter';
      imgWrapForCounter.appendChild(counter);
    }
    if (counter) {
      counter.textContent = '1/' + images.length;
      counter.classList.toggle('is-visible', useCounter);
    }

    // â”€â”€ Miniatures desktop (colonne gauche) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    let imgWrap = dom.modal.querySelector('.k-modal-img-wrap');
    // Supprimer ancienne colonne miniatures
    let oldThumbs = dom.modal.querySelector('.k-modal-thumbs');
    if (oldThumbs) oldThumbs.remove();

    if (images.length > 1) {
      let thumbs = document.createElement('div');
      thumbs.className = 'k-modal-thumbs';
      images.forEach(function(url, i) {
        let thumb = document.createElement('button');
        thumb.className = 'k-modal-thumb' + (i === 0 ? ' is-active' : '');
        thumb.setAttribute('aria-label', 'Image ' + (i + 1));
        let tImg = document.createElement('img');
        tImg.src = optimizeImgUrl(url, 120);
        tImg.alt = '';
        tImg.loading = 'lazy';
        thumb.appendChild(tImg);
        thumb.addEventListener('click', function() {
          goToSlide(i);
          // Sync active thumb
          thumbs.querySelectorAll('.k-modal-thumb').forEach(function(t, j) {
            t.classList.toggle('is-active', j === i);
          });
        });
        thumbs.appendChild(thumb);
      });
      // InsÃ©rer avant le carousel
      if (imgWrap) imgWrap.insertBefore(thumbs, imgWrap.firstChild);
    }

    state.carouselIndex = 0;
    state.carouselCount = images.length;
    track.style.transition = 'none';
    track.style.transform = 'translateX(0)';
  }

  // Navigate to a specific slide
  /**
   * Navigue vers un slide spÃ©cifique du carousel modal.
   * @param {number} index - Index du slide (0-based)
   */
  function goToSlide(index) {
    if (index < 0 || index >= state.carouselCount) return;
    state.carouselIndex = index;
    let track = dom.modalCarouselTrack;
    track.style.transition = 'transform .3s cubic-bezier(.22,1,.36,1)';
    track.style.transform = 'translateX(-' + (index * 100) + '%)';
    // Sync dots mobile
    let allDots = dom.modalDots.querySelectorAll('.k-modal-dot');
    allDots.forEach(function(d, i) {
      d.classList.toggle('is-active', i === index);
    });
    // Sync miniatures desktop
    let allThumbs = dom.modal.querySelectorAll('.k-modal-thumb');
    allThumbs.forEach(function(t, i) {
      t.classList.toggle('is-active', i === index);
    });
    // Sync compteur mobile "3/12"
    let counter = dom.modal.querySelector('.k-modal-counter');
    if (counter) counter.textContent = (index + 1) + '/' + state.carouselCount;
    // PR-3 â€” notifier b-modal-image-ux du changement de slide
    bus.emit('carousel:changed', index);
  }

  /* â•â•â•â• ENCARTS MOBILE (livraison / trust / padding) â•â•â•â• */

  /* â”€â”€ SYNC PADDING SCROLL (LOT N-1 â€” source unique de vÃ©ritÃ©) â”€â”€â”€â”€â”€
     --k-modal-cta-h est l'unique signal consommÃ© par .k-modal-scroll
     (modal-shell.css). Deux cas, un seul et mÃªme calcul :
       - .k-modal-actions est enfant flex direct de #k-modal (architecture
         statique, cas normal) â†’ rien Ã  compenser, la variable vaut 0 ;
       - .k-modal-actions est restÃ© en position:fixed (fallback â€” voir
         #k-modal > .k-modal-actions dans modal-shell.css ; atteignable si
         la modal a Ã©tÃ© ouverte pour la premiÃ¨re fois en desktop puis la
         fenÃªtre redimensionnÃ©e sous 900px sans re-render du bootstrap) â†’
         la variable porte la hauteur rÃ©ellement mesurÃ©e.
     ResizeObserver plutÃ´t qu'un double-rAF ponctuel : la hauteur de la
     barre change (injections livraison/paiement, rotation, police tardive)
     aprÃ¨s le premier paint, donc la mesure doit rester vivante pendant
     toute la durÃ©e de vie de la modal â€” pas figÃ©e Ã  l'ouverture. */
  let _ctaResizeObserver = null;

  function _syncScrollPadding() {
    let actBar = dom.modal && dom.modal.querySelector('.k-modal-actions');
    if (!actBar) return;

    function measure() {
      let isStatic = actBar.parentNode === dom.modal;
      let h = isStatic ? 0 : (actBar.offsetHeight || 0);
      document.documentElement.style.setProperty('--k-modal-cta-h', h + 'px');
    }

    measure();

    if (typeof ResizeObserver === 'function') {
      if (_ctaResizeObserver) _ctaResizeObserver.disconnect();
      _ctaResizeObserver = new ResizeObserver(measure);
      _ctaResizeObserver.observe(actBar);
    }
  }

  /* â•â•â•â• TOPBAR ENRICHIE + RETOUR HAUT â•â•â•â• */

  /* â”€â”€ TOPBAR ENRICHIE : produit visible quand on scroll â”€â”€ */
  /**
 * Configure le FAB du modal + actions sticky au scroll.
 */
  function setupModalFAB() {
    // Nouvelle version : topbar enrichie au lieu d'un FAB
    setupEnrichedTopbar();
  }

  /**
   * Scrolle le contenu du modal vers le haut (aprÃ¨s changement produit).
   * Utilise getBoundingClientRect pour position correcte dans le container.
   */
  function scrollModalToTop() {
    const scrollEl = document.querySelector('.k-modal-scroll');
    if (scrollEl) {
      scrollEl.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  /**
   * Configure la topbar sticky du modal (vignette, nom, prix, accÃ¨s panier).
   * Sur mobile, on garde la vue produit lÃ©gÃ¨re et on laisse le panier visible.
   */
  function setupEnrichedTopbar() {
    const modal = document.getElementById('k-modal');
    const topbar = modal ? modal.querySelector('.k-modal-topbar') : null;
    const product = state.modalProduct;
    if (!topbar || !product) return;

    // 1. CrÃ©er le bloc produit dans la topbar s'il n'existe pas encore
    let productEl = topbar.querySelector('.k-modal-topbar-product');
    if (!productEl) {
      productEl = document.createElement('div');
      productEl.className = 'k-modal-topbar-product';
      productEl.innerHTML = `
        <div class="k-topbar-thumb" role="button" aria-label="Revenir en haut">
          <img class="k-topbar-thumb-img" src="" alt="">
        </div>
        <div class="k-topbar-info">
          <div class="k-topbar-name"></div>
          <div class="k-topbar-price">
            <span class="k-topbar-price-val"></span>
            <span class="k-topbar-price-promo u-hidden"></span>
          </div>
        </div>
      `;
      // InsÃ©rer avant .k-modal-topbar-right
      const rightBar = topbar.querySelector('.k-modal-topbar-right');
      if (rightBar) {
        topbar.insertBefore(productEl, rightBar);
      } else {
        topbar.appendChild(productEl);
      }

      // Wire click sur thumbnail â†’ scroll smooth vers le haut
      productEl.querySelector('.k-topbar-thumb').addEventListener('click', () => {
        scrollModalToTop();
      });
    }

    // CrÃ©er le FAB "retour en haut" s'il n'existe pas
    let backTopFab = document.getElementById('k-modal-back-top');
    if (!backTopFab) {
      backTopFab = document.createElement('button');
      backTopFab.id = 'k-modal-back-top';
      backTopFab.className = 'k-modal-back-top';
      backTopFab.setAttribute('aria-label', 'Retour au produit');
      backTopFab.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="M5 12l7-7 7 7"/></svg>';
      document.body.appendChild(backTopFab);
      backTopFab.addEventListener('click', () => {
        scrollModalToTop();
      });
    }

    // 2. Mettre Ã  jour le contenu avec le produit actuel
    const thumb = productEl.querySelector('.k-topbar-thumb-img');
    const name = productEl.querySelector('.k-topbar-name');
    const priceVal = productEl.querySelector('.k-topbar-price-val');
    const pricePromo = productEl.querySelector('.k-topbar-price-promo');
    if (thumb) thumb.src = optimizeImgUrl(product.image_url, 80);
    if (name) name.textContent = product.name || '';
    if (priceVal) priceVal.textContent = fmtPrice(product.price_kmf);
    if (pricePromo) {
      if (product.promo_pct && product.promo_pct > 0) {
        pricePromo.textContent = '-' + product.promo_pct + '%';
        pricePromo.classList.remove('u-hidden');
      } else {
        pricePromo.classList.add('u-hidden');
      }
    }

    // 3. Observer le scroll : toggle .is-scrolled sur .k-modal
    // CrÃ©er un sentinel Ã©lÃ©ment en haut du scroll
    const scrollEl = document.querySelector('.k-modal-scroll');
    if (!scrollEl) return;

    if (state._topbarObserver) state._topbarObserver.disconnect();

    // On observe l'image wrap : dÃ¨s qu'elle n'est quasi plus visible â†’ scrolled
    const imgWrap = scrollEl.querySelector('.k-modal-img-wrap');
    if (imgWrap && 'IntersectionObserver' in window) {
      state._topbarObserver = new IntersectionObserver(
        (entries) => {
          entries.forEach(entry => {
            const backTopFab = document.getElementById('k-modal-back-top');
            if (entry.intersectionRatio < 0.3) {
              modal.classList.add('is-scrolled');
              if (backTopFab) backTopFab.classList.add('visible');
            } else {
              modal.classList.remove('is-scrolled');
              if (backTopFab) backTopFab.classList.remove('visible');
            }
          });
        },
        { root: scrollEl, threshold: [0, 0.3, 0.7, 1] }
      );
      state._topbarObserver.observe(imgWrap);
    }
  }

  /**
   * Masque le FAB flottant du modal (utilisÃ© pendant le scroll suggestions).
   * Le FAB rÃ©apparaÃ®t automatiquement aprÃ¨s 800ms d'inactivitÃ©.
   */
  function hideModalFAB() {
    // Reset topbar mode
    const modal = document.getElementById('k-modal');
    if (modal) modal.classList.remove('is-scrolled');
    // Cacher le FAB back-to-top
    const backTopFab = document.getElementById('k-modal-back-top');
    if (backTopFab) backTopFab.classList.remove('visible');
    // Cleanup observers
    if (state._fabObserver) {
      state._fabObserver.disconnect();
      state._fabObserver = null;
    }
    if (state._topbarObserver) {
      state._topbarObserver.disconnect();
      state._topbarObserver = null;
    }
    // Hide legacy FAB if present
    const fab = document.getElementById('k-modal-fab');
    if (fab) fab.classList.remove('visible');
  }

  /* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
     GUIDE DES TAILLES â€” Overlay lÃ©ger
     â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */

  /**
   * Ouvre l'overlay guide des tailles.
   * @param {'clothes'|'shoes'|'kids'} type - Type de guide Ã  afficher par dÃ©faut
   */
  function openSizeGuide(type) {
    let overlay = document.getElementById('k-size-guide-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'k-size-guide-overlay';
      overlay.className = 'k-sg-overlay';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.setAttribute('aria-label', 'Guide des tailles');
      overlay.innerHTML = [
        '<div class="k-sg-panel">',
          '<div class="k-sg-header">',
            '<h2 class="k-sg-title">ðŸ“ Guide des tailles</h2>',
            '<button type="button" class="k-sg-close" aria-label="Fermer">',
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>',
            '</button>',
          '</div>',
          '<div class="k-sg-tabs">',
            '<button class="k-sg-tab is-active" data-tab="clothes">ðŸ‘— VÃªtements</button>',
            '<button class="k-sg-tab" data-tab="shoes">ðŸ‘Ÿ Chaussures</button>',
            '<button class="k-sg-tab" data-tab="kids">ðŸ‘¶ Enfant & BÃ©bÃ©</button>',
          '</div>',
          '<div class="k-sg-body">',

            // â”€â”€ VÃªtements adulte â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
            '<div class="k-sg-section" data-section="clothes">',
              '<p class="k-sg-hint">Prenez vos mesures avec un mÃ¨tre souple et choisissez la taille correspondant Ã  <strong>votre tour de poitrine</strong> ou <strong>de hanches</strong> (la plus grande valeur).</p>',
              '<div class="k-sg-table-wrap">',
                '<table class="k-sg-table">',
                  '<thead><tr>',
                    '<th>Taille</th><th>Poitrine (cm)</th><th>Taille (cm)</th><th>Hanches (cm)</th>',
                  '</tr></thead>',
                  '<tbody>',
                    '<tr><td>XS</td><td>80 â€“ 84</td><td>60 â€“ 64</td><td>86 â€“ 90</td></tr>',
                    '<tr><td>S</td><td>84 â€“ 88</td><td>64 â€“ 68</td><td>90 â€“ 94</td></tr>',
                    '<tr><td>M</td><td>88 â€“ 92</td><td>68 â€“ 72</td><td>94 â€“ 98</td></tr>',
                    '<tr><td>L</td><td>92 â€“ 96</td><td>72 â€“ 76</td><td>98 â€“ 102</td></tr>',
                    '<tr><td>XL</td><td>96 â€“ 100</td><td>76 â€“ 80</td><td>102 â€“ 106</td></tr>',
                    '<tr><td>XXL</td><td>100 â€“ 106</td><td>80 â€“ 86</td><td>106 â€“ 112</td></tr>',
                    '<tr><td>3XL</td><td>106 â€“ 114</td><td>86 â€“ 94</td><td>112 â€“ 120</td></tr>',
                    '<tr><td>4XL</td><td>114 â€“ 122</td><td>94 â€“ 102</td><td>120 â€“ 128</td></tr>',
                  '</tbody>',
                '</table>',
              '</div>',
            '</div>',

            // â”€â”€ Chaussures â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
            '<div class="k-sg-section u-hidden" data-section="shoes">',
              '<p class="k-sg-hint">Mesurez votre pied en position debout, du talon Ã  l\'extrÃ©mitÃ© du gros orteil. En cas de doute entre deux pointures, choisissez la <strong>taille supÃ©rieure</strong>.</p>',
              '<div class="k-sg-table-wrap">',
                '<table class="k-sg-table">',
                  '<thead><tr>',
                    '<th>EU</th><th>UK</th><th>US</th><th>Longueur (cm)</th>',
                  '</tr></thead>',
                  '<tbody>',
                    '<tr><td>35</td><td>2.5</td><td>5</td><td>22.0</td></tr>',
                    '<tr><td>36</td><td>3.5</td><td>6</td><td>22.7</td></tr>',
                    '<tr><td>37</td><td>4</td><td>6.5</td><td>23.3</td></tr>',
                    '<tr><td>38</td><td>5</td><td>7.5</td><td>24.0</td></tr>',
                    '<tr><td>39</td><td>6</td><td>8</td><td>24.7</td></tr>',
                    '<tr><td>40</td><td>6.5</td><td>8.5</td><td>25.3</td></tr>',
                    '<tr><td>41</td><td>7</td><td>9</td><td>26.0</td></tr>',
                    '<tr><td>42</td><td>8</td><td>10</td><td>26.7</td></tr>',
                    '<tr><td>43</td><td>9</td><td>10.5</td><td>27.3</td></tr>',
                    '<tr><td>44</td><td>9.5</td><td>11</td><td>28.0</td></tr>',
                    '<tr><td>45</td><td>10.5</td><td>11.5</td><td>28.7</td></tr>',
                    '<tr><td>46</td><td>11</td><td>12</td><td>29.3</td></tr>',
                  '</tbody>',
                '</table>',
              '</div>',
            '</div>',

            // â”€â”€ Enfant â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
            '<div class="k-sg-section u-hidden" data-section="kids">',
              '<p class="k-sg-hint">Les tailles enfant sont basÃ©es sur l\'<strong>Ã¢ge indicatif</strong> et la taille en cm. Mesurez votre enfant debout pour un rÃ©sultat prÃ©cis.</p>',
              '<div class="k-sg-table-wrap">',
                '<table class="k-sg-table">',
                  '<thead><tr>',
                    '<th>Taille label</th><th>Ã‚ge (indicatif)</th><th>Taille (cm)</th><th>Poitrine (cm)</th>',
                  '</tr></thead>',
                  '<tbody>',
                    '<tr><td>3 â€“ 6 M</td><td>3 â€“ 6 mois</td><td>62 â€“ 68</td><td>40 â€“ 44</td></tr>',
                    '<tr><td>6 â€“ 12 M</td><td>6 â€“ 12 mois</td><td>68 â€“ 80</td><td>44 â€“ 48</td></tr>',
                    '<tr><td>12 â€“ 18 M</td><td>12 â€“ 18 mois</td><td>80 â€“ 86</td><td>48 â€“ 50</td></tr>',
                    '<tr><td>2 ans</td><td>1.5 â€“ 2.5 ans</td><td>86 â€“ 92</td><td>50 â€“ 52</td></tr>',
                    '<tr><td>3 ans</td><td>2.5 â€“ 3.5 ans</td><td>92 â€“ 98</td><td>52 â€“ 54</td></tr>',
                    '<tr><td>4 ans</td><td>3.5 â€“ 4.5 ans</td><td>98 â€“ 104</td><td>54 â€“ 56</td></tr>',
                    '<tr><td>5 â€“ 6 ans</td><td>5 â€“ 6 ans</td><td>104 â€“ 116</td><td>56 â€“ 60</td></tr>',
                    '<tr><td>7 â€“ 8 ans</td><td>7 â€“ 8 ans</td><td>116 â€“ 128</td><td>60 â€“ 66</td></tr>',
                    '<tr><td>9 â€“ 10 ans</td><td>9 â€“ 10 ans</td><td>128 â€“ 140</td><td>66 â€“ 72</td></tr>',
                    '<tr><td>11 â€“ 12 ans</td><td>11 â€“ 12 ans</td><td>140 â€“ 152</td><td>72 â€“ 78</td></tr>',
                    '<tr><td>13 â€“ 14 ans</td><td>13 â€“ 14 ans</td><td>152 â€“ 164</td><td>78 â€“ 84</td></tr>',
                  '</tbody>',
                '</table>',
              '</div>',
            '</div>',

          '</div>', // .k-sg-body
          '<div class="k-sg-footer">',
            '<span>En cas de doute, notre Ã©quipe vous conseille via le chat ðŸ’¬</span>',
          '</div>',
        '</div>', // .k-sg-panel
      ].join('');

      document.body.appendChild(overlay);

      // Fermeture
      overlay.querySelector('.k-sg-close').addEventListener('click', closeSizeGuide);
      overlay.addEventListener('click', function(e) {
        if (e.target === overlay) closeSizeGuide();
      });
      document.addEventListener('keydown', function _sgKey(e) {
        if (e.key === 'Escape') { closeSizeGuide(); document.removeEventListener('keydown', _sgKey); }
      });

      // Tabs
      overlay.querySelectorAll('.k-sg-tab').forEach(function(tab) {
        tab.addEventListener('click', function() {
          overlay.querySelectorAll('.k-sg-tab').forEach(function(t) { t.classList.remove('is-active'); });
          overlay.querySelectorAll('.k-sg-section').forEach(function(s) { s.classList.add('u-hidden'); });
          tab.classList.add('is-active');
          let section = overlay.querySelector('.k-sg-section[data-section="' + tab.dataset.tab + '"]');
          if (section) section.classList.remove('u-hidden');
        });
      });
    }

    // Activer le bon onglet
    overlay.querySelectorAll('.k-sg-tab').forEach(function(t) { t.classList.remove('is-active'); });
    overlay.querySelectorAll('.k-sg-section').forEach(function(s) { s.classList.add('u-hidden'); });
    let activeTab = overlay.querySelector('.k-sg-tab[data-tab="' + (type || 'clothes') + '"]');
    let activeSection = overlay.querySelector('.k-sg-section[data-section="' + (type || 'clothes') + '"]');
    if (activeTab) activeTab.classList.add('is-active');
    if (activeSection) activeSection.classList.remove('u-hidden');

    // Ouvrir
    overlay.classList.add('is-open');
    document.body.classList.add('k-sg-open');
  }

  function closeSizeGuide() {
    let overlay = document.getElementById('k-size-guide-overlay');
    if (overlay) {
      overlay.classList.remove('is-open');
      document.body.classList.remove('k-sg-open');
    }
  }

// Surface publique rÃ©-exportÃ©e par b-modal.js : buildCarouselSlides, goToSlide,
// openSizeGuide, closeSizeGuide. Helpers consommÃ©s par openModal/closeModal :
// _syncScrollPadding, setupModalFAB, hideModalFAB.
// PDC-6 : _renderVariants retirÃ© (fetch legacy /api/products/:id supprimÃ©).
export {
  buildCarouselSlides, goToSlide, openSizeGuide, closeSizeGuide,
  _syncScrollPadding,
  setupModalFAB, hideModalFAB,
};
