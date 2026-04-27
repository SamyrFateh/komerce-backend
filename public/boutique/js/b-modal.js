/**
 * b-modal.js — Module ES · §9 MODAL
 * Extrait de boutique.js Sprint 2F — Option C
 *
 * Fiche produit, carousel, suggestions, subcat chips
 */

import { bus }           from './b-bus.js';
import {
  state, SUBCATS, dom, $, $$,
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

    track.innerHTML = '';
    images.forEach(function(url, i) {
      var img = document.createElement('img');
      img.className = 'k-modal-slide';
      img.src = optimizeImgUrl(url, 600);
      img.alt = product.name || '';
      img.draggable = false;
      track.appendChild(img);
    });
    dom.modalImg = track.querySelector('.k-modal-slide');

    dots.innerHTML = '';
    if (images.length > 1) {
      images.forEach(function(_, i) {
        var dot = document.createElement('span');
        dot.className = 'k-modal-dot' + (i === 0 ? ' is-active' : '');
        dot.addEventListener('click', function() { goToSlide(i); });
        dots.appendChild(dot);
      });
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
    var allDots = dom.modalDots.querySelectorAll('.k-modal-dot');
    allDots.forEach(function(d, i) {
      d.classList.toggle('is-active', i === index);
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
    // Lock body scroll — CSS handles layout via body.modal-open
    state._savedCatalogScrollY = window.scrollY;
    document.body.style.setProperty('--modal-scroll-y', `-${state._savedCatalogScrollY}px`);
    document.body.classList.add('modal-open');

    // ── Déplacer les actions DANS le scroll pour un flux unifié ──
    const modalScroll = document.querySelector('.k-modal-scroll');
    const modalActions = document.querySelector('.k-modal-actions');
    if (modalScroll && modalActions && modalActions.parentElement !== modalScroll) {
      modalScroll.appendChild(modalActions);
    }

    // ── FAB flottant : apparaît quand les vrais boutons sortent du viewport ──
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
   * Configure la topbar sticky du modal (bouton ⚡, prix, badge stock).
   * Sur mobile : bouton "Acheter" réduit à "⚡" pour ne pas écraser le prix.
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
        <button class="k-topbar-buy" aria-label="Acheter">⚡ Acheter</button>
      `;
      // Insérer avant .k-modal-topbar-right
      const rightBar = topbar.querySelector('.k-modal-topbar-right');
      if (rightBar) {
        topbar.insertBefore(productEl, rightBar);
      } else {
        topbar.appendChild(productEl);
      }

      // Wire click sur Acheter
      productEl.querySelector('.k-topbar-buy').addEventListener('click', () => {
        const buyBtn = document.getElementById('k-buy-now-btn');
        if (buyBtn) buyBtn.click();
      });

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
