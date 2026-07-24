/**
 * @komerce-arch
 * @role          product-modal-suggestions
 * @domain        recommendations
 * @layer         ui-component
 * @criticality   high
 * @inputs        current_product, catalog_state, navigation_context
 * @outputs       suggestion_rail, related_products, discovery_paths
 * @depends       b-store.js, b-utils.js, b-scroll-owner.js, b-cart.js, render-product-card.js
 * @used-by       b-modal-core.js
 * @doctrine      suggestions_decouverte_non_intrusives, boutique_canal_decouverte, no_hardcoded_taxonomy
 * @impact-areas  product-discovery, modal, personalization, catalog-navigation
 * @version       2026-07
 */
'use strict';

import { bus } from './b-bus.js';
import { state, dom, modalZone } from './b-store.js';
import { sanitize } from './b-utils.js';
import { isDesktop } from './b-scroll-owner.js';
import { quickAdd, quickRemove } from './b-cart.js';
import { getProductCartSummary } from './cart-product-summary.js';
import { renderProductCard, renderAddControl } from './render/render-product-card.js';

const _delegatedRoots = new WeakSet();

function _productId(product) {
  const value = product && (product.id ?? product.product_id);
  return value == null ? '' : String(value);
}

function _findProduct(productId) {
  const pid = String(productId);
  return state.products.find((product) => String(product.id) === pid) || null;
}

/**
 * Garantit deux niveaux de suggestions quand le catalogue local le permet.
 */
function _ensureTwoSuggestionLevels(sameCat, otherCat) {
  const product = state.modalProduct;
  if (!product || !Array.isArray(state.products)) return { sameCat, otherCat };

  const currentId = _productId(product);
  const seen = new Set([currentId].filter(Boolean));
  sameCat.concat(otherCat).forEach((candidate) => {
    const id = _productId(candidate);
    if (id) seen.add(id);
  });

  if (sameCat.length === 0) {
    sameCat = state.products
      .filter((candidate) => {
        const id = _productId(candidate);
        return candidate.category === product.category && id && !seen.has(id);
      })
      .slice(0, 20);
    sameCat.forEach((candidate) => {
      const id = _productId(candidate);
      if (id) seen.add(id);
    });
  }

  if (otherCat.length === 0) {
    otherCat = state.products
      .filter((p) => {
        const id = _productId(p);
        return p.category !== product.category && id && !seen.has(id);
      })
      .slice(0, 16);
  }

  return { sameCat, otherCat };
}

function _applySubcatFilter(root) {
  if (!root) return;
  const filter = state.modalSubcatFilter;
  root.querySelectorAll('.k-sug-grid--same .k-sug-card').forEach((card) => {
    card.classList.toggle('subcat-hidden', Boolean(filter && card.dataset.subcat !== filter));
  });
}

/**
 * Synchronise toutes les occurrences d'un produit. Aucun Map<id, element> :
 * un même produit peut apparaître dans plusieurs rails et toutes les cartes
 * doivent refléter le même état panier.
 */
function _syncSuggestionControls(productId) {
  const root = dom.sugRail;
  if (!root) return;
  const pidFilter = productId == null ? null : String(productId);

  root.querySelectorAll('.k-sug-card').forEach((card) => {
    const pid = String(card.dataset.id || '');
    if (!pid || (pidFilter && pid !== pidFilter)) return;

    const actions = card.querySelector('.k-sug-card-actions');
    if (!actions) return;

    const product = _findProduct(pid);
    const summary = getProductCartSummary(state.cart, pid);
    const safeName = product ? sanitize(product.name || '') : '';
    const canAdjust = summary.totalQty > 0 && summary.canQuickAdjust;
    const hasMultipleLines = summary.totalQty > 0 && !summary.canQuickAdjust;

    actions.classList.toggle('is-filled', canAdjust);
    actions.classList.toggle('has-multiple-lines', hasMultipleLines);
    actions.dataset.cartLines = String(summary.lineCount);
    actions.innerHTML = renderAddControl(pid, summary, safeName, 'modal-suggestion');
  });
}

const _boundSuggPeeks = new WeakSet();

/**
 * T-030+ (finition) : le teaser n'était qu'un texte statique — aucun geste ne menait
 * réellement aux cartes qu'il annonce. Sur les produits à contenu enrichi long
 * (specs/highlights desktop et mobile), les cartes peuvent être à 900px+ sous le fold ;
 * le teaser reste le seul repère garanti visible. On le rend donc activable :
 * clic ou clavier (Enter/Espace) scrolle jusqu'à #k-modal-suggestions.
 * Idempotent : le nœud est statique (jamais recréé par innerHTML), un seul bind suffit.
 */
function _bindSuggPeekScroll(sugPeek, sugSection) {
  if (!sugPeek || !sugSection || _boundSuggPeeks.has(sugPeek)) return;
  _boundSuggPeeks.add(sugPeek);

  const goToSuggestions = () => {
    sugSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  sugPeek.addEventListener('click', goToSuggestions);
  sugPeek.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
      event.preventDefault();
      goToSuggestions();
    }
  });
}

function _installSuggestionDelegation(root) {
  if (!root || _delegatedRoots.has(root)) return;
  _delegatedRoots.add(root);

  root.addEventListener('click', (event) => {
    const chip = event.target.closest('.k-sug-chip');
    if (chip && root.contains(chip)) {
      event.preventDefault();
      event.stopPropagation();
      state.modalSubcatFilter = chip.dataset.subcat || null;
      root.querySelectorAll('.k-sug-chip').forEach((candidate) => {
        candidate.classList.toggle('is-active', candidate === chip);
      });
      _applySubcatFilter(root);
      return;
    }

    const actionButton = event.target.closest('.k-sug-card-actions button[data-action]');
    if (actionButton && root.contains(actionButton)) {
      event.preventDefault();
      event.stopPropagation();
      const card = actionButton.closest('.k-sug-card');
      const actions = actionButton.closest('.k-sug-card-actions');
      const pid = String(
        actionButton.dataset.pid ||
        actionButton.dataset.add ||
        actions?.dataset.add ||
        card?.dataset.id ||
        ''
      );
      if (!pid) return;

      const action = actionButton.dataset.action;
      if (action === 'decrement') {
        quickRemove(pid, actionButton);
        _syncSuggestionControls(pid);
      } else if (action === 'review') {
        bus.emit('modal:open', { id: pid });
      } else if (action === 'increment') {
        quickAdd(pid, actionButton);
        _syncSuggestionControls(pid);
      } else if (action === 'add') {
        quickAdd(pid, actionButton, {
          hasVariants: actions?.dataset.hasVariants === '1',
        });
        _syncSuggestionControls(pid);
      }
      return;
    }

    const card = event.target.closest('.k-sug-card');
    if (card && root.contains(card)) {
      bus.emit('modal:open', { id: card.dataset.id });
    }
  });
}

// Le signal existe déjà dans b-cart-core.js : saveCart() → updateCartBadge()
// → bus 'cart:update'. On le réutilise au lieu de créer un événement concurrent.
bus.on('cart:update', () => _syncSuggestionControls());

function applyModalDesktopSuggestionState() {
  const sugSection = document.getElementById('k-modal-suggestions');
  const sugRail = document.getElementById('k-sug-rail');
  const desktop = isDesktop();

  if (sugSection) {
    sugSection.classList.toggle('k-modal-suggestions--desktop-list', desktop);
    if (desktop) {
      const scroll = modalZone('.k-modal-scroll');
      const productZone = modalZone('.k-modal-product-zone');
      if (scroll && productZone && sugSection.parentElement !== scroll) {
        scroll.appendChild(sugSection);
      }
    }
  }

  if (sugRail) sugRail.classList.toggle('k-sug-rail--desktop-list', desktop);
}

function _renderSuggestionCard(product) {
  return renderProductCard(product, { variant: 'suggestion', actionVariant: 'modal' });
}

function _setupMobileSuggestionAdvance() {
  if (window.innerWidth >= 900) return;
  const scrollEl = modalZone('.k-modal-scroll');
  if (!scrollEl) return;

  if (scrollEl._sugInfinite) {
    scrollEl.removeEventListener('scrollend', scrollEl._sugInfinite);
  }
  if (scrollEl._sugScrollFallback) {
    scrollEl.removeEventListener('scroll', scrollEl._sugScrollFallback);
  }
  clearTimeout(scrollEl._sugInfTimer);

  let advancing = false;
  scrollEl._sugInfinite = function() {
    if (advancing) return;
    const remaining = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight;
    if (remaining > 80) return;

    advancing = true;
    const chipButtons = Array.from(dom.sugRail.querySelectorAll('.k-sug-chip'));
    if (chipButtons.length < 2) {
      advancing = false;
      return;
    }

    const activeIndex = chipButtons.findIndex((chip) => chip.classList.contains('is-active'));
    const nextIndex = (activeIndex + 1) % chipButtons.length;

    if (nextIndex === 0) {
      const sameGrid = dom.sugRail.querySelector('.k-sug-grid--same');
      if (sameGrid) {
        const cards = Array.from(sameGrid.children);
        for (let index = cards.length - 1; index > 0; index -= 1) {
          const randomIndex = Math.floor(Math.random() * (index + 1));
          [cards[index], cards[randomIndex]] = [cards[randomIndex], cards[index]];
        }
        const fragment = document.createDocumentFragment();
        cards.forEach((card) => fragment.appendChild(card));
        sameGrid.appendChild(fragment);
      }
    }

    chipButtons[nextIndex].click();
    setTimeout(() => {
      const title = dom.sugRail.querySelector('.k-sug-title');
      if (title) title.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setTimeout(() => { advancing = false; }, 600);
    }, 150);
  };

  scrollEl._sugScrollFallback = function() {
    clearTimeout(scrollEl._sugInfTimer);
    scrollEl._sugInfTimer = setTimeout(scrollEl._sugInfinite, 300);
  };

  scrollEl.addEventListener('scrollend', scrollEl._sugInfinite, { passive: true });
  scrollEl.addEventListener('scroll', scrollEl._sugScrollFallback, { passive: true });
}

function renderSuggestions(sameCat, otherCat, categoryName) {
  sameCat = sameCat || [];
  otherCat = otherCat || [];
  ({ sameCat, otherCat } = _ensureTwoSuggestionLevels(sameCat, otherCat));

  const sugSection = document.getElementById('k-modal-suggestions');
  if (!sugSection || !dom.sugRail) return;
  const sugPeek = document.getElementById('k-modal-sugg-peek');

  if (sameCat.length === 0 && otherCat.length === 0) {
    sugSection.classList.add('u-hidden');
    if (sugPeek) sugPeek.hidden = true;
    dom.sugRail.innerHTML = '';
    return;
  }

  sugSection.classList.remove('u-hidden');
  if (sugPeek) {
    sugPeek.hidden = false;
    _bindSuggPeekScroll(sugPeek, sugSection);
  }
  sugSection.classList.remove('k-pdp-curation');
  delete sugSection.dataset.curationProductId;
  if (categoryName) sugSection.dataset.cat = categoryName;

  let html = '';

  if (sameCat.length > 0) {
    const catLabel = categoryName ? categoryName.toLowerCase() : 'même catégorie';
    const uniqueSubcats = [...new Set(sameCat.map((product) => product.subcategory).filter(Boolean))]
      .sort()
      .slice(0, 6);
    const activeFilter = state.modalSubcatFilter || null;
    let chipsHTML = '';

    if (uniqueSubcats.length >= 2) {
      chipsHTML = `<div class="k-sug-chips">
        <button type="button" class="k-sug-chip${!activeFilter ? ' is-active' : ''}" data-subcat="">Tout</button>
        ${uniqueSubcats.map((subcategory) => {
          const meta = typeof getSubcategoryMeta === 'function' && categoryName
            ? getSubcategoryMeta(categoryName, subcategory)
            : null;
          const icon = meta?.icon
            ? `<span style="font-size:12px;line-height:1">${sanitize(meta.icon)}</span>`
            : '';
          const safeSubcategory = sanitize(subcategory);
          return `<button type="button" class="k-sug-chip${activeFilter === subcategory ? ' is-active' : ''}" data-subcat="${safeSubcategory}">${icon}${safeSubcategory}</button>`;
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
        <div class="k-sug-grid k-sug-grid--same">${sameCat.map(_renderSuggestionCard).join('')}</div>
      </div>`;
  }

  if (otherCat.length > 0) {
    html += `
      <div class="k-sug-section">
        <div class="k-sug-title">
          <span class="k-sug-title-icon">✨</span>
          <span class="k-sug-title-text">✨ Cela peut vous plaire</span>
        </div>
        <div class="k-sug-grid k-sug-grid--other">${otherCat.map(_renderSuggestionCard).join('')}</div>
      </div>`;
  }

  dom.sugRail.innerHTML = html;
  _installSuggestionDelegation(dom.sugRail);
  _applySubcatFilter(dom.sugRail);
  applyModalDesktopSuggestionState();

  const oldHeading = sugSection.querySelector('h3');
  if (oldHeading) oldHeading.classList.add('u-hidden');

  bus.emit('modal:suggestions-rendered', { product: state.modalProduct });
  _setupMobileSuggestionAdvance();
}

export { renderSuggestions };
