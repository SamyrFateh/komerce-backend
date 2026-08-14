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
 * @brief Rendu de la fiche produit dans la modal — extrait de b-modal.js (ARCH-2, PR1).
 *
 * Périmètre (responsabilité « Rendu fiche produit » du découpage ARCH-2) :
 *   - Carousel d'images : buildCarouselSlides, goToSlide (dots, miniatures, compteur N/N)
 *   - Encarts mobile : _syncScrollPadding
 *   - Topbar enrichie / retour-haut : setupModalFAB, setupEnrichedTopbar, hideModalFAB,
 *     scrollModalToTop (ces deux derniers privés, usage intra-module uniquement)
 *   - Guide des tailles : openSizeGuide, closeSizeGuide
 *
 * PDC-6 : _renderVariants et ses helpers exclusifs (_buildSizeGrid,
 *   _openVariantSheet, _closeVariantSheet, _vsOverlay) ont été supprimés —
 *   c'était l'intelligence produit legacy (lecture directe de opt.stock /
 *   product.stock) alimentée par le fetch /api/products/:id retiré de
 *   b-modal-core.js. La disponibilité et les variantes sont désormais
 *   projetées depuis state.modalSelection (Product Detail Contract).
 *
 * Découplage : ce module ne dépend QUE de b-bus / b-store / b-utils.
 *   Il n'importe rien de b-modal.js → aucun cycle (garde-fou check:imports I-2).
 *
 * Consommateurs : b-modal.js (ré-exporte buildCarouselSlides, goToSlide,
 *   openSizeGuide, closeSizeGuide pour préserver sa surface publique, et
 *   importe _syncScrollPadding,
 *   setupModalFAB et hideModalFAB pour openModal/closeModal).
 *
 * Dépendances : b-bus.js, b-store.js, b-utils.js
 */

import { bus }                   from './b-bus.js';
import { state, dom }            from './b-store.js';
import { optimizeImgUrl, fmtPrice, applyProductImageFallback } from './b-utils.js';

'use strict';

  /* ════ CAROUSEL IMAGES ════ */

  function _syncDesktopCarouselControls() {
    if (!dom.modal) return;

    const prev = dom.modal.querySelector('.k-modal-carousel-handle--prev');
    const next = dom.modal.querySelector('.k-modal-carousel-handle--next');

    if (prev) prev.disabled = state.carouselIndex <= 0;
    if (next) next.disabled = state.carouselIndex >= state.carouselCount - 1;

    const activeThumb = dom.modal.querySelector('.k-modal-thumb.is-active');
    if (activeThumb && typeof activeThumb.scrollIntoView === 'function') {
      activeThumb.scrollIntoView({
        block: 'nearest',
        inline: 'nearest',
        behavior: 'smooth',
      });
    }
  }

  function _mountDesktopCarouselControls(imgWrap, count) {
    if (!imgWrap) return;

    imgWrap.querySelectorAll('.k-modal-carousel-handle').forEach((el) => el.remove());
    if (count <= 1) return;

    const makeButton = (direction, label, delta, glyph) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'k-modal-carousel-handle k-modal-carousel-handle--' + direction;
      button.setAttribute('aria-label', label);
      button.textContent = glyph;
      button.addEventListener('click', () => {
        if (button.disabled) return;
        goToSlide(state.carouselIndex + delta);
      });
      return button;
    };

    imgWrap.append(
      makeButton('prev', 'Image précédente', -1, '‹'),
      makeButton('next', 'Image suivante', 1, '›')
    );
  }

  /**
   * MDM-9 §1/§2 — Calcule le bounding box réel du sujet (pixels non-blancs)
   * dans l'image via un canvas same-origin, puis pose --k-modal-subject-scale
   * sur le wrapper pour que le CSS (modal-mobile-canonical.css, mode single
   * uniquement) zoome le sujet sans jamais rogner ses bords utiles.
   *
   * Stratégie : le zoom est plafonné à la fraction limitante du sujet
   * (largeur OU hauteur, la plus contraignante) avec une marge de sécurité
   * de 12 % — le sujet ne touche donc jamais les bords du wrapper — et un
   * plafond global (MAX_SCALE) pour éviter un zoom absurde sur un sujet
   * minuscule. Échec silencieux (image cross-origin, canvas indisponible,
   * jsdom en tests unitaires) : on retire simplement la variable et l'image
   * s'affiche sans zoom (comportement d'avant MDM-9).
   *
   * @param {HTMLElement} wrap - .k-modal-img-wrap
   * @param {HTMLImageElement} img - image chargée (img.complete === true)
   */
  function _applySubjectScale(wrap, img) {
    if (!wrap || !img) return;
    try {
      let nw = img.naturalWidth;
      let nh = img.naturalHeight;
      if (!nw || !nh) return;

      let canvas = document.createElement('canvas');
      let maxDim = 200; // suffisant pour un bounding box, coût de scan négligeable
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
      let MAX_SCALE = 2.5; // plafond raisonnable (sujet minuscule → pas de zoom absurde)
      let scale = Math.min(MAX_SCALE, (1 / limitingFrac) * SAFETY);
      scale = Math.max(1, scale); // jamais de zoom arrière

      wrap.style.setProperty('--k-modal-subject-scale', scale.toFixed(3));
    } catch (_) {
      // Canvas cross-origin ou indisponible (ex. jsdom en test unitaire) —
      // on retombe sur l'affichage d'origine (object-fit:contain, scale 1).
      wrap.style.removeProperty('--k-modal-subject-scale');
    }
  }

  /**
   * Construit le carousel d'images dans le modal produit.
   * Swipe ↔ mandatory snap + dots indicateurs.
   * @param {Array<string>} images - URLs des images
   * @param {HTMLElement} container - Conteneur carousel
   */
  function buildCarouselSlides(product) {
    let track = dom.modalCarouselTrack;
    let dots = dom.modalDots;
    let images = product.images || [product.image_url];
    images = images.filter(Boolean);
    if (!images.length) images = [product.image_url || ''];

    // ── Slides principales ─────────────────────────────────────
    track.innerHTML = '';
    // Reset skeleton state — ne redémarre le shimmer que si la première image change
    let imgWrapForSkeleton = dom.modal.querySelector('.k-modal-img-wrap');
    let _existingFirstSrc = track.querySelector('.k-modal-slide') ? track.querySelector('.k-modal-slide').src : '';
    let _newFirstSrc = optimizeImgUrl(images[0], 800);
    if (imgWrapForSkeleton && _existingFirstSrc !== _newFirstSrc) {
      imgWrapForSkeleton.classList.remove('is-image-loaded');
    }

    // ── MDM-9 : mode galerie (single vs multiple) ───────────────
    // Piloté par CSS (modal-mobile-canonical.css) pour compresser la
    // hauteur du wrapper en mode single sans réduire le sujet visuellement
    // (voir _applySubjectScale ci-dessous — --k-modal-subject-scale).
    let galleryMode = images.length > 1 ? 'multiple' : 'single';
    if (imgWrapForSkeleton) {
      imgWrapForSkeleton.dataset.galleryMode = galleryMode;
      imgWrapForSkeleton.dataset.mediaCount = String(images.length);
      // Toujours repartir d'un état propre : le mode multiple ne zoome jamais,
      // le mode single recalcule sa propre valeur une fois l'image chargée.
      imgWrapForSkeleton.style.removeProperty('--k-modal-subject-scale');
    }
    images.forEach(function(url, i) {
      let img = document.createElement('img');
      img.className = 'k-modal-slide';
      img.src = optimizeImgUrl(url, 800);
      img.alt = product.name || '';
      img.draggable = false;
      img.loading = i < 3 ? 'eager' : 'lazy';
      img.addEventListener('error', () => applyProductImageFallback(img));
      // Première image : on coupe le shimmer dès qu'elle est chargée
      if (i === 0 && imgWrapForSkeleton) {
        let killShimmer = function() { imgWrapForSkeleton.classList.add('is-image-loaded'); };
        img.addEventListener('load', killShimmer, { once: true });
        img.addEventListener('error', killShimmer, { once: true });
        // Si l'image est déjà en cache (load déjà tiré), on rattrape
        if (img.complete && img.naturalWidth > 0) killShimmer();
        // Fallback Android Chrome : si load/error ne se déclenchent pas en 3s, on retire le shimmer
        setTimeout(killShimmer, 3000);

        // MDM-9 §1 : en mode single, une fois l'image réellement décodée,
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

    // ── Dots mobile ────────────────────────────────────────────
    // Au-delà de 5 images, les dots deviennent illisibles (largeur insuffisante)
    // → on bascule sur un compteur "X/Y" (Temu-style) à droite de l'image.
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

    // ── Compteur "3/12" mobile (s'affiche si > DOTS_MAX images) ─
    // Toujours créé/mis-à-jour pour pouvoir refléter l'état du carousel.
    // Visibilité contrôlée par la classe .is-visible (CSS).
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

    // ── Miniatures desktop (colonne gauche) ────────────────────
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
      // Insérer avant le carousel
      if (imgWrap) imgWrap.insertBefore(thumbs, imgWrap.firstChild);
    }

    state.carouselIndex = 0;
    state.carouselCount = images.length;
    _mountDesktopCarouselControls(imgWrap, images.length);
    _syncDesktopCarouselControls();
    track.style.transition = 'none';
    track.style.transform = 'translateX(0)';
  }

  // Navigate to a specific slide
  /**
   * Navigue vers un slide spécifique du carousel modal.
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
    _syncDesktopCarouselControls();
    // Sync compteur mobile "3/12"
    let counter = dom.modal.querySelector('.k-modal-counter');
    if (counter) counter.textContent = (index + 1) + '/' + state.carouselCount;
    // PR-3 — notifier b-modal-image-ux du changement de slide
    bus.emit('carousel:changed', index);
  }

  /* ════ ENCARTS MOBILE (livraison / trust / padding) ════ */

  /* ── SYNC PADDING SCROLL (LOT N-1 — source unique de vérité) ─────
     --k-modal-cta-h est l'unique signal consommé par .k-modal-scroll
     (modal-shell.css). Deux cas, un seul et même calcul :
       - .k-modal-actions est enfant flex direct de #k-modal (architecture
         statique, cas normal) → rien à compenser, la variable vaut 0 ;
       - .k-modal-actions est resté en position:fixed (fallback — voir
         #k-modal > .k-modal-actions dans modal-shell.css ; atteignable si
         la modal a été ouverte pour la première fois en desktop puis la
         fenêtre redimensionnée sous 900px sans re-render du bootstrap) →
         la variable porte la hauteur réellement mesurée.
     ResizeObserver plutôt qu'un double-rAF ponctuel : la hauteur de la
     barre change (injections livraison/paiement, rotation, police tardive)
     après le premier paint, donc la mesure doit rester vivante pendant
     toute la durée de vie de la modal — pas figée à l'ouverture. */
  let _ctaResizeObserver = null;

  function _syncScrollPadding() {
    let actBar = dom.modal && dom.modal.querySelector('.k-modal-actions');
    if (!actBar) return;

    function measure() {
      let isStatic = actBar.parentNode === dom.modal;
      let actionBarHeight = actBar.offsetHeight || 0;
      let h = isStatic ? 0 : actionBarHeight;
      document.documentElement.style.setProperty('--k-modal-cta-h', h + 'px');
      document.documentElement.style.setProperty('--k-modal-action-bar-h', actionBarHeight + 'px');
    }

    measure();

    if (typeof ResizeObserver === 'function') {
      if (_ctaResizeObserver) _ctaResizeObserver.disconnect();
      _ctaResizeObserver = new ResizeObserver(measure);
      _ctaResizeObserver.observe(actBar);
    }
  }

  /* ════ TOPBAR ENRICHIE + RETOUR HAUT ════ */

  /* ── TOPBAR ENRICHIE : produit visible quand on scroll ── */
  /**
 * Configure le FAB du modal + actions sticky au scroll.
 */
  function setupModalFAB() {
    // Nouvelle version : topbar enrichie au lieu d'un FAB
    setupEnrichedTopbar();
  }

  /**
   * Scrolle le contenu du modal vers le haut (après changement produit).
   * Utilise getBoundingClientRect pour position correcte dans le container.
   */
  function scrollModalToTop() {
    const scrollEl = document.querySelector('.k-modal-scroll');
    if (scrollEl) {
      scrollEl.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  /**
   * Configure la topbar sticky du modal (vignette, nom, prix, accès panier).
   * Sur mobile, on garde la vue produit légère et on laisse le panier visible.
   */
  function setupEnrichedTopbar() {
    const modal = document.getElementById('k-modal');
    const topbar = modal ? modal.querySelector('.k-modal-topbar') : null;
    const product = state.modalProduct;
    if (!topbar || !product) return;

    // 1. Créer le bloc produit dans la topbar s'il n'existe pas encore
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
      // Insérer avant .k-modal-topbar-right
      const rightBar = topbar.querySelector('.k-modal-topbar-right');
      if (rightBar) {
        topbar.insertBefore(productEl, rightBar);
      } else {
        topbar.appendChild(productEl);
      }

      // Wire click sur thumbnail → scroll smooth vers le haut
      productEl.querySelector('.k-topbar-thumb').addEventListener('click', () => {
        scrollModalToTop();
      });
    }

    // Créer le FAB "retour en haut" s'il n'existe pas
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

    // 2. Mettre à jour le contenu avec le produit actuel
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
    // Créer un sentinel élément en haut du scroll
    const scrollEl = document.querySelector('.k-modal-scroll');
    if (!scrollEl) return;

    if (state._topbarObserver) state._topbarObserver.disconnect();

    // On observe l'image wrap : dès qu'elle n'est quasi plus visible → scrolled
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
   * Masque le FAB flottant du modal (utilisé pendant le scroll suggestions).
   * Le FAB réapparaît automatiquement après 800ms d'inactivité.
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

  /* ══════════════════════════════════════════════════════════
     GUIDE DES TAILLES — Overlay léger
     ══════════════════════════════════════════════════════════ */

  /**
   * Ouvre l'overlay guide des tailles.
   * @param {'clothes'|'shoes'|'kids'} type - Type de guide à afficher par défaut
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
            '<h2 class="k-sg-title">📏 Guide des tailles</h2>',
            '<button type="button" class="k-sg-close" aria-label="Fermer">',
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>',
            '</button>',
          '</div>',
          '<div class="k-sg-tabs">',
            '<button class="k-sg-tab is-active" data-tab="clothes">👗 Vêtements</button>',
            '<button class="k-sg-tab" data-tab="shoes">👟 Chaussures</button>',
            '<button class="k-sg-tab" data-tab="kids">👶 Enfant & Bébé</button>',
          '</div>',
          '<div class="k-sg-body">',

            // ── Vêtements adulte ────────────────────────────────────
            '<div class="k-sg-section" data-section="clothes">',
              '<p class="k-sg-hint">Prenez vos mesures avec un mètre souple et choisissez la taille correspondant à <strong>votre tour de poitrine</strong> ou <strong>de hanches</strong> (la plus grande valeur).</p>',
              '<div class="k-sg-table-wrap">',
                '<table class="k-sg-table">',
                  '<thead><tr>',
                    '<th>Taille</th><th>Poitrine (cm)</th><th>Taille (cm)</th><th>Hanches (cm)</th>',
                  '</tr></thead>',
                  '<tbody>',
                    '<tr><td>XS</td><td>80 – 84</td><td>60 – 64</td><td>86 – 90</td></tr>',
                    '<tr><td>S</td><td>84 – 88</td><td>64 – 68</td><td>90 – 94</td></tr>',
                    '<tr><td>M</td><td>88 – 92</td><td>68 – 72</td><td>94 – 98</td></tr>',
                    '<tr><td>L</td><td>92 – 96</td><td>72 – 76</td><td>98 – 102</td></tr>',
                    '<tr><td>XL</td><td>96 – 100</td><td>76 – 80</td><td>102 – 106</td></tr>',
                    '<tr><td>XXL</td><td>100 – 106</td><td>80 – 86</td><td>106 – 112</td></tr>',
                    '<tr><td>3XL</td><td>106 – 114</td><td>86 – 94</td><td>112 – 120</td></tr>',
                    '<tr><td>4XL</td><td>114 – 122</td><td>94 – 102</td><td>120 – 128</td></tr>',
                  '</tbody>',
                '</table>',
              '</div>',
            '</div>',

            // ── Chaussures ──────────────────────────────────────────
            '<div class="k-sg-section u-hidden" data-section="shoes">',
              '<p class="k-sg-hint">Mesurez votre pied en position debout, du talon à l\'extrémité du gros orteil. En cas de doute entre deux pointures, choisissez la <strong>taille supérieure</strong>.</p>',
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

            // ── Enfant ──────────────────────────────────────────────
            '<div class="k-sg-section u-hidden" data-section="kids">',
              '<p class="k-sg-hint">Les tailles enfant sont basées sur l\'<strong>âge indicatif</strong> et la taille en cm. Mesurez votre enfant debout pour un résultat précis.</p>',
              '<div class="k-sg-table-wrap">',
                '<table class="k-sg-table">',
                  '<thead><tr>',
                    '<th>Taille label</th><th>Âge (indicatif)</th><th>Taille (cm)</th><th>Poitrine (cm)</th>',
                  '</tr></thead>',
                  '<tbody>',
                    '<tr><td>3 – 6 M</td><td>3 – 6 mois</td><td>62 – 68</td><td>40 – 44</td></tr>',
                    '<tr><td>6 – 12 M</td><td>6 – 12 mois</td><td>68 – 80</td><td>44 – 48</td></tr>',
                    '<tr><td>12 – 18 M</td><td>12 – 18 mois</td><td>80 – 86</td><td>48 – 50</td></tr>',
                    '<tr><td>2 ans</td><td>1.5 – 2.5 ans</td><td>86 – 92</td><td>50 – 52</td></tr>',
                    '<tr><td>3 ans</td><td>2.5 – 3.5 ans</td><td>92 – 98</td><td>52 – 54</td></tr>',
                    '<tr><td>4 ans</td><td>3.5 – 4.5 ans</td><td>98 – 104</td><td>54 – 56</td></tr>',
                    '<tr><td>5 – 6 ans</td><td>5 – 6 ans</td><td>104 – 116</td><td>56 – 60</td></tr>',
                    '<tr><td>7 – 8 ans</td><td>7 – 8 ans</td><td>116 – 128</td><td>60 – 66</td></tr>',
                    '<tr><td>9 – 10 ans</td><td>9 – 10 ans</td><td>128 – 140</td><td>66 – 72</td></tr>',
                    '<tr><td>11 – 12 ans</td><td>11 – 12 ans</td><td>140 – 152</td><td>72 – 78</td></tr>',
                    '<tr><td>13 – 14 ans</td><td>13 – 14 ans</td><td>152 – 164</td><td>78 – 84</td></tr>',
                  '</tbody>',
                '</table>',
              '</div>',
            '</div>',

          '</div>', // .k-sg-body
          '<div class="k-sg-footer">',
            '<span>En cas de doute, notre équipe vous conseille via le chat 💬</span>',
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

// Surface publique ré-exportée par b-modal.js : buildCarouselSlides, goToSlide,
// openSizeGuide, closeSizeGuide. Helpers consommés par openModal/closeModal :
// _syncScrollPadding, setupModalFAB, hideModalFAB.
// PDC-6 : _renderVariants retiré (fetch legacy /api/products/:id supprimé).
export {
  buildCarouselSlides, goToSlide, openSizeGuide, closeSizeGuide,
  _syncScrollPadding,
  setupModalFAB, hideModalFAB,
};
