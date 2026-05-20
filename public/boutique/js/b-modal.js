/**
 * b-modal.js — Module ES · §9 MODAL
 * Extrait de boutique.js Sprint 2F — Option C
 *
 * Fiche produit, carousel, suggestions, subcat chips
 */

import { bus }           from './b-bus.js';
import {
  state, dom, $, $$,
}                         from './b-store.js';
import {
  sanitize, fmt, fmtPrice, optimizeImgUrl,
  renderProductCarousel, bindCarouselDots,
}                         from './b-utils.js';
import {
  showToast, updateCartBadge, saveCart, cartQty,
}                         from './b-cart-core.js';
import {
  addToCart, quickAdd, quickRemove, toggleFav, setQty,
  openCart, closeCart, markAllCartButtons,
}                         from './b-cart.js';
import {
  normalizeCategoryKey, getCategorySectionEmoji,
}                         from './shop-schema.js';
import { isDesktop, getScrollY, scrollToPosition } from './b-scroll-owner.js';
import { setActiveCat }   from './b-catalog.js';
import { setupImageUX }     from './b-modal-image-ux.js';
import { setupSocialProof } from './b-modal-social-proof.js';

'use strict';

// Receive close-modal signal from b-cart (avoids circular dep)
bus.on('modal:close', function() { if (typeof closeModal === 'function') closeModal(); });

// Receive open-modal signal from cart (avoids circular dep — b-modal imports b-cart)
bus.on('modal:open', function({ id }) { if (typeof openModal === 'function') openModal(String(id)); });

  // ║  §9 · MODAL — Fiche produit, carousel, suggestions, subcat       ║
  // ╚══════════════════════════════════════════════════════════════════╝
  //  → Futur module: b-modal.js

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

  /**
   * @brief openModal — Ouvre la fiche produit (modal Shein-style)
   * Mémorise scrollY du catalogue pour restauration à la fermeture
   * Charge carousel images + suggestions + subcats filtrants
   * @param {string|number} id - ID du produit
   * @param {boolean} [pushHistory] - Pousser dans l'historique navigateur (retour natif)
   */

  /* ── FIX: Sync qty stepper display with real cart contents ── */
  function _syncModalQtyUI() {
    if (!state.modalProduct) return;
    const pid = String(state.modalProduct.id);
    const item = state.cart.find(i => String(i.product?.id ?? i.id) === pid);
    state.modalQty = item ? item.qty : 0;
    if (dom.modalQtyVal) dom.modalQtyVal.textContent = state.modalQty;
    // Update "Ajouter" button label
    if (dom.addCartBtn) {
      if (state.modalQty > 0) {
        dom.addCartBtn.classList.add('in-cart');
        dom.addCartBtn.innerHTML = '🧺 Dans le panier (' + state.modalQty + ')';
      } else {
        dom.addCartBtn.classList.remove('in-cart');
        /* FIX Bug 3: utiliser l'image panier_tresse_vert au lieu du SVG générique */
        dom.addCartBtn.innerHTML = '<img src="/images/panier_tresse_vert.png" width="20" height="20" alt="" style="pointer-events:none;flex-shrink:0"> Ajouter au panier';
      }
    }
  }

  /* ── FIX: Back button = fermer modal au lieu de quitter le site ── */
  let _modalHistoryPushed = false;
  window.addEventListener('popstate', (e) => {
    if (dom.modalOverlay && dom.modalOverlay.classList.contains('open')) {
      _modalHistoryPushed = false;
      closeModal();
    }
  });

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
    if (window.innerWidth < 900) {
      requestAnimationFrame(function() {
        var actBar  = document.querySelector('.k-modal-actions');
        var scrollEl = document.querySelector('.k-modal-scroll');
        if (actBar && scrollEl) {
          scrollEl.style.paddingBottom =
            'calc(' + (actBar.offsetHeight + 16) + 'px + env(safe-area-inset-bottom, 0px))';
        }
      });
    }
  }

    function openModal(id, pushHistory) {
    const product = state.products.find(p => String(p.id) === String(id));
    if (!product) return;

    // HOTFIX #213 — Reset la barre de recherche interne à chaque ouverture
    if (state._modalSearchInput) {
      state._modalSearchInput.value = '';
      var _wrap = state._modalSearchInput.closest('.k-modal-inner-search');
      if (_wrap) _wrap.classList.remove('has-value');
      document.getElementById('k-sug-rail') &&
        document.getElementById('k-sug-rail').querySelectorAll('.k-sug-card.search-hidden').forEach(function(c) { c.classList.remove('search-hidden'); });
      // Fermer le dropdown résultats
      var _dd = document.getElementById('k-modal-search-dropdown');
      if (_dd) _dd.classList.remove('open');
    }

    // Mémoriser la position de scroll du catalogue pour y revenir à la fermeture
    if (!dom.modalOverlay.classList.contains('open')) {
      state._savedCatalogScrollY = getScrollY();
      // FIX: Push history state so browser back button closes modal
      if (!_modalHistoryPushed) {
        history.pushState({ kModal: true }, '');
        _modalHistoryPushed = true;
      }
    }

    if (pushHistory !== false && state.modalProduct) {
      state.modalHistory.push(state.modalProduct.id);
    }

    state.modalProduct = product;

    // FIX: Stepper = panier direct. Affiche la quantité déjà dans le panier.
    const _cartItem = state.cart.find(i => String(i.product?.id ?? i.id) === String(product.id));
    state.modalQty = _cartItem ? _cartItem.qty : 0;

    // Reset "Ajouter" button state
    if (dom.addCartBtn) {
      dom.addCartBtn.disabled = false;
      dom.addCartBtn.onclick = null;
      dom.addCartBtn.classList.remove('added', 'in-cart', 'confirmed');
    }
    // Sync stepper display with cart qty
    _syncModalQtyUI();

    buildCarouselSlides(product);

    // Variants — fetch full product if has_variants (lazy, non-blocking)
    var _variantContainer = dom.modalVariants || document.getElementById('k-modal-variants');
    if (_variantContainer) _variantContainer.innerHTML = '';
    if (product.has_variants) {
      var _variantProductId = product.id;
      fetch('/api/products/' + _variantProductId)
        .then(function(r) { return r.json(); })
        .then(function(full) {
          // Guard: modal may have moved to another product by the time fetch returns
          if (state.modalProduct && state.modalProduct.id !== _variantProductId) return;
          if (full.variants && Object.keys(full.variants).length > 0) {
            _renderVariants(full.variants, full);
          }
        })
        .catch(function() { /* silently ignore network errors */ });
    }

    dom.modalName.textContent = product.name;
    dom.modalDesc.textContent = product.description || '';
    dom.modalDesc.classList.remove('is-expanded'); // reset truncation on each open
    dom.modalDesc.onclick = function() { dom.modalDesc.classList.toggle('is-expanded'); };
    dom.modalPrice.textContent = fmtPrice(product.price_kmf);
    dom.modalQtyVal.textContent = state.modalQty;  // FIX: show cart qty, not hardcoded 1

    if (product.promo_pct) {
      const old = Math.round(product.price_kmf / (1 - product.promo_pct / 100));
      dom.modalOldPrice.textContent = fmtPrice(old);
      dom.modalOldPrice.classList.remove('u-hidden');
      dom.modalPromoBadge.textContent = `-${product.promo_pct}%`;
      dom.modalPromoBadge.classList.add('show');
      // F1 — prix coral sur mobile (classe lue par modal.css §1)
      dom.modal && dom.modal.classList.add('k-modal--has-promo');
    } else {
      dom.modalOldPrice.classList.add('u-hidden');
      dom.modalPromoBadge.classList.remove('show');
      dom.modal && dom.modal.classList.remove('k-modal--has-promo');
    }

    // FIX #1 — Bouton favori dans la modal
    const modalFavBtn = document.getElementById('k-modal-fav-btn');
    if (modalFavBtn) {
      const favState = state.favs.includes(product.id);
      modalFavBtn.classList.toggle('liked', favState);
      modalFavBtn.innerHTML = favState ? '❤️' : '🤍';
    }

    dom.modalCat.textContent = `${product.emoji || ''} ${product.category || ''}`;
    // Affichage stock intelligent : 3 états seulement
    // - Stock > 10 : "✓ Disponible"
    // - Stock 1-10 : "🔥 Plus que X en stock !"
    // - Stock 0 : "✗ Rupture"
    const stockVal = Number(product.stock || 0);
    if (stockVal === 0) {
      dom.modalStock.textContent = '✗ Rupture';
      dom.modalStock.className = 'k-modal-stock k-modal-stock--out';
    } else if (stockVal <= 10) {
      dom.modalStock.textContent = '🔥 Plus que ' + stockVal + ' en stock';
      dom.modalStock.className = 'k-modal-stock k-modal-stock--low';
    } else {
      dom.modalStock.textContent = '✓ Disponible';
      dom.modalStock.className = 'k-modal-stock k-modal-stock--ok';
    }
    dom.modalBackLabel.textContent = state.modalHistory.length > 0 ? 'Retour' : 'Catalogue';
    updateCartBadge();

    // Compteur de position dans la liste + boutons ← →
    const list = state.filtered.length ? state.filtered : state.products;
    const currentIdx = list.findIndex(p => p.id === product.id);
    updateModalNavArrows(list, currentIdx);

    // Séparer clairement : même catégorie (jusqu'à 8) puis autres (jusqu'à 12)
    const sameCat = state.products
      .filter(p => p.category === product.category && p.id !== product.id)
      .slice(0, 20);
    const otherCat = state.products
      .filter(p => p.category !== product.category && p.id !== product.id)
      .sort(() => Math.random() - 0.5)
      .slice(0, 16);
        state.modalSubcatFilter = null; // Reset subcategory filter for new product
    renderSuggestions(sameCat, otherCat, product.category);

    if (dom.modalDetails) dom.modalDetails.scrollTop = 0;
    const _scrollEl = document.querySelector('.k-modal-scroll');
    if (_scrollEl) _scrollEl.scrollTop = 0;
    dom.modalOverlay.classList.add('open');

    // PR-D 2.3 : historique des produits vus (persisté localStorage).
    // On retire d'abord toute occurrence de l'id courant (déduplication),
    // puis on push à la fin pour que "le plus récent" reste en queue.
    // Limité à 30 entrées pour éviter l'inflation localStorage.
    try {
      var vh = state.viewedHistory.filter(function(x) { return x !== product.id; });
      vh.push(product.id);
      if (vh.length > 30) vh = vh.slice(-30);
      state.viewedHistory = vh;
      localStorage.setItem('k_viewed_history', JSON.stringify(vh));
    } catch (_) { /* localStorage indispo : ignoré */ }

    // FIX scroll auto post-modal : la garde state.modalOpen dans b-pager.js
    // n'avait jamais été posée. On l'écrit AVANT d'émettre le bus pour que
    // tout listener qui purgerait les timers le voie déjà à true.
    state.modalOpen = true;

    // LOT 12: notify desktop-upgrade module
    bus.emit('modal:opened', product);
    // PR-3 / PR-4 — modules image UX + social proof
    setupImageUX();
    setupSocialProof();
    // F3 + F4 — livraison et trust bar mobile (masqués desktop via CSS)
    _injectMobileDelivery(product);
    _injectMobileTrust();
    // Lock body scroll — CSS handles layout via body.modal-open
    state._savedCatalogScrollY = getScrollY();
    document.body.style.setProperty('--modal-scroll-y', `-${state._savedCatalogScrollY}px`);
    document.body.classList.add('modal-open');
    // Signaler au CSS si le side-cart est visible (pour ajuster la largeur de la modal)
    if (document.getElementById('k-side-cart')?.classList.contains('has-items')) {
      document.body.classList.add('modal-has-cart');
    }

    // MOBILE SCROLL FIX — neutralise les styles inline posés par le pager
    // (#k-page-scroll.k-pager-active = position:fixed + overflow:hidden crée un
    // stacking context sur Chrome Android qui bride le scroll de .k-modal-scroll).
    // On garde la classe k-pager-active intacte (état logique) mais on efface
    // les propriétés physiques bloquantes pour la durée de la modal.
    if (window.innerWidth < 900) {
      var _ps = dom.pageScroll;
      if (_ps) {
        state._savedPagerInlineStyles = {
          position:  _ps.style.position,
          top:       _ps.style.top,
          left:      _ps.style.left,
          right:     _ps.style.right,
          bottom:    _ps.style.bottom,
          width:     _ps.style.width,
          height:    _ps.style.height,
          overflow:  _ps.style.overflow,
          overflowX: _ps.style.overflowX,
          overflowY: _ps.style.overflowY,
        };
        _ps.style.position  = '';
        _ps.style.top       = '';
        _ps.style.left      = '';
        _ps.style.right     = '';
        _ps.style.bottom    = '';
        _ps.style.width     = '';
        _ps.style.height    = '';
        _ps.style.overflow  = '';
        _ps.style.overflowX = '';
        _ps.style.overflowY = '';
      }
    }

    // Les actions restent hors du scroll : bouton Acheter toujours visible.
    // La topbar enrichie rappelle le produit ouvert pendant le scroll.
    setupModalFAB();
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
     Injecte 3 pills de réassurance avant .k-modal-actions.
     Masqué desktop par CSS (display:none @min-width:900px).       */
  function _injectMobileTrust() {
    if (!dom.modal) return;
    var old = dom.modal.querySelector('[data-mobile-trust]');
    if (old) old.remove();

    var actions = dom.modal.querySelector('.k-modal-actions');
    if (!actions || !actions.parentNode) return;

    var el = document.createElement('div');
    el.className = 'k-modal-trust-mobile';
    el.setAttribute('data-mobile-trust', '1');
    el.innerHTML =
      '<span class="k-modal-trust-mobile-item">📍 Retrait en relais</span>' +
      '<span class="k-modal-trust-mobile-item">💵 Paiement cash</span>' +
      '<span class="k-modal-trust-mobile-item">🔄 Échange 14 j</span>';

    actions.parentNode.insertBefore(el, actions);
  }


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

  // ── Boutons ← → dans la topbar de la modal
  /**
   * Met à jour les flèches de navigation produit suivant/précédent.
   * Masquées sur mobile, visibles desktop.
   * @param {number} currentIndex - Index produit dans la liste
   * @param {number} total - Total produits disponibles
   */
  function updateModalNavArrows(list, currentIdx) {
    let navEl = document.getElementById('k-modal-nav');
    if (!navEl) {
      navEl = document.createElement('div');
      navEl.id = 'k-modal-nav';
      // Styles in CSS: #k-modal-nav

      const prevBtn = document.createElement('button');
      prevBtn.id = 'k-modal-prev';
      prevBtn.className = 'k-modal-nav-btn';
      prevBtn.innerHTML = '←';
      prevBtn.addEventListener('click', () => navigateModal(-1));

      const counter = document.createElement('span');
      counter.id = 'k-modal-counter';
      counter.className = 'k-modal-nav-counter';

      const nextBtn = document.createElement('button');
      nextBtn.id = 'k-modal-next';
      nextBtn.className = 'k-modal-nav-btn';
      nextBtn.innerHTML = '→';
      nextBtn.addEventListener('click', () => navigateModal(1));

      navEl.appendChild(prevBtn);
      navEl.appendChild(counter);
      navEl.appendChild(nextBtn);

      // Insérer dans la topbar à droite du bouton back
      const topbar = dom.modal.querySelector('.k-modal-topbar');
      if (topbar) {
        const right = topbar.querySelector('.k-modal-topbar-right');
        topbar.insertBefore(navEl, right);
      }
    }

    const counter = document.getElementById('k-modal-counter');
    const prevBtn = document.getElementById('k-modal-prev');
    const nextBtn = document.getElementById('k-modal-next');

    if (counter) counter.textContent = `${currentIdx + 1}/${list.length}`;
    if (prevBtn) prevBtn.classList.toggle('is-disabled', currentIdx <= 0);
    if (nextBtn) nextBtn.classList.toggle('is-disabled', currentIdx >= list.length - 1);
  }

  /**
   * Retour arrière dans l'historique modal (produit précédent dans la pile).
   * Utilisé par le bouton ← dans le topbar modal.
   */
  function modalGoBack() {
    if (state.modalHistory.length === 0) { closeModal(); return; }
    const prevId = state.modalHistory.pop();
    openModal(prevId, false);
  }

  /**
   * @brief closeModal — Ferme la fiche produit et restaure l'état catalogue
   * Restaure le scroll Y du catalogue sauvegardé dans state._savedCatalogScrollY
   * Reset les subcats modal + suggestions
   */
    function closeModal() {
    hideModalFAB();
    // FIX: Pop history entry if we pushed one (don't pop if back button already did)
    if (_modalHistoryPushed) {
      _modalHistoryPushed = false;
      history.back();
    }
    dom.modalOverlay.classList.remove('open');
    // Unlock body scroll — CSS class drives layout
    const scrollY = state._savedCatalogScrollY || 0;
    document.body.classList.remove('modal-open');
    document.body.classList.remove('modal-has-cart');
    document.body.style.removeProperty('--modal-scroll-y');

    // MOBILE SCROLL FIX — restaurer les styles inline du pager
    if (window.innerWidth < 900 && state._savedPagerInlineStyles) {
      var _ps = dom.pageScroll;
      if (_ps) {
        var s = state._savedPagerInlineStyles;
        _ps.style.position  = s.position  || '';
        _ps.style.top       = s.top       || '';
        _ps.style.left      = s.left      || '';
        _ps.style.right     = s.right     || '';
        _ps.style.bottom    = s.bottom    || '';
        _ps.style.width     = s.width     || '';
        _ps.style.height    = s.height    || '';
        _ps.style.overflow  = s.overflow  || '';
        _ps.style.overflowX = s.overflowX || '';
        _ps.style.overflowY = s.overflowY || '';
      }
      state._savedPagerInlineStyles = null;
    }

    // FIX scroll auto post-modal : on ferme le flag AVANT le window.scrollTo
    // qui va déclencher un événement scroll sur la page interne du pager.
    // Sans ça, le bounce vertical s'arme à la frame suivante alors que
    // l'utilisateur n'a rien fait → page suivante en horizontal.
    state.modalOpen = false;
    // Notifier le pager pour qu'il purge ses timers de bounce en cours
    // (un setTimeout(_, 350) peut être armé juste avant l'ouverture).
    bus.emit('modal:closed');

    scrollToPosition(scrollY);
    state.modalProduct = null;
    state.modalHistory = [];
  }

  /**
   * Affiche les suggestions "🔍 Vous aimeriez vraiment" sous la fiche produit.
   * 20 produits, grille 2 colonnes, chips subcats filtrants.
   * IntersectionObserver sur sentinel → modal infini (v276).
   * @param {Object} product - Produit actif
   * @param {string|null} [subcatFilter=null] - Filtre sous-catégorie actif
   */
  function applyModalDesktopSuggestionState() {
    const sugSection = document.getElementById('k-modal-suggestions');
    const sugRail = document.getElementById('k-sug-rail');
    const _isDesktop = isDesktop();

    if (sugSection) {
      sugSection.classList.toggle('k-modal-suggestions--desktop-list', _isDesktop);
      // Desktop: ensure suggestions are a direct child of .k-modal-scroll (after product-zone)
      if (_isDesktop) {
        const scroll = dom.modal.querySelector('.k-modal-scroll');
        const productZone = dom.modal.querySelector('.k-modal-product-zone');
        if (scroll && productZone && sugSection.parentElement !== scroll) {
          scroll.appendChild(sugSection);
        }
      }
    }

    if (sugRail) {
      sugRail.classList.toggle('k-sug-rail--desktop-list', _isDesktop);
    }
  }

  function renderSuggestions(sameCat, otherCat, categoryName) {
        sameCat = sameCat || [];
    otherCat = otherCat || [];
    const sugSection = document.getElementById('k-modal-suggestions');
        if (!sugSection) return;

    if (sameCat.length === 0 && otherCat.length === 0) {
            sugSection.classList.add('u-hidden');
      return;
    }
    sugSection.classList.remove('u-hidden');
    if (categoryName) sugSection.dataset.cat = categoryName;
    
    // Template carte suggestion — stepper −/qty/+ en bas
    const cardHTML = (p) => {
      const inCart = state.cart.find(i => String(i.product.id) === String(p.id));
      const qty = inCart ? inCart.qty : 0;
      return `
      <div class="k-sug-card" data-id="${p.id}" data-subcat="${p.subcategory || ''}">
        <div class="k-sug-card-img">
          <img src="${optimizeImgUrl(p.image_url, 200)}" alt="${sanitize(p.name)}" loading="lazy" decoding="async">
          ${p.promo_pct ? `<span class="k-sug-promo-badge">-${p.promo_pct}%</span>` : ''}
        </div>
        <div class="k-sug-card-name">${sanitize(p.name)}</div>
        <div class="k-sug-card-bottom">
          <div class="k-sug-card-price">${fmtPrice(p.price_kmf)}</div>
          <div class="k-sug-card-actions">
            ${qty > 0
              ? `<button class="k-sug-step k-sug-minus" data-pid="${p.id}">−</button><span class="k-sug-qty">${qty}</span><button class="k-sug-step k-sug-plus" data-pid="${p.id}">+</button>`
              : `<button class="k-sug-add" data-add="${p.id}"><img src="/images/panier_tresse_vert.png" width="28" height="28" alt="+" style="pointer-events:none"></button>`
            }
          </div>
        </div>
      </div>`;
    };

    // Construire 2 sections distinctes avec titres contextuels
    let html = '';

    if (sameCat.length > 0) {
      const catLabel = categoryName ? categoryName.toLowerCase() : 'même catégorie';
      // ── Subcategory chips — "profond dedans" ──
      const uniqueSubcats = [...new Set(sameCat.map(p => p.subcategory).filter(Boolean))].sort().slice(0, 6);
      const activeFilter = state.modalSubcatFilter || null;
      let chipsHTML = '';
      if (uniqueSubcats.length >= 2) {
        chipsHTML = `<div class="k-sug-chips">
          <button class="k-sug-chip${!activeFilter ? ' is-active' : ''}" data-subcat="">Tout</button>
          ${uniqueSubcats.map(s => {
            const meta = (typeof getSubcategoryMeta === 'function' && categoryName)
              ? getSubcategoryMeta(categoryName, s) : null;
            const icon = meta && meta.icon ? `<span style="font-size:12px;line-height:1">${meta.icon}</span>` : '';
            return `<button class="k-sug-chip${activeFilter === s ? ' is-active' : ''}" data-subcat="${sanitize(s)}">${icon}${sanitize(s)}</button>`;
          }).join('')}
        </div>`;
      }
      html += `
        <div class="k-sug-section">
          <div class="k-sug-title">
            <span class="k-sug-title-icon">🔍</span>
            <span class="k-sug-title-text">🔍 Vous aimeriez vraiment ${sanitize(catLabel)}</span>
          </div>
          ${chipsHTML}
          <div class="k-sug-grid k-sug-grid--same">${sameCat.map(cardHTML).join('')}</div>
        </div>`;
    }

    if (otherCat.length > 0) {
      html += `
        <div class="k-sug-section">
          <div class="k-sug-title">
            <span class="k-sug-title-icon">✨</span>
            <span class="k-sug-title-text">✨ Cela peut vous plaire</span>
          </div>
          <div class="k-sug-grid k-sug-grid--other">${otherCat.map(cardHTML).join('')}</div>
        </div>`;
    }

    // Replacer tout le contenu (remplace le vieux <div class="k-sug-rail">)
    dom.sugRail.innerHTML = html;
    applyModalDesktopSuggestionState();
    // Masquer l'ancien h3 générique "Vous aimerez aussi" s'il existe
    const oldH3 = sugSection.querySelector('h3');
    if (oldH3) oldH3.classList.add('u-hidden');

    // ── Subcategory chip filter — "profond dedans" ──
    /**
     * Applique un filtre sous-catégorie sur les suggestions du modal.
     * Met à jour les chips actives + re-render suggestions filtrées.
     * @param {string|null} subcat - Slug sous-catégorie (null = tout)
     */
    function applySubcatFilter() {
      const filter = state.modalSubcatFilter;
      dom.sugRail.querySelectorAll('.k-sug-grid--same .k-sug-card').forEach(card => {
        if (!filter || card.dataset.subcat === filter) {
          card.classList.remove('subcat-hidden');
        } else {
          card.classList.add('subcat-hidden');
        }
      });
    }
    applySubcatFilter();

    dom.sugRail.querySelectorAll('.k-sug-chip').forEach(chip => {
      chip.addEventListener('click', (e) => {
        e.stopPropagation();
        state.modalSubcatFilter = chip.dataset.subcat || null;
        dom.sugRail.querySelectorAll('.k-sug-chip').forEach(c => c.classList.remove('is-active'));
        chip.classList.add('is-active');
        applySubcatFilter();
      });
    });

    // Clic sur toute la carte → ouvrir le produit
    dom.sugRail.querySelectorAll('.k-sug-card').forEach(card => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('.k-sug-add') || e.target.closest('.k-sug-step')) return;
        openModal(card.dataset.id);
      });
    });

    // Bouton "Ajouter" (pas encore dans le panier)
    dom.sugRail.querySelectorAll('.k-sug-add').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const product = state.products.find(p => String(p.id) === String(btn.dataset.add));
        if (!product) return;
        addToCart(product, 1, btn);
        // Re-render les suggestions pour afficher le stepper
        if (state.modalProduct) {
          const mp = state.modalProduct;
          const sameCat = state.products.filter(p => p.category === mp.category && p.id !== mp.id).slice(0, 20);
          const otherCat = state.products.filter(p => p.category !== mp.category).slice(0, 10);
          renderSuggestions(sameCat, otherCat, mp.category);
        }
      });
    });

    // Stepper −/+ (déjà dans le panier)
    dom.sugRail.querySelectorAll('.k-sug-minus').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        quickRemove(btn.dataset.pid, btn);
        // Re-render
        if (state.modalProduct) {
          const mp = state.modalProduct;
          const sameCat = state.products.filter(p => p.category === mp.category && p.id !== mp.id).slice(0, 20);
          const otherCat = state.products.filter(p => p.category !== mp.category).slice(0, 10);
          renderSuggestions(sameCat, otherCat, mp.category);
        }
      });
    });
    dom.sugRail.querySelectorAll('.k-sug-plus').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        quickAdd(btn.dataset.pid, btn);
        if (state.modalProduct) {
          const mp = state.modalProduct;
          const sameCat = state.products.filter(p => p.category === mp.category && p.id !== mp.id).slice(0, 20);
          const otherCat = state.products.filter(p => p.category !== mp.category).slice(0, 10);
          renderSuggestions(sameCat, otherCat, mp.category);
        }
      });
    });

    // ── Modal infini : auto-advance subcats quand fin de scroll ──
    if (window.innerWidth < 900) {
      var _mScrollEl = document.querySelector('.k-modal-scroll');
      if (_mScrollEl) {
        if (_mScrollEl._sugInfinite) {
          _mScrollEl.removeEventListener('scrollend', _mScrollEl._sugInfinite);
          clearTimeout(_mScrollEl._sugInfTimer);
        }
        var _mAdv = false;
        _mScrollEl._sugInfinite = function() {
          if (_mAdv) return;
          var rem = _mScrollEl.scrollHeight - _mScrollEl.scrollTop - _mScrollEl.clientHeight;
          if (rem > 80) return;
          _mAdv = true;
          var chipBtns = Array.from(dom.sugRail.querySelectorAll('.k-sug-chip'));
          if (chipBtns.length < 2) { _mAdv = false; return; }
          var activeIdx = chipBtns.findIndex(function(c) { return c.classList.contains('is-active'); });
          var nextIdx = (activeIdx + 1) % chipBtns.length;
          // Reshuffle si on revient à Tout (wrap)
          if (nextIdx === 0) {
            var _sg = dom.sugRail.querySelector('.k-sug-grid--same');
            if (_sg) {
              var _sc = Array.from(_sg.children);
              for (var _si = _sc.length - 1; _si > 0; _si--) {
                var _sj = Math.floor(Math.random() * (_si + 1));
                var _st = _sc[_si]; _sc[_si] = _sc[_sj]; _sc[_sj] = _st;
              }
              var _sf = document.createDocumentFragment();
              _sc.forEach(function(c) { _sf.appendChild(c); });
              _sg.appendChild(_sf);
            }
          }
          chipBtns[nextIdx].click();
          // Scroll doux vers le titre des suggestions
          setTimeout(function() {
            var sugTitle = dom.sugRail.querySelector('.k-sug-title');
            if (sugTitle) sugTitle.scrollIntoView({ behavior: 'smooth', block: 'start' });
            setTimeout(function() { _mAdv = false; }, 600);
          }, 150);
        };
        _mScrollEl.addEventListener('scrollend', _mScrollEl._sugInfinite, { passive: true });
        _mScrollEl.addEventListener('scroll', function() {
          clearTimeout(_mScrollEl._sugInfTimer);
          _mScrollEl._sugInfTimer = setTimeout(_mScrollEl._sugInfinite, 300);
        }, { passive: true });
      }
    }
  }

  /**
   * Initialise le modal produit complet (carousel, topbar, suggestions, swipe).
   * Point d'entrée appelé une seule fois au DOMContentLoaded.
   * Doctrine : structure HTML + CSS, JS = comportements uniquement.
   */
  function setupModal() {
    dom.modalBack.addEventListener('click', modalGoBack);
    dom.modalClose.addEventListener('click', closeModal);
    dom.modalCartBtn.addEventListener('click', () => {
      closeModal();
      setTimeout(openCart, 150);
    });
    dom.modalOverlay.addEventListener('click', (e) => {
      if (e.target === dom.modalOverlay) closeModal();
    });

    // FIX: Stepper +/− = ajout/retrait direct du panier (comme cartes suggestions)
    dom.qtyMinus.addEventListener('click', () => {
      if (!state.modalProduct) return;
      const pid = String(state.modalProduct.id);
      quickRemove(pid, dom.qtyMinus);
      _syncModalQtyUI();
    });
    dom.qtyPlus.addEventListener('click', () => {
      if (!state.modalProduct) return;
      const pid = String(state.modalProduct.id);
      quickAdd(pid, dom.qtyPlus);
      _syncModalQtyUI();
    });

    dom.addCartBtn.addEventListener('click', () => {
      if (!state.modalProduct || dom.addCartBtn.disabled || dom.addCartBtn.classList.contains('confirmed')) return;
      // Si pas encore dans le panier, ajouter 1
      addToCart(state.modalProduct, 1, dom.addCartBtn);
      _syncModalQtyUI();
    });

    // ── FIX #1 : Bouton favori dans la modal ──
    const modalFavBtn = document.getElementById('k-modal-fav-btn');
    if (modalFavBtn) {
      modalFavBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!state.modalProduct) return;
        toggleFav(state.modalProduct.id, modalFavBtn);
        // Aussi mettre à jour le cœur sur la carte grille correspondante
        const gridFavBtn = dom.grid
          ? dom.grid.querySelector(`.k-card-fav[data-fav="${state.modalProduct.id}"]`)
          : null;
        if (gridFavBtn) {
          const isNowFav = state.favs.includes(state.modalProduct.id);
          gridFavBtn.classList.toggle('liked', isNowFav);
          gridFavBtn.innerHTML = isNowFav ? '❤️' : '🤍';
        }
      });
    }

    // ── FIX #3 : Bloquer scroll passthrough sur la barre d'actions ──
    // passive:false + preventDefault() empêche le browser de scroller
    // quand le doigt touche la barre sticky Ajouter/Acheter.
    const actionsBar = dom.modal.querySelector('.k-modal-actions');
    if (actionsBar) {
      actionsBar.addEventListener('touchmove', (e) => {
        e.preventDefault();
        e.stopPropagation();
      }, { passive: false });
    }

    // ── Bouton "⚡ Acheter" — ajout + transition douce vers le panier
    const buyNowBtn = document.getElementById('k-buy-now-btn');
    if (buyNowBtn) {
      buyNowBtn.addEventListener('click', () => {
        if (!state.modalProduct) return;

        // 1. Feedback visuel immédiat : bouton se transforme en "✓ Ajouté !"
        const originalContent = buyNowBtn.innerHTML;
        buyNowBtn.innerHTML = '<span style="display:flex;align-items:center;gap:8px;justify-content:center"><span>✓</span><span>Ajouté au panier !</span></span>';
        buyNowBtn.disabled = true;
        buyNowBtn.classList.add('buy-confirmed');

        // 2. Ajout au panier (déclenche l'animation coucou de la dame)
        addToCart(state.modalProduct, state.modalQty, buyNowBtn);

        // 3. Transition ÉTENDUE : 1200ms pour voir le feedback + coucou dame
        //    puis fermeture douce et ouverture panier avec 400ms entre les 2
        //    (le user a le temps de voir le confirm vert + la dame coucou)
        setTimeout(() => {
          // Restaurer le bouton pour la prochaine ouverture
          buyNowBtn.innerHTML = originalContent;
          buyNowBtn.disabled = false;
          buyNowBtn.classList.remove('buy-confirmed');
          // Fermer la modale et ouvrir le panier avec fluidité
          closeModal();
          setTimeout(openCart, 400);  // augmenté de 250 → 400ms
        }, 1200);  // augmenté de 800 → 1200ms
      });
    }


    // ── Barre de recherche interne — Sprint 1 : dropdown résultats live ──
    // Recherche dans TOUS les produits (450+), dropdown avec images/prix,
    // navigation intra-modal, état vide, bouton clear.
    // + conserve le filtrage des suggestions existant (non-régression).
    (function setupModalInnerSearch() {
      const sugSection = document.getElementById('k-modal-suggestions');
      if (!sugSection || sugSection.previousElementSibling?.classList.contains('k-modal-inner-search')) return;

      // ── Construction du markup ──
      const searchWrap = document.createElement('div');
      searchWrap.className = 'k-modal-inner-search';
      searchWrap.innerHTML =
        '<svg class="k-modal-inner-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
          '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.35-4.35"/>' +
        '</svg>' +
        '<input type="search" class="k-modal-inner-search-input" ' +
               'placeholder="Chercher un produit..." autocomplete="off" autocorrect="off">' +
        '<button class="k-modal-search-clear" aria-label="Effacer" type="button">\u00d7</button>' +
        '<span class="k-modal-inner-search-hint">\u21b5 Catalogue</span>';

      // Insert search bar inside .k-modal-details (desktop: suggestions are now outside)
      var searchParent = dom.modal.querySelector('.k-modal-details') || sugSection.parentElement;
      searchParent.appendChild(searchWrap);

      // ── Dropdown container ──
      var dropdown = document.createElement('div');
      dropdown.className = 'k-modal-search-dropdown';
      dropdown.id = 'k-modal-search-dropdown';
      /* FIX: attacher au modal root (pas à .k-modal-details) pour sortir
         du stacking context + overflow clipping. position:fixed en CSS. */
      dom.modal.appendChild(dropdown);

      const searchInput = searchWrap.querySelector('.k-modal-inner-search-input');
      const clearBtn = searchWrap.querySelector('.k-modal-search-clear');
      state._modalSearchInput = searchInput;

      // ── Filtrage suggestions + dropdown résultats globaux ──
      // Factorisé pour être appelé depuis input ET keyup (fallback mobile)
      function _handleSearchInput() {
        var q = searchInput.value.trim().toLowerCase();
        searchWrap.classList.toggle('has-value', q.length > 0);

        // 1. Filtrage suggestions existantes (non-régression)
        var sugRailEl = document.getElementById('k-sug-rail');
        if (sugRailEl) {
          sugRailEl.querySelectorAll('.k-sug-card').forEach(function(card) {
            if (q.length < 2) { card.classList.remove('search-hidden'); return; }
            var pid = card.dataset.id;
            var p = state.products.find(function(x) { return String(x.id) === String(pid); });
            if (!p) { card.classList.add('search-hidden'); return; }
            var match =
              (p.name || '').toLowerCase().includes(q) ||
              (p.category || '').toLowerCase().includes(q) ||
              (p.description || '').toLowerCase().includes(q);
            card.classList.toggle('search-hidden', !match);
          });
        }

        // 2. Dropdown résultats globaux (450+ produits)
        clearTimeout(state._modalSearchTimeout);
        if (q.length < 2) {
          _closeDropdown();
          return;
        }
        state._modalSearchTimeout = setTimeout(function() {
          var results = state.products.filter(function(p) {
            return (p.name || '').toLowerCase().includes(q) ||
                   (p.category || '').toLowerCase().includes(q) ||
                   (p.description || '').toLowerCase().includes(q);
          });
          _renderDropdown(results, q);
        }, 150);
      }

      searchInput.addEventListener('input', _handleSearchInput);
      // Fallback : certains claviers mobiles (composition/prédiction)
      // ne déclenchent pas 'input' à chaque frappe → keyup rattrape.
      searchInput.addEventListener('keyup', function(e) {
        if (e.key === 'Enter') return; // déjà géré par keydown
        _handleSearchInput();
      });

      // ── Clear button ──
      clearBtn.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        _resetSearchState();
        searchInput.focus();
      });

      // ── Sprint 3 : Recherches récentes ──────────────────────────
      var RECENTS_KEY = 'k_recent_searches';
      var RECENTS_MAX = 5;

      function _getRecents() {
        try { return JSON.parse(localStorage.getItem(RECENTS_KEY) || '[]'); }
        catch(e) { return []; }
      }

      function _saveRecent(term) {
        if (!term || term.length < 2) return;
        var recents = _getRecents().filter(function(r) { return r !== term; });
        recents.unshift(term);
        if (recents.length > RECENTS_MAX) recents = recents.slice(0, RECENTS_MAX);
        try { localStorage.setItem(RECENTS_KEY, JSON.stringify(recents)); } catch(e) {}
      }

      function _removeRecent(term) {
        var recents = _getRecents().filter(function(r) { return r !== term; });
        try { localStorage.setItem(RECENTS_KEY, JSON.stringify(recents)); } catch(e) {}
      }

      function _renderRecents() {
        var recents = _getRecents();
        if (!recents.length) { _closeDropdown(); return; }
        dropdown.innerHTML =
          '<div class="k-msearch-recents-header">' +
            '<span>R\u00e9centes</span>' +
            '<button class="k-msearch-recents-clear" type="button">Effacer tout</button>' +
          '</div>' +
          recents.map(function(term) {
            return '<div class="k-msearch-recent-item" data-term="' + sanitize(term) + '">' +
              '<svg class="k-msearch-recent-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>' +
              '<span class="k-msearch-recent-label">' + sanitize(term) + '</span>' +
              '<button class="k-msearch-recent-remove" data-term="' + sanitize(term) + '" type="button" aria-label="Supprimer">\u00d7</button>' +
            '</div>';
          }).join('');
        _openDropdown();

        // Clic sur un terme récent → injecter et chercher
        dropdown.querySelectorAll('.k-msearch-recent-item').forEach(function(item) {
          item.addEventListener('click', function(e) {
            if (e.target.closest('.k-msearch-recent-remove')) return;
            var t = item.dataset.term;
            searchInput.value = t;
            searchInput.dispatchEvent(new Event('input', { bubbles: true }));
          });
        });

        // Supprimer un terme
        dropdown.querySelectorAll('.k-msearch-recent-remove').forEach(function(btn) {
          btn.addEventListener('click', function(e) {
            e.stopPropagation();
            _removeRecent(btn.dataset.term);
            _renderRecents();
          });
        });

        // Effacer tout
        var clearAll = dropdown.querySelector('.k-msearch-recents-clear');
        if (clearAll) {
          clearAll.addEventListener('click', function(e) {
            e.stopPropagation();
            try { localStorage.removeItem(RECENTS_KEY); } catch(e) {}
            _closeDropdown();
          });
        }
      }

      // Focus sur la barre vide → afficher les récents
      searchInput.addEventListener('focus', function() {
        if (searchInput.value.trim().length < 2) {
          _renderRecents();
        }
      });

      // ── Enter → catalogue (existant + sauvegarde récent Sprint 3) ──
      searchInput.addEventListener('keydown', function(e) {
        if (e.key !== 'Enter') return;
        var q = searchInput.value.trim();
        if (q.length < 1) { e.preventDefault(); return; }
        e.preventDefault();
        _saveRecent(q);
        _resetSearchState();
        closeModal();
        var mainInput = dom.searchInput || document.getElementById('k-search-input');
        if (mainInput) {
          mainInput.value = q;
          mainInput.dispatchEvent(new Event('input', { bubbles: true }));
          setTimeout(function() {
            var pageScroll = document.querySelector('.k-page-scroll') || document.scrollingElement;
            if (pageScroll) pageScroll.scrollTo({ top: 0, behavior: 'smooth' });
          }, 200);
        }
      });

      // ── Fermer dropdown au clic hors zone ──
      document.addEventListener('click', function(e) {
        if (!e.target.closest('.k-modal-inner-search') && !e.target.closest('.k-modal-search-dropdown')) {
          _closeDropdown();
        }
      });

      // ── Render dropdown — Sprint 2 : résultats catégorisés ──
      /* FIX: dropdown est maintenant position:fixed, attaché au modal root.
         _positionDropdown() calcule la position sous l'input actif (inline ou topbar).
         _liftDetails() garde le bump z-index en sécurité additionnelle. */
      var _detailsEl = dom.modal.querySelector('.k-modal-details');
      function _liftDetails()   { if (_detailsEl) _detailsEl.style.zIndex = '35'; }
      function _unliftDetails() { if (_detailsEl) _detailsEl.style.zIndex = ''; }

      function _positionDropdown() {
        var topbarActive = document.querySelector('.k-topbar-search-expanded.is-active');
        var refEl = topbarActive || searchWrap;
        var rect = refEl.getBoundingClientRect();
        dropdown.style.top = (rect.bottom + 4) + 'px';
        // Sur desktop, aligner avec la barre de recherche
        if (window.innerWidth >= 900) {
          var searchRect = searchWrap.getBoundingClientRect();
          dropdown.style.left = searchRect.left + 'px';
          dropdown.style.right = (window.innerWidth - searchRect.right) + 'px';
        }
      }

      function _openDropdown() {
        _liftDetails();
        _positionDropdown();
        dropdown.classList.add('open');
      }

      // Repositionner pendant le scroll
      var _mScrollDropdown = dom.modal.querySelector('.k-modal-scroll');
      if (_mScrollDropdown) {
        _mScrollDropdown.addEventListener('scroll', function() {
          if (dropdown.classList.contains('open')) _positionDropdown();
        }, { passive: true });
      }

      function _renderDropdown(results, query) {
        if (!results.length) {
          dropdown.innerHTML =
            '<div class="k-msearch-empty">' +
              '<div class="k-msearch-empty-icon">\ud83d\udd0d</div>' +
              '<div>Aucun produit trouv\u00e9 pour \u00ab\u00a0' + sanitize(query) + '\u00a0\u00bb</div>' +
            '</div>';
          _openDropdown();
          return;
        }

        var totalCount = results.length;

        // ── Grouper par catégorie ──
        var groups = {};
        var groupOrder = [];
        results.forEach(function(p) {
          var catKey = normalizeCategoryKey(p.category) || p.category || 'Autres';
          if (!groups[catKey]) {
            groups[catKey] = [];
            groupOrder.push(catKey);
          }
          groups[catKey].push(p);
        });

        // ── Construire le HTML ──
        var html = '<div class="k-msearch-count">' + totalCount + ' r\u00e9sultat' + (totalCount > 1 ? 's' : '') + '</div>';

        groupOrder.forEach(function(catKey) {
          var items = groups[catKey];
          var emoji = getCategorySectionEmoji(catKey) || '';
          var shown = items.slice(0, 3);
          var remaining = items.length - shown.length;

          html += '<div class="k-msearch-group" data-cat="' + sanitize(catKey) + '">';
          html += '<div class="k-msearch-group-header">' +
            '<span class="k-msearch-group-emoji">' + emoji + '</span>' +
            '<span class="k-msearch-group-label">' + sanitize(catKey) + '</span>' +
            '<span class="k-msearch-group-count">' + items.length + '</span>' +
          '</div>';

          html += shown.map(function(p) {
            var promo = p.promo_pct ? '<span class="k-msearch-item-promo">-' + p.promo_pct + '%</span>' : '';
            return '<div class="k-msearch-item" data-id="' + p.id + '">' +
              '<img class="k-msearch-item-img" src="' + optimizeImgUrl(p.image_url, 88) + '" alt="" loading="lazy">' +
              '<div class="k-msearch-item-info">' +
                '<div class="k-msearch-item-name">' + sanitize(p.name) + '</div>' +
              '</div>' +
              '<div class="k-msearch-item-right">' +
                '<span class="k-msearch-item-price">' + fmtPrice(p.price_kmf) + '</span>' +
                promo +
              '</div>' +
            '</div>';
          }).join('');

          if (remaining > 0) {
            html += '<div class="k-msearch-group-more" data-cat="' + sanitize(catKey) + '" data-query="' + sanitize(query) + '">' +
              'Voir ' + (remaining === 1 ? '1 autre' : 'les ' + remaining + ' autres') + ' dans ' + sanitize(catKey) + ' \u2192' +
            '</div>';
          }

          html += '</div>';
        });

        html += '<div class="k-msearch-footer" data-query="' + sanitize(query) + '">' +
          '\u21b5 Chercher \u00ab\u00a0' + sanitize(query) + '\u00a0\u00bb dans le catalogue' +
        '</div>';

        dropdown.innerHTML = html;
        _openDropdown();

        // ── Bind résultats : clic → switch produit intra-modal ──
        dropdown.querySelectorAll('.k-msearch-item').forEach(function(item) {
          item.addEventListener('click', function(e) {
            e.stopPropagation();
            var pid = item.dataset.id;
            _saveRecent(query);
            _resetSearchState();
            openModal(pid, false);
          });
        });

        // ── "Voir les X autres dans Catégorie" → catalogue filtré par catégorie ──
        dropdown.querySelectorAll('.k-msearch-group-more').forEach(function(btn) {
          btn.addEventListener('click', function(e) {
            e.stopPropagation();
            var cat = btn.dataset.cat;
            var q = btn.dataset.query || '';
            _saveRecent(q);
            _resetSearchState();
            closeModal();
            // Filtrer le catalogue sur cette catégorie + le terme
            setActiveCat(cat);
            var mainInput = dom.searchInput || document.getElementById('k-search-input');
            if (mainInput) {
              mainInput.value = q;
              mainInput.dispatchEvent(new Event('input', { bubbles: true }));
            }
            setTimeout(function() {
              var pageScroll = document.querySelector('.k-page-scroll') || document.scrollingElement;
              if (pageScroll) pageScroll.scrollTo({ top: 0, behavior: 'smooth' });
            }, 200);
          });
        });

        // ── Footer : lancer la recherche catalogue globale ──
        var footer = dropdown.querySelector('.k-msearch-footer');
        if (footer) {
          footer.addEventListener('click', function() {
            var q = footer.dataset.query || '';
            _saveRecent(q);
            _resetSearchState();
            closeModal();
            var mainInput = dom.searchInput || document.getElementById('k-search-input');
            if (mainInput) {
              mainInput.value = q;
              mainInput.dispatchEvent(new Event('input', { bubbles: true }));
              setTimeout(function() {
                var pageScroll = document.querySelector('.k-page-scroll') || document.scrollingElement;
                if (pageScroll) pageScroll.scrollTo({ top: 0, behavior: 'smooth' });
              }, 200);
            }
          });
        }
      }

      // ── Helper : reset propre de l'état search ──
      function _resetSearchState() {
        searchInput.value = '';
        searchWrap.classList.remove('has-value');
        _closeDropdown();
        var sugRailEl = document.getElementById('k-sug-rail');
        if (sugRailEl) sugRailEl.querySelectorAll('.k-sug-card.search-hidden').forEach(function(c) { c.classList.remove('search-hidden'); });
      }

      function _closeDropdown() {
        dropdown.classList.remove('open');
        _unliftDetails();
      }
    })();

    // ── Sprint 4 : Loupe mobile dans la topbar (collapse/expand) ──────
    // Sur mobile, ajoute un bouton loupe dans la topbar qui, au tap,
    // expand une barre de recherche pleine largeur dans la topbar.
    // Synced avec le même input/dropdown que la barre inline.
    (function setupTopbarSearch() {
      if (window.innerWidth >= 900) return; // desktop only uses inline search

      var topbar = dom.modal ? dom.modal.querySelector('.k-modal-topbar') : null;
      if (!topbar) return;

      // Ne pas injecter 2 fois
      if (topbar.querySelector('.k-topbar-search-trigger')) return;

      // ── Bouton loupe trigger ──
      var trigger = document.createElement('button');
      trigger.className = 'k-topbar-search-trigger';
      trigger.type = 'button';
      trigger.setAttribute('aria-label', 'Rechercher');
      trigger.innerHTML =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
          '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.35-4.35"/>' +
        '</svg>';

      // ── Barre expanded ──
      var expandedBar = document.createElement('div');
      expandedBar.className = 'k-topbar-search-expanded';
      expandedBar.innerHTML =
        '<button class="k-topbar-search-back" type="button" aria-label="Fermer la recherche">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>' +
        '</button>' +
        '<input type="search" class="k-topbar-search-input" placeholder="Chercher un produit\u2026" autocomplete="off" autocorrect="off">' +
        '<button class="k-topbar-search-clear-btn" type="button" aria-label="Effacer">\u00d7</button>';

      // Insert trigger before topbar-right
      var topbarRight = topbar.querySelector('.k-modal-topbar-right');
      if (topbarRight) {
        topbar.insertBefore(trigger, topbarRight);
      } else {
        topbar.appendChild(trigger);
      }
      topbar.appendChild(expandedBar);

      var tbInput = expandedBar.querySelector('.k-topbar-search-input');
      var tbBack = expandedBar.querySelector('.k-topbar-search-back');
      var tbClear = expandedBar.querySelector('.k-topbar-search-clear-btn');

      function _expandSearch() {
        expandedBar.classList.add('is-active');
        topbar.classList.add('search-mode');
        requestAnimationFrame(function() { tbInput.focus(); });
      }

      function _collapseSearch() {
        expandedBar.classList.remove('is-active');
        topbar.classList.remove('search-mode');
        tbInput.value = '';
        tbClear.classList.remove('is-visible');
        // Also reset the main inline search + dropdown
        if (state._modalSearchInput) {
          state._modalSearchInput.value = '';
          var wrap = state._modalSearchInput.closest('.k-modal-inner-search');
          if (wrap) wrap.classList.remove('has-value');
        }
        var dd = document.getElementById('k-modal-search-dropdown');
        if (dd) dd.classList.remove('open');
        // Restore suggestions
        var rail = document.getElementById('k-sug-rail');
        if (rail) rail.querySelectorAll('.k-sug-card.search-hidden').forEach(function(c) { c.classList.remove('search-hidden'); });
      }

      trigger.addEventListener('click', function(e) {
        e.stopPropagation();
        _expandSearch();
      });

      tbBack.addEventListener('click', function(e) {
        e.stopPropagation();
        _collapseSearch();
      });

      tbClear.addEventListener('click', function(e) {
        e.stopPropagation();
        tbInput.value = '';
        tbClear.classList.remove('is-visible');
        tbInput.focus();
        // Sync : clear the inline search too
        if (state._modalSearchInput) {
          state._modalSearchInput.value = '';
          state._modalSearchInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
      });

      // Sync typing → inject into the inline search (which does the real work)
      tbInput.addEventListener('input', function() {
        var q = tbInput.value;
        tbClear.classList.toggle('is-visible', q.length > 0);
        // Sync with the inline search input
        if (state._modalSearchInput) {
          state._modalSearchInput.value = q;
          state._modalSearchInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
      });

      // Enter in topbar → same as inline Enter
      tbInput.addEventListener('keydown', function(e) {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        // Delegate to inline search Enter handler by syncing then firing
        if (state._modalSearchInput) {
          state._modalSearchInput.value = tbInput.value;
          state._modalSearchInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        }
        _collapseSearch();
      });

      // Collapse on Escape
      tbInput.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
          e.stopPropagation();
          _collapseSearch();
        }
      });
    })();

    // ── Sprint 5 : Recherche vocale (Web Speech API) ──────────────
    // Bouton micro dans la barre inline. Feature-detected : masqué si non supporté.
    (function setupVoiceSearch() {
      var SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SpeechRecognition) return;

      var searchWrapEl = document.querySelector('.k-modal-inner-search');
      if (!searchWrapEl) return;
      if (searchWrapEl.querySelector('.k-modal-search-mic')) return;

      var mic = document.createElement('button');
      mic.className = 'k-modal-search-mic';
      mic.type = 'button';
      mic.setAttribute('aria-label', '\u00c9couter');
      mic.innerHTML =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
          '<rect x="9" y="1" width="6" height="12" rx="3"/>' +
          '<path d="M5 10a7 7 0 0 0 14 0"/>' +
          '<line x1="12" y1="17" x2="12" y2="21"/>' +
          '<line x1="8" y1="21" x2="16" y2="21"/>' +
        '</svg>';

      var clearEl = searchWrapEl.querySelector('.k-modal-search-clear');
      if (clearEl) {
        searchWrapEl.insertBefore(mic, clearEl);
      } else {
        searchWrapEl.appendChild(mic);
      }

      var recognition = null;
      var isListening = false;

      mic.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();

        if (isListening && recognition) {
          recognition.stop();
          return;
        }

        recognition = new SpeechRecognition();
        recognition.lang = 'fr-FR';
        recognition.continuous = false;
        recognition.interimResults = false;
        recognition.maxAlternatives = 1;

        mic.classList.add('is-listening');
        isListening = true;

        recognition.addEventListener('result', function(event) {
          var transcript = event.results[0][0].transcript.trim();
          if (transcript && state._modalSearchInput) {
            state._modalSearchInput.value = transcript;
            state._modalSearchInput.dispatchEvent(new Event('input', { bubbles: true }));
            state._modalSearchInput.focus();
          }
        });

        recognition.addEventListener('end', function() {
          mic.classList.remove('is-listening');
          isListening = false;
        });

        recognition.addEventListener('error', function() {
          mic.classList.remove('is-listening');
          isListening = false;
        });

        try { recognition.start(); } catch(err) {
          mic.classList.remove('is-listening');
          isListening = false;
        }
      });
    })();

        // ── Image zone: carousel swipe + pull-to-close (Temu-style)
    setupImageZoneTouch();

    // ── Image zone desktop : click gauche/droite pour naviguer dans le carousel
    setupImageZoneDesktopClick();

    // ── Navigation clavier ← → entre produits (desktop)
    // Hint visuel injecté une seule fois dans la topbar
    (function setupKeyboardNavHint() {
      if (window.innerWidth < 900) return;
      if (document.getElementById('k-modal-keyboard-hint')) return;
      var topbar = dom.modal ? dom.modal.querySelector('.k-modal-topbar') : null;
      if (!topbar) return;
      var hint = document.createElement('div');
      hint.id = 'k-modal-keyboard-hint';
      hint.className = 'k-modal-keyboard-hint';
      hint.innerHTML =
        '<kbd>←</kbd><span>produit précédent</span>' +
        '<kbd>→</kbd><span>produit suivant</span>';
      var right = topbar.querySelector('.k-modal-topbar-right');
      if (right) topbar.insertBefore(hint, right);
      else topbar.appendChild(hint);
    })();

    document.addEventListener('keydown', (e) => {
      if (!dom.modalOverlay.classList.contains('open')) return;
      if (e.key === 'ArrowRight') navigateModal(1);
      if (e.key === 'ArrowLeft') navigateModal(-1);
      if (e.key === 'Escape') closeModal();
    });
  }

  /**
   * Desktop uniquement : zones cliquables gauche/droite sur l'image du modal
   * pour naviguer dans le carousel sans devoir viser une miniature précise.
   * Reste discret (cursor change, pas de bouton visible) pour ne pas casser
   * le zoom-on-hover existant.
   */
  function setupImageZoneDesktopClick() {
    var imgWrap = dom.modal.querySelector('.k-modal-img-wrap');
    if (!imgWrap) return;
    imgWrap.addEventListener('click', function(e) {
      if (window.innerWidth < 900) return;
      if (state.carouselCount <= 1) return;
      // Évite de tirer si le click est sur une miniature ou sur le zoom preview
      if (e.target.closest('.k-modal-thumb, .k-modal-zoom-preview, .k-modal-zoom-lens')) return;
      var rect = imgWrap.getBoundingClientRect();
      var clickedLeft = (e.clientX - rect.left) < rect.width / 2;
      if (clickedLeft && state.carouselIndex > 0) {
        goToSlide(state.carouselIndex - 1);
      } else if (!clickedLeft && state.carouselIndex < state.carouselCount - 1) {
        goToSlide(state.carouselIndex + 1);
      }
    });
  }

  // ── Image zone: swipe ↔ carousel + swipe ↓ close (Temu-style) ──
  // Details zone: native ↕ scroll only — no gesture interference
  /**
   * Active le swipe ↔ sur la zone image du modal (carousel).
   * scroll-snap-type: x mandatory sur .k-card-carousel.
   * @param {HTMLElement} carousel - Élément carousel
   */
  function setupImageZoneTouch() {
    var imgWrap = dom.modal.querySelector('.k-modal-img-wrap');
    var track = dom.modalCarouselTrack;
    var modal = dom.modal;
    var startX, startY, isDragging, direction; // 'h' | 'v' | null

    imgWrap.addEventListener('touchstart', function(e) {
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      isDragging = true;
      direction = null;
    }, { passive: true });

    imgWrap.addEventListener('touchmove', function(e) {
      if (!isDragging) return;
      var dx = e.touches[0].clientX - startX;
      var dy = e.touches[0].clientY - startY;

      // Lock direction on first 8px movement
      if (!direction && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
        direction = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v';
      }

      // Horizontal → carousel (only if multi-image)
      if (direction === 'h' && state.carouselCount > 1) {
        e.preventDefault();
        track.style.transition = 'none';
        var offset = -state.carouselIndex * 100 + (dx / imgWrap.offsetWidth) * 100;
        track.style.transform = 'translateX(' + offset + '%)';
      }
      // Vertical down → pull-to-close
      else if (direction === 'v' && dy > 0) {
        modal.style.transform = 'translateY(' + (dy * 0.4) + 'px)';
        modal.style.transition = 'none';
        modal.style.opacity = String(Math.max(0.6, 1 - dy / 500));
      }
    }, { passive: false });

    imgWrap.addEventListener('touchend', function(e) {
      if (!isDragging) return;
      isDragging = false;
      var dx = e.changedTouches[0].clientX - startX;
      var dy = e.changedTouches[0].clientY - startY;

      if (direction === 'h' && state.carouselCount > 1) {
        // Carousel snap
        if (dx < -40 && state.carouselIndex < state.carouselCount - 1) {
          goToSlide(state.carouselIndex + 1);
        } else if (dx > 40 && state.carouselIndex > 0) {
          goToSlide(state.carouselIndex - 1);
        } else {
          goToSlide(state.carouselIndex); // snap back
        }
      } else if (direction === 'v') {
        modal.style.transition = 'transform .25s var(--ease), opacity .25s';
        modal.style.opacity = '';
        if (dy > 100) {
          modal.style.transform = 'translateY(100%)';
          setTimeout(function() { modal.style.transform = ''; closeModal(); }, 260);
        } else {
          modal.style.transform = '';
        }
      } else if (direction === null) {
        // TAP court (pas de mouvement significatif) → fullscreen image avec pinch-zoom natif
        openImageFullscreen(state.carouselIndex);
      }
    });
  }

  /**
   * Ouvre une image en plein écran (mobile).
   * Le navigateur gère nativement le pinch-to-zoom grâce à touch-action.
   * Tap simple ou bouton retour ferme le fullscreen.
   * @param {number} startIndex - Index de l'image à afficher en premier
   */
  function openImageFullscreen(startIndex) {
    if (!state.modalProduct) return;
    var images = state.modalProduct.images || [state.modalProduct.image_url];
    images = images.filter(Boolean);
    if (!images.length) return;

    // Réutilise un overlay existant si présent
    var overlay = document.getElementById('k-modal-fullscreen');
    if (overlay) overlay.remove();

    overlay = document.createElement('div');
    overlay.id = 'k-modal-fullscreen';
    overlay.className = 'k-modal-fullscreen';
    overlay.innerHTML =
      '<button class="k-modal-fullscreen-close" aria-label="Fermer">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>' +
      '</button>' +
      '<div class="k-modal-fullscreen-counter"></div>' +
      '<div class="k-modal-fullscreen-track">' +
        images.map(function(url) {
          return '<div class="k-modal-fullscreen-slide"><img src="' +
            optimizeImgUrl(url, 1600) + '" alt="" draggable="false"></div>';
        }).join('') +
      '</div>';

    document.body.appendChild(overlay);

    var track = overlay.querySelector('.k-modal-fullscreen-track');
    var counter = overlay.querySelector('.k-modal-fullscreen-counter');
    var idx = Math.max(0, Math.min(startIndex || 0, images.length - 1));

    function updateCounter() {
      counter.textContent = (idx + 1) + ' / ' + images.length;
      counter.style.display = images.length > 1 ? 'block' : 'none';
    }
    function snapTo(i) {
      idx = Math.max(0, Math.min(i, images.length - 1));
      track.style.transition = 'transform .3s cubic-bezier(.22,1,.36,1)';
      track.style.transform = 'translateX(-' + (idx * 100) + '%)';
      updateCounter();
    }
    snapTo(idx);
    track.style.transition = 'none'; // pas d'anim sur l'ouverture initiale
    track.style.transform = 'translateX(-' + (idx * 100) + '%)';
    setTimeout(function() { updateCounter(); }, 0);

    // Ouverture animée
    requestAnimationFrame(function() { overlay.classList.add('is-open'); });

    // Fermeture
    function close() {
      overlay.classList.remove('is-open');
      setTimeout(function() { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }, 200);
    }
    overlay.querySelector('.k-modal-fullscreen-close').addEventListener('click', close);

    // Swipe horizontal sur fullscreen pour changer d'image (sans bloquer le pinch-zoom)
    var fsStartX = null, fsMoved = false, fsLocked = null;
    track.addEventListener('touchstart', function(e) {
      // Si plus d'un doigt = pinch-zoom, on n'intercepte rien
      if (e.touches.length !== 1) { fsStartX = null; return; }
      fsStartX = e.touches[0].clientX;
      fsMoved = false;
      fsLocked = null;
    }, { passive: true });
    track.addEventListener('touchmove', function(e) {
      if (fsStartX == null || e.touches.length !== 1) return;
      var dx = e.touches[0].clientX - fsStartX;
      if (Math.abs(dx) > 6) fsMoved = true;
    }, { passive: true });
    track.addEventListener('touchend', function(e) {
      if (fsStartX == null) { fsStartX = null; return; }
      var dx = (e.changedTouches[0] || {}).clientX != null
        ? e.changedTouches[0].clientX - fsStartX : 0;
      if (!fsMoved) {
        // tap simple → ferme
        close();
      } else if (images.length > 1) {
        if (dx < -50) snapTo(idx + 1);
        else if (dx > 50) snapTo(idx - 1);
      }
      fsStartX = null;
    });
  }

  // ── Navigation ← → entre produits dans la modal
  /**
   * Navigue vers le produit suivant/précédent dans le modal.
   * Maintient une pile d'historique pour le bouton retour.
   * @param {number} direction - +1 (suivant) ou -1 (précédent)
   */
  function navigateModal(direction) {
    if (!state.modalProduct) return;
    const list = state.filtered.length ? state.filtered : state.products;
    const currentIdx = list.findIndex(p => p.id === state.modalProduct.id);
    if (currentIdx === -1) return;
    const nextIdx = currentIdx + direction;
    if (nextIdx < 0 || nextIdx >= list.length) return;

    const scrollEl = dom.modal.querySelector('.k-modal-scroll');
    if (scrollEl) {
      scrollEl.style.transition = 'opacity .12s, transform .12s';
      scrollEl.style.opacity = '0';
      scrollEl.style.transform = `translateX(${direction > 0 ? '-24px' : '24px'})`;
      setTimeout(() => {
        openModal(list[nextIdx].id, false);
        scrollEl.style.transition = 'none';
        scrollEl.style.opacity = '0';
        scrollEl.style.transform = `translateX(${direction > 0 ? '24px' : '-24px'})`;
        requestAnimationFrame(() => requestAnimationFrame(() => {
          scrollEl.style.transition = 'opacity .18s, transform .18s';
          scrollEl.style.opacity = '1';
          scrollEl.style.transform = 'translateX(0)';
        }));
      }, 130);
    } else {
      openModal(list[nextIdx].id, false);
    }
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

  /* ══════════════════════════════════════════════════════════
     CART DRAWER — Full mechanism
     ══════════════════════════════════════════════════════════ */

export {
  openModal, closeModal, modalGoBack, setupModal,
  buildCarouselSlides, goToSlide,
  renderSuggestions, setupImageZoneTouch, navigateModal,
  openSizeGuide, closeSizeGuide,
};
