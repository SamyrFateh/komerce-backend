/**
 * @module b-modal-suggestions
 * @brief Rail de suggestions de la fiche produit — extrait de b-modal.js (ARCH-2, PR2).
 *
 * Périmètre (responsabilité « Rail suggestions, filtre sous-catégorie interne ») :
 *   - renderSuggestions : 2 sections (« même catégorie » + « cela peut vous plaire »),
 *     cartes avec stepper panier, chips de filtre sous-catégorie, et le modal infini
 *     mobile (auto-advance des chips en fin de scroll).
 *   - applyModalDesktopSuggestionState : bascule layout desktop (privé, intra-module).
 *
 * Découplage cycle : la carte suggestion ouvre un produit via bus.emit('modal:open')
 *   au lieu d'appeler openModal directement → ce module n'importe RIEN de b-modal.js,
 *   donc pas de cycle direct (garde-fou check:imports I-2). Le handler est déjà câblé
 *   en tête de b-modal.js : bus.on('modal:open', ({id}) => openModal(String(id))).
 *
 * Corps de fonction repris à l'identique de b-modal.js (seule modification : le
 *   openModal(id) direct devient bus.emit('modal:open', {id})).
 *
 * Consommateurs : b-modal.js (openModal appelle renderSuggestions ; il le ré-exporte
 *   aussi pour préserver sa surface publique).
 *
 * Dépendances : b-bus.js, b-store.js, b-utils.js, b-scroll-owner.js, b-cart.js
 */

import { bus }                            from './b-bus.js';
import { state, dom, modalZone }           from './b-store.js'; // S5 — hook DOM centralisé
import { sanitize, fmtPrice, optimizeImgUrl } from './b-utils.js';
import { isDesktop }                      from './b-scroll-owner.js';
import { addToCart, quickAdd, quickRemove } from './b-cart.js';

'use strict';

// RANK-01 — Map productId → cardElement pour mises à jour ciblées (évite re-render complet)
const _sugCardMap = new Map();

/**
 * Met à jour uniquement la zone actions d'une carte suggestion existante.
 * Préserve le DOM de la carte (image, nom, prix, reason_label).
 * @param {string|number} pid
 */
function _updateCardStepper(pid) {
  const card = _sugCardMap.get(String(pid));
  if (!card) return;
  const inCart = state.cart.find(i => String(i.product?.id ?? i.id) === String(pid));
  const qty = inCart ? inCart.qty : 0;
  const actionsEl = card.querySelector('.k-sug-card-actions');
  if (!actionsEl) return;
  if (qty > 0) {
    actionsEl.innerHTML =
      `<button class="k-sug-step k-sug-minus" data-pid="${pid}">−</button>` +
      `<span class="k-sug-qty">${qty}</span>` +
      `<button class="k-sug-step k-sug-plus" data-pid="${pid}">+</button>`;
  } else {
    actionsEl.innerHTML =
      `<button class="k-sug-add" data-add="${pid}"><img src="/images/panier_tresse_vert.png" width="28" height="28" alt="+" style="pointer-events:none"></button>`;
  }
  _bindCardActions(card);
}

/**
 * Câble les listeners d'une carte (ou re-câble après mise à jour du stepper).
 * Idempotent : cloneNode+replace évite l'empilement de listeners.
 * @param {HTMLElement} card
 */
function _bindCardActions(card) {
  // Remplace la zone actions par un clone propre (purge les anciens listeners)
  const old = card.querySelector('.k-sug-card-actions');
  if (!old) return;
  const fresh = old.cloneNode(true);
  old.parentNode.replaceChild(fresh, old);

  const addBtn = fresh.querySelector('.k-sug-add');
  if (addBtn) {
    addBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const product = state.products.find(p => String(p.id) === String(addBtn.dataset.add));
      if (!product) return;
      addToCart(product, 1, addBtn);
      _updateCardStepper(addBtn.dataset.add);
    });
  }
  const minusBtn = fresh.querySelector('.k-sug-minus');
  if (minusBtn) {
    minusBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      quickRemove(minusBtn.dataset.pid, minusBtn);
      _updateCardStepper(minusBtn.dataset.pid);
    });
  }
  const plusBtn = fresh.querySelector('.k-sug-plus');
  if (plusBtn) {
    plusBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      quickAdd(plusBtn.dataset.pid, plusBtn);
      _updateCardStepper(plusBtn.dataset.pid);
    });
  }
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
        const scroll = modalZone('.k-modal-scroll');
        const productZone = modalZone('.k-modal-product-zone');
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
    
    // Template carte suggestion — stepper −/qty/+ en bas + reason_label (RANK-01)
    const cardHTML = (p) => {
      const inCart = state.cart.find(i => String(i.product?.id ?? i.id) === String(p.id));
      const qty = inCart ? inCart.qty : 0;
      const reasonHtml = p.reason_label
        ? `<div class="k-sug-card-reason">${sanitize(p.reason_label)}</div>`
        : '';
      return `
      <div class="k-sug-card" data-id="${p.id}" data-subcat="${p.subcategory || ''}">
        <div class="k-sug-card-img">
          <img src="${optimizeImgUrl(p.image_url, 200)}" alt="${sanitize(p.name)}" loading="lazy" decoding="async">
          ${p.promo_pct ? `<span class="k-sug-promo-badge">-${p.promo_pct}%</span>` : ''}
        </div>
        <div class="k-sug-card-name">${sanitize(p.name)}</div>
        ${reasonHtml}
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
    // RANK-01 — Alimenter la map productId → cardElement
    _sugCardMap.clear();
    dom.sugRail.querySelectorAll('.k-sug-card').forEach(card => {
      _sugCardMap.set(String(card.dataset.id), card);
    });
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
        // ARCH-2 PR2 : découplage du cycle b-modal ↔ b-modal-suggestions —
        // on passe par le bus (handler bus.on('modal:open') dans b-modal.js)
        // au lieu d'importer openModal directement. Comportement identique.
        bus.emit('modal:open', { id: card.dataset.id });
      });
    });

    // RANK-01 — Câblage initial des actions via _bindCardActions (mise à jour ciblée, pas de re-render)
    dom.sugRail.querySelectorAll('.k-sug-card').forEach(card => {
      _bindCardActions(card);
    });

    // ── Modal infini : auto-advance subcats quand fin de scroll ──
    if (window.innerWidth < 900) {
      var _mScrollEl = modalZone('.k-modal-scroll');
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

export { renderSuggestions };
