/**
 * @module b-modal-product
 * @brief Rendu de la fiche produit dans la modal — extrait de b-modal.js (ARCH-2, PR1).
 *
 * Périmètre (responsabilité « Rendu fiche produit » du découpage ARCH-2) :
 *   - Carousel d'images : buildCarouselSlides, goToSlide (dots, miniatures, compteur N/N)
 *   - Variantes : _renderVariants (tailles/pointures + déclenchement guide des tailles)
 *   - Encarts mobile : _syncScrollPadding, _injectMobileDelivery, _injectMobileTrust
 *   - Topbar enrichie / retour-haut : setupModalFAB, setupEnrichedTopbar, hideModalFAB,
 *     scrollModalToTop (ces deux derniers privés, usage intra-module uniquement)
 *   - Guide des tailles : openSizeGuide, closeSizeGuide
 *
 * Découplage : ce module ne dépend QUE de b-bus / b-store / b-utils.
 *   Il n'importe rien de b-modal.js → aucun cycle (garde-fou check:imports I-2).
 *   Les corps de fonction sont repris à l'identique de b-modal.js (aucune
 *   modification de logique dans cette PR — extraction pure).
 *
 * Consommateurs : b-modal.js (ré-exporte buildCarouselSlides, goToSlide,
 *   openSizeGuide, closeSizeGuide pour préserver sa surface publique, et
 *   importe _renderVariants, _syncScrollPadding, _injectMobileDelivery,
 *   _injectMobileTrust, setupModalFAB et hideModalFAB pour openModal/closeModal).
 *
 * Dépendances : b-bus.js, b-store.js, b-utils.js
 */

import { bus }                   from './b-bus.js';
import { state, dom }            from './b-store.js';
import { optimizeImgUrl, fmtPrice } from './b-utils.js';

'use strict';

  /* ════ CAROUSEL IMAGES ════ */

  /**
   * Construit le carousel d'images dans le modal produit.
   * Swipe ↔ mandatory snap + dots indicateurs.
   * @param {Array<string>} images - URLs des images
   * @param {HTMLElement} container - Conteneur carousel
   */
  function buildCarouselSlides(product) {
    var track = dom.modalCarouselTrack;
    var dots = dom.modalDots;
    var images = product.images || [product.image_url];
    images = images.filter(Boolean);
    if (!images.length) images = [product.image_url || ''];

    // ── Slides principales ─────────────────────────────────────
    track.innerHTML = '';
    // Reset skeleton state — ne redémarre le shimmer que si la première image change
    var imgWrapForSkeleton = dom.modal.querySelector('.k-modal-img-wrap');
    var _existingFirstSrc = track.querySelector('.k-modal-slide') ? track.querySelector('.k-modal-slide').src : '';
    var _newFirstSrc = optimizeImgUrl(images[0], 800);
    if (imgWrapForSkeleton && _existingFirstSrc !== _newFirstSrc) {
      imgWrapForSkeleton.classList.remove('is-image-loaded');
    }
    images.forEach(function(url, i) {
      var img = document.createElement('img');
      img.className = 'k-modal-slide';
      img.src = optimizeImgUrl(url, 800);
      img.alt = product.name || '';
      img.draggable = false;
      img.loading = i < 3 ? 'eager' : 'lazy';
      // Première image : on coupe le shimmer dès qu'elle est chargée
      if (i === 0 && imgWrapForSkeleton) {
        var killShimmer = function() { imgWrapForSkeleton.classList.add('is-image-loaded'); };
        img.addEventListener('load', killShimmer, { once: true });
        img.addEventListener('error', killShimmer, { once: true });
        // Si l'image est déjà en cache (load déjà tiré), on rattrape
        if (img.complete && img.naturalWidth > 0) killShimmer();
        // Fallback Android Chrome : si load/error ne se déclenchent pas en 3s, on retire le shimmer
        setTimeout(killShimmer, 3000);
      }
      track.appendChild(img);
    });
    dom.modalImg = track.querySelector('.k-modal-slide');

    // ── Dots mobile ────────────────────────────────────────────
    // Au-delà de 5 images, les dots deviennent illisibles (largeur insuffisante)
    // → on bascule sur un compteur "X/Y" (Temu-style) à droite de l'image.
    var DOTS_MAX = 5;
    var useCounter = images.length > DOTS_MAX;
    dots.innerHTML = '';
    if (images.length > 1 && !useCounter) {
      images.forEach(function(_, i) {
        var dot = document.createElement('span');
        dot.className = 'k-modal-dot' + (i === 0 ? ' is-active' : '');
        dot.addEventListener('click', function() { goToSlide(i); });
        dots.appendChild(dot);
      });
    }

    // ── Compteur "3/12" mobile (s'affiche si > DOTS_MAX images) ─
    // Toujours créé/mis-à-jour pour pouvoir refléter l'état du carousel.
    // Visibilité contrôlée par la classe .is-visible (CSS).
    var imgWrapForCounter = dom.modal.querySelector('.k-modal-img-wrap');
    var counter = imgWrapForCounter ? imgWrapForCounter.querySelector('.k-modal-counter') : null;
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
    var imgWrap = dom.modal.querySelector('.k-modal-img-wrap');
    // Supprimer ancienne colonne miniatures
    var oldThumbs = dom.modal.querySelector('.k-modal-thumbs');
    if (oldThumbs) oldThumbs.remove();

    if (images.length > 1) {
      var thumbs = document.createElement('div');
      thumbs.className = 'k-modal-thumbs';
      images.forEach(function(url, i) {
        var thumb = document.createElement('button');
        thumb.className = 'k-modal-thumb' + (i === 0 ? ' is-active' : '');
        thumb.setAttribute('aria-label', 'Image ' + (i + 1));
        var tImg = document.createElement('img');
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
    var track = dom.modalCarouselTrack;
    track.style.transition = 'transform .3s cubic-bezier(.22,1,.36,1)';
    track.style.transform = 'translateX(-' + (index * 100) + '%)';
    // Sync dots mobile
    var allDots = dom.modalDots.querySelectorAll('.k-modal-dot');
    allDots.forEach(function(d, i) {
      d.classList.toggle('is-active', i === index);
    });
    // Sync miniatures desktop
    var allThumbs = dom.modal.querySelectorAll('.k-modal-thumb');
    allThumbs.forEach(function(t, i) {
      t.classList.toggle('is-active', i === index);
    });
    // Sync compteur mobile "3/12"
    var counter = dom.modal.querySelector('.k-modal-counter');
    if (counter) counter.textContent = (index + 1) + '/' + state.carouselCount;
    // PR-3 — notifier b-modal-image-ux du changement de slide
    bus.emit('carousel:changed', index);
  }

  /* ════ VARIANTES ════ */

  /**
   * _renderVariants — Rendu des variantes du produit.
   *
   * Couleur → rangée de SKUs miniatures : image réelle du produit + nom de couleur.
   *   - Si opt.image_url est fourni par l'API : on l'affiche.
   *   - Pas de fallback hex, pas de COLOR_MAP — si pas d'image, on affiche juste le nom en pill texte.
   *   - Clic couleur : met à jour le carousel principal + le prix si différent.
   *
   * Autres types (Taille, Pointure…) → grille de pills texte compactes.
   *
   * @param {Object} variants  { "Couleur": [{value, stock, price_kmf, image_url}], "Taille": [...] }
   * @param {Object} product   Produit complet (fallback price_kmf + images)
   */
  function _renderVariants(variants, product) {
    var container = dom.modalVariants || document.getElementById('k-modal-variants');
    if (!container) return;
    container.innerHTML = '';

    Object.keys(variants).forEach(function(type) {
      var options = variants[type];
      if (!options || !options.length) return;

      // Les couleurs sont portées par les SKUs/images produit — on ne les ré-affiche pas ici.
      if (/couleur|color|coloris|teinte/i.test(type)) return;

      var isTaille = /taille|pointure/i.test(type);

      var group = document.createElement('div');
      group.className = 'k-vg';

      // Label "Taille · M  [📏 Guide des tailles]"
      var labelRow = document.createElement('div');
      labelRow.className = 'k-vg-label';
      var guideHTML = isTaille
        ? '<button type="button" class="k-vg-size-guide" data-size-type="' +
            (/pointure/i.test(type) ? 'shoes' : 'clothes') +
            '">📏 Guide des tailles</button>'
        : '';
      labelRow.innerHTML =
        '<span class="k-vg-label-type">' + type + '</span>' +
        '<span class="k-vg-label-sep">·</span>' +
        '<span class="k-vg-label-val"></span>' +
        guideHTML;
      var labelVal = labelRow.querySelector('.k-vg-label-val');

      var guideBtn = labelRow.querySelector('.k-vg-size-guide');
      if (guideBtn) {
        guideBtn.addEventListener('click', function(e) {
          e.stopPropagation();
          openSizeGuide(guideBtn.dataset.sizeType);
        });
      }

      group.appendChild(labelRow);

      var wrap = document.createElement('div');
      wrap.className = 'k-vg-sizes';

      options.forEach(function(opt) {
        var isOut = (opt.stock === 0);
        var btn   = document.createElement('button');
        btn.type  = 'button';
        btn.className = 'k-vp' + (isOut ? ' k-vp--out' : '');
        btn.textContent = opt.value;
        btn.disabled    = isOut;

        btn.addEventListener('click', function() {
          if (isOut) return;
          wrap.querySelectorAll('.k-vp').forEach(function(b) { b.classList.remove('k-vp--active'); });
          btn.classList.add('k-vp--active');
          labelVal.textContent = opt.value;
          if (opt.price_kmf) dom.modalPrice.textContent = fmtPrice(opt.price_kmf);
        });

        wrap.appendChild(btn);
      });

      group.appendChild(wrap);
      container.appendChild(group);
    });

    // Ajuster le padding-bottom du scroll pour la barre d'actions fixe
    // (les variants changent la hauteur du contenu, re-sync pour être sûr)
    _syncScrollPadding();
  }

  /* ════ ENCARTS MOBILE (livraison / trust / padding) ════ */

  /* ── SYNC PADDING SCROLL ────────────────────────────────────────
     Mesure la hauteur réelle de .k-modal-actions (position:fixed) et
     applique un padding-bottom compensatoire sur .k-modal-scroll.
     Utilise offsetHeight plutôt que env(safe-area-inset-bottom) en CSS
     car offsetHeight inclut déjà la safe-area rendue par l'OS, même
     sur Samsung Internet / Chrome Android qui ignorent env() dans calc().
     Double-rAF : laisse un cycle de paint pour que les injections
     (_injectMobileTrust, _injectMobileDelivery) soient reflowées. */
  function _syncScrollPadding() {
    if (window.innerWidth >= 900) return;
    var actBar = dom.modal && dom.modal.querySelector('.k-modal-actions');
    // FIX v5: si .k-modal-actions est enfant direct de #k-modal (architecture statique),
    // le layout flex gère l'ancrage. On expose quand même la hauteur mesurée en CSS var
    // pour que le padding-bottom du scroll soit toujours exact (VIS-3D).
    requestAnimationFrame(function() {
      requestAnimationFrame(function() {
        if (!actBar) return;
        var h = actBar.offsetHeight || 0;
        // Source unique : var CSS mesurée → consommée par modal.css
        document.documentElement.style.setProperty('--k-modal-cta-h', h + 'px');
        // Fallback legacy si actions pas encore en flex statique (position:fixed)
        if (actBar.parentNode !== dom.modal) {
          var scrollEl = dom.modal && dom.modal.querySelector('.k-modal-scroll');
          if (scrollEl) scrollEl.style.paddingBottom = (h + 20) + 'px';
        }
      });
    });
  }

  /* ── F3 — LIVRAISON MOBILE ──────────────────────────────────────
     Injecte un encart livraison minimal dans .k-modal-info sur mobile.
     Masqué desktop par CSS (display:none @min-width:900px).
     Évite le double-inject via data-mobile-delivery.              */
  function _injectMobileDelivery(product) {
    if (!dom.modal) return;
    // Retirer l'ancien si présent (changement de produit)
    var old = dom.modal.querySelector('[data-mobile-delivery]');
    if (old) old.remove();

    var info = dom.modal.querySelector('.k-modal-info');
    if (!info) return;

    var delay = (product && product.delivery_delay) || '3 à 5 semaines';
    var el = document.createElement('div');
    el.className = 'k-modal-delivery-mobile';
    el.setAttribute('data-mobile-delivery', '1');
    el.innerHTML =
      '<span class="k-modal-delivery-mobile-icon">📦</span>' +
      '<span>' +
        '<span class="k-modal-delivery-mobile-label">Livraison relais</span>' +
        '<span class="k-modal-delivery-mobile-delay">· ' + delay + '</span>' +
      '</span>';

    // Insérer après .k-modal-meta (juste après les badges social proof)
    var meta = info.querySelector('.k-modal-meta');
    if (meta && meta.nextSibling) {
      info.insertBefore(el, meta.nextSibling);
    } else {
      info.appendChild(el);
    }
  }

  /* ── F4 — TRUST BAR MOBILE ──────────────────────────────────────
     Injecte 3 pills de réassurance en FIN de .k-modal-info (dans le scroll).
     FIX VIS-3A : l'ancienne version faisait insertBefore(.k-modal-actions) —
     mais après Fix-v5, .k-modal-actions est SORTI du scroll (enfant direct de
     #k-modal via setupModal). Ancrer sur parentNode(actions) plaçait la trust-bar
     hors du scroll en sibling épinglé → gonflement de la zone basse fixe →
     description + CTA débordaient. Solution : ancrer sur .k-modal-info (stable,
     toujours dans le scroll), masqué ≥900px par modal.css.                   */
  function _injectMobileTrust() {
    if (!dom.modal) return;
    var old = dom.modal.querySelector('[data-mobile-trust]');
    if (old) old.remove();

    var info = dom.modal.querySelector('.k-modal-info'); /* ancre STABLE dans le scroll */
    if (!info) return;

    var el = document.createElement('div');
    el.className = 'k-modal-trust-mobile';
    el.setAttribute('data-mobile-trust', '1');
    el.innerHTML =
      '<span class="k-modal-trust-mobile-item">📍 Retrait en relais</span>' +
      '<span class="k-modal-trust-mobile-item">💵 Paiement cash</span>' +
      '<span class="k-modal-trust-mobile-item">🔄 Échange 14 j</span>';

    info.appendChild(el); /* dernier élément scrollable, avant la CTA épinglée */
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
    var overlay = document.getElementById('k-size-guide-overlay');
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
          var section = overlay.querySelector('.k-sg-section[data-section="' + tab.dataset.tab + '"]');
          if (section) section.classList.remove('u-hidden');
        });
      });
    }

    // Activer le bon onglet
    overlay.querySelectorAll('.k-sg-tab').forEach(function(t) { t.classList.remove('is-active'); });
    overlay.querySelectorAll('.k-sg-section').forEach(function(s) { s.classList.add('u-hidden'); });
    var activeTab = overlay.querySelector('.k-sg-tab[data-tab="' + (type || 'clothes') + '"]');
    var activeSection = overlay.querySelector('.k-sg-section[data-section="' + (type || 'clothes') + '"]');
    if (activeTab) activeTab.classList.add('is-active');
    if (activeSection) activeSection.classList.remove('u-hidden');

    // Ouvrir
    overlay.classList.add('is-open');
    document.body.classList.add('k-sg-open');
  }

  function closeSizeGuide() {
    var overlay = document.getElementById('k-size-guide-overlay');
    if (overlay) {
      overlay.classList.remove('is-open');
      document.body.classList.remove('k-sg-open');
    }
  }

// Surface publique ré-exportée par b-modal.js : buildCarouselSlides, goToSlide,
// openSizeGuide, closeSizeGuide. Helpers consommés par openModal/closeModal :
// _renderVariants, _syncScrollPadding, _injectMobile*, setupModalFAB, hideModalFAB.
export {
  buildCarouselSlides, goToSlide, openSizeGuide, closeSizeGuide,
  _renderVariants, _syncScrollPadding,
  _injectMobileDelivery, _injectMobileTrust,
  setupModalFAB, hideModalFAB,
};
