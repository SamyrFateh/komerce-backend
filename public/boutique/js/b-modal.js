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

'use strict';

// Receive close-modal signal from b-cart (avoids circular dep)
bus.on('modal:close', function() { if (typeof closeModal === 'function') closeModal(); });

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
    images.forEach(function(url, i) {
      var img = document.createElement('img');
      img.className = 'k-modal-slide';
      img.src = optimizeImgUrl(url, 800);
      img.alt = product.name || '';
      img.draggable = false;
      img.loading = i === 0 ? 'eager' : 'lazy';
      track.appendChild(img);
    });
    dom.modalImg = track.querySelector('.k-modal-slide');

    // ── Dots mobile ────────────────────────────────────────────
    dots.innerHTML = '';
    if (images.length > 1) {
      images.forEach(function(_, i) {
        var dot = document.createElement('span');
        dot.className = 'k-modal-dot' + (i === 0 ? ' is-active' : '');
        dot.addEventListener('click', function() { goToSlide(i); });
        dots.appendChild(dot);
      });
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
  }

  /**
   * @brief openModal — Ouvre la fiche produit (modal Shein-style)
   * Mémorise scrollY du catalogue pour restauration à la fermeture
   * Charge carousel images + suggestions + subcats filtrants
   * @param {string|number} id - ID du produit
   * @param {boolean} [pushHistory] - Pousser dans l'historique navigateur (retour natif)
   */
    function openModal(id, pushHistory) {
    const product = state.products.find(p => p.id === id);
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
      state._savedCatalogScrollY = window.scrollY;
    }

    if (pushHistory !== false && state.modalProduct) {
      state.modalHistory.push(state.modalProduct.id);
    }

    state.modalProduct = product;
    state.modalQty = 1;

    // Fix 1+2: reset "Ajouter" button — disabled, classes, confirmed state
    if (dom.addCartBtn) {
      dom.addCartBtn.disabled = false;
      dom.addCartBtn.onclick = null;
      if (dom.addCartBtn.classList.contains('confirmed') || dom.addCartBtn.querySelector('.k-btn-done')) {
        dom.addCartBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/></svg> Ajouter au panier';
      }
      dom.addCartBtn.classList.remove('added', 'in-cart', 'confirmed');
    }

    buildCarouselSlides(product);
    dom.modalName.textContent = product.name;
    dom.modalDesc.textContent = product.description || '';
    dom.modalPrice.textContent = fmtPrice(product.price_kmf);
    dom.modalQtyVal.textContent = '1';

    if (product.promo_pct) {
      const old = Math.round(product.price_kmf / (1 - product.promo_pct / 100));
      dom.modalOldPrice.textContent = fmtPrice(old);
      dom.modalOldPrice.classList.remove('u-hidden');
      dom.modalPromoBadge.textContent = `-${product.promo_pct}%`;
      dom.modalPromoBadge.classList.add('show');
    } else {
      dom.modalOldPrice.classList.add('u-hidden');
      dom.modalPromoBadge.classList.remove('show');
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
    // LOT 12: notify desktop-upgrade module
    bus.emit('modal:opened', product);
    // Lock body scroll — CSS handles layout via body.modal-open
    state._savedCatalogScrollY = window.scrollY;
    document.body.style.setProperty('--modal-scroll-y', `-${state._savedCatalogScrollY}px`);
    document.body.classList.add('modal-open');

    // MOBILE SCROLL FIX — neutralise les styles inline posés par le pager
    // (#k-page-scroll.k-pager-active = position:fixed + overflow:hidden crée un
    // stacking context sur Chrome Android qui bride le scroll de .k-modal-scroll).
    // On garde la classe k-pager-active intacte (état logique) mais on efface
    // les propriétés physiques bloquantes pour la durée de la modal.
    if (window.innerWidth < 900) {
      var _ps = document.getElementById('k-page-scroll');
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
    dom.modalOverlay.classList.remove('open');
    // Unlock body scroll — CSS class drives layout
    const scrollY = state._savedCatalogScrollY || 0;
    document.body.classList.remove('modal-open');
    document.body.style.removeProperty('--modal-scroll-y');

    // MOBILE SCROLL FIX — restaurer les styles inline du pager
    if (window.innerWidth < 900 && state._savedPagerInlineStyles) {
      var _ps = document.getElementById('k-page-scroll');
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

    window.scrollTo(0, scrollY);
    state.modalProduct = null;
    state.modalHistory = [];
  }

  /**
   * Affiche les suggestions "Dans la catégorie" sous la fiche produit.
   * 20 produits, grille 2 colonnes, chips subcats filtrants.
   * IntersectionObserver sur sentinel → modal infini (v276).
   * @param {Object} product - Produit actif
   * @param {string|null} [subcatFilter=null] - Filtre sous-catégorie actif
   */
  function applyModalDesktopSuggestionState() {
    const sugSection = document.getElementById('k-modal-suggestions');
    const sugRail = document.getElementById('k-sug-rail');
    const isDesktop = window.innerWidth >= 900;

    if (sugSection) {
      sugSection.classList.toggle('k-modal-suggestions--desktop-list', isDesktop);
      // Desktop: ensure suggestions are a direct child of .k-modal-scroll (after product-zone)
      if (isDesktop) {
        const scroll = dom.modal.querySelector('.k-modal-scroll');
        const productZone = dom.modal.querySelector('.k-modal-product-zone');
        if (scroll && productZone && sugSection.parentElement !== scroll) {
          scroll.appendChild(sugSection);
        }
      }
    }

    if (sugRail) {
      sugRail.classList.toggle('k-sug-rail--desktop-list', isDesktop);
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
      const uniqueSubcats = [...new Set(sameCat.map(p => p.subcategory).filter(Boolean))].sort().slice(0, 5);
      const activeFilter = state.modalSubcatFilter || null;
      let chipsHTML = '';
      if (uniqueSubcats.length >= 2) {
        chipsHTML = `<div class="k-sug-chips">
          <button class="k-sug-chip${!activeFilter ? ' is-active' : ''}" data-subcat="">Tout</button>
          ${uniqueSubcats.map(s => `<button class="k-sug-chip${activeFilter === s ? ' is-active' : ''}" data-subcat="${sanitize(s)}">${sanitize(s)}</button>`).join('')}
        </div>`;
      }
      html += `
        <div class="k-sug-section">
          <div class="k-sug-title">
            <span class="k-sug-title-icon">🔍</span>
            <span class="k-sug-title-text">Dans la catégorie ${sanitize(catLabel)}</span>
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
            <span class="k-sug-title-text">Vous aimerez peut-être aussi</span>
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
        const product = state.products.find(p => p.id === btn.dataset.add);
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

    dom.qtyMinus.addEventListener('click', () => {
      if (state.modalQty > 1) { state.modalQty--; dom.modalQtyVal.textContent = state.modalQty; }
    });
    dom.qtyPlus.addEventListener('click', () => {
      state.modalQty++;
      dom.modalQtyVal.textContent = state.modalQty;
    });

    dom.addCartBtn.addEventListener('click', () => {
      if (!state.modalProduct || dom.addCartBtn.disabled || dom.addCartBtn.classList.contains('confirmed')) return;
      addToCart(state.modalProduct, state.modalQty, dom.addCartBtn);
    });

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
      searchParent.appendChild(dropdown);

      const searchInput = searchWrap.querySelector('.k-modal-inner-search-input');
      const clearBtn = searchWrap.querySelector('.k-modal-search-clear');
      state._modalSearchInput = searchInput;

      // ── Filtrage suggestions + dropdown résultats globaux ──
      searchInput.addEventListener('input', function() {
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
        }, 200);
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
        dropdown.classList.add('open');

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
      function _renderDropdown(results, query) {
        if (!results.length) {
          dropdown.innerHTML =
            '<div class="k-msearch-empty">' +
              '<div class="k-msearch-empty-icon">\ud83d\udd0d</div>' +
              '<div>Aucun produit trouv\u00e9 pour \u00ab\u00a0' + sanitize(query) + '\u00a0\u00bb</div>' +
            '</div>';
          dropdown.classList.add('open');
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
        dropdown.classList.add('open');

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
            state.activeCat = cat;
            state.activeSubcat = null;
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

    // ── Navigation clavier ← → entre produits (desktop)
    document.addEventListener('keydown', (e) => {
      if (!dom.modalOverlay.classList.contains('open')) return;
      if (e.key === 'ArrowRight') navigateModal(1);
      if (e.key === 'ArrowLeft') navigateModal(-1);
      if (e.key === 'Escape') closeModal();
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
      }
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
     CART DRAWER — Full mechanism
     ══════════════════════════════════════════════════════════ */

export {
  openModal, closeModal, modalGoBack, setupModal,
  buildCarouselSlides, goToSlide,
  renderSuggestions, setupImageZoneTouch, navigateModal,
};
