/**
 * @komerce-arch-lite
 * @role          catalog-render-product-card
 * @domain        catalog
 * @layer         ui-renderer
 * @owner         public/boutique/js/b-catalog.js
 * @purpose       supports public/boutique/js/b-catalog.js
 * @impact-areas  catalog, product-discovery
 * @version       2026-07
 */
'use strict';

/**
 * @module render-product-card
 * @brief Renderer unique des cartes produit Komerce.
 *
 * The renderer consumes ProductCardViewModel so sourcing/design variability
 * is translated before HTML rendering.
 *
 * See:
 * - docs/BOUTIQUE_PRODUCT_DISPLAY_CONTRACT.md
 */

import { state } from '../b-store.js';
import {
  sanitize,
  renderProductCarousel,
  productImageFallbackAttr,
} from '../b-utils.js';
import { isFav } from '../b-cart-core.js';
import { getProductCartSummary } from '../cart-product-summary.js';
import { buildProductCardViewModel } from '../view-models/product-card-view-model.js';
import { getCategoryByKey } from '../shop-schema.js';

function normalizeCartSummary(productId, value) {
  if (value && typeof value === 'object' && 'totalQty' in value) return value;
  const qty = Number(value) || 0;
  return {
    productId: String(productId),
    lines: [],
    line: null,
    lineCount: qty > 0 ? 1 : 0,
    totalQty: qty,
    hasVariantLines: false,
    isAmbiguous: false,
    canQuickAdjust: qty > 0,
  };
}

/**
 * Rend le contenu du contrôle d'ajout — conteneur non interactif,
 * vrais boutons à l'intérieur (jamais de bouton imbriqué dans un bouton).
 *
 * `cartState` accepte encore un nombre pour compatibilité avec les tests et
 * consommateurs historiques, mais les renderers canoniques lui passent la
 * synthèse complète produite par getProductCartSummary().
 *
 * @param {string} productId
 * @param {number|Object} cartState
 * @param {string} safeName - nom échappé du produit (pour aria-label)
 * @param {'grid'|'suggestion'|'catalog-suggestion'|'modal-suggestion'} variant
 */
export function renderAddControl(productId, cartState, safeName, variant) {
  const summary = normalizeCartSummary(productId, cartState);
  const qty = summary.totalQty;
  const label = safeName || 'ce produit';
  const isModalSuggestion = variant === 'modal-suggestion';
  const isCatalogSuggestion = variant === 'suggestion' || variant === 'catalog-suggestion';
  const isSuggestion = isModalSuggestion || isCatalogSuggestion;
  const addClass = isModalSuggestion
    ? 'k-sug-add'
    : isCatalogSuggestion
      ? 'k-catalog-sug-add'
      : 'k-card-add-trigger';
  const plusClass = isSuggestion ? 'k-sug-add-plus' : 'k-card-add-plus';
  const minusClass = isSuggestion ? 'k-sug-step k-sug-minus' : 'k-add-minus';
  const plusIcClass = isSuggestion ? 'k-sug-step k-sug-plus' : 'k-add-plus-ic';
  const qtyClass = isSuggestion ? 'k-sug-qty' : 'k-add-qty';

  if (qty > 0 && summary.canQuickAdjust) {
    return (
      `<button type="button" class="${minusClass}" data-action="decrement" data-pid="${productId}" aria-label="Retirer une unité de ${label}">−</button>` +
      `<output class="${qtyClass}" aria-live="polite" aria-label="Quantité">${qty}</output>` +
      `<button type="button" class="${plusIcClass}" data-action="increment" data-pid="${productId}" aria-label="Ajouter une unité de ${label}">+</button>`
    );
  }

  // Plusieurs lignes (ex. plusieurs tailles/couleurs) : afficher le total sans
  // proposer un +/- trompeur. Le clic ouvre la fiche pour modifier précisément.
  if (qty > 0) {
    return (
      `<button type="button" class="${addClass} k-card-add-review" data-action="review" aria-label="Modifier les variantes de ${label}, quantité totale ${qty}">` +
        `<span class="${qtyClass}" aria-hidden="true">${qty}</span>` +
      `</button>`
    );
  }

  return (
    `<button type="button" class="${addClass}" data-action="add" aria-label="Ajouter ${label} au panier">` +
      `<span class="${plusClass}" aria-hidden="true">+</span>` +
    `</button>`
  );
}

function renderGridCard(product, cartSummary) {
  const vm = buildProductCardViewModel(product, {
    variant: 'grid',
    imageSize: 400,
    category: getCategoryByKey(product.category) || null,
  });
  const hasQty = cartSummary.totalQty > 0;
  const canAdjust = hasQty && cartSummary.canQuickAdjust;

  return `
    <div class="k-card ${vm.cssClassName}" data-id="${vm.id}">
      <div class="k-card-img-wrap">
        ${renderProductCarousel(vm.raw, 400)}
        ${vm.promoLabel ? `<span class="k-card-promo">${vm.promoLabel}</span>` : ''}
        <button class="k-card-fav${isFav(vm.id) ? ' liked' : ''}" data-fav="${vm.id}" aria-label="Favori">
          ${isFav(vm.id) ? '❤️' : '🤍'}
        </button>
      </div>
      <div class="k-card-info">
        <div class="k-card-name">${vm.safeName}</div>
        ${vm.safeDescription ? `<div class="k-card-desc">${vm.safeDescription}</div>` : ''}
        <div class="k-card-bottom k-card-prices-row">
          <div class="k-card-price-col">
            <span class="k-card-price">${vm.priceLabel}</span>
            ${vm.priceEurLabel ? `<span class="k-card-price-eur">${vm.priceEurLabel}</span>` : ''}
            ${vm.oldPriceLabel ? `<span class="k-card-old-price">${vm.oldPriceLabel}</span>` : ''}
          </div>
          <div class="k-card-add${canAdjust ? ' in-cart' : ''}${hasQty && !canAdjust ? ' has-multiple-lines' : ''}" data-add="${vm.id}" data-has-variants="${vm.hasVariants ? '1' : '0'}" data-cart-lines="${cartSummary.lineCount}" role="group" aria-label="Quantité de ${vm.safeName}">
            ${renderAddControl(vm.id, cartSummary, vm.safeName, 'grid')}
          </div>
        </div>
      </div>
    </div>`;
}

function renderSuggestionCard(product, cartSummary, actionVariant) {
  const vm = buildProductCardViewModel(product, {
    variant: 'suggestion',
    imageSize: 200,
    category: getCategoryByKey(product.category) || null,
  });
  const hasQty = cartSummary.totalQty > 0;
  const canAdjust = hasQty && cartSummary.canQuickAdjust;
  const controlVariant = actionVariant === 'modal' ? 'modal-suggestion' : 'catalog-suggestion';
  const reasonHtml = vm.raw.reason_label
    ? `<div class="k-sug-card-reason">${sanitize(vm.raw.reason_label)}</div>`
    : '';

  return `
    <div class="k-sug-card ${vm.cssClassName}" data-id="${vm.id}" data-subcat="${sanitize(vm.raw.subcategory || '')}">
      <div class="k-sug-card-img">
        <img src="${vm.optimizedImageUrl}" alt="${vm.imageAlt}" loading="lazy" decoding="async" ${productImageFallbackAttr()}>
        <span class="k-sug-card-img-fallback" aria-hidden="true">📦</span>
        ${vm.promoLabel ? `<span class="k-sug-promo-badge">${vm.promoLabel}</span>` : ''}
      </div>
      <div class="k-sug-card-name">${vm.safeName}</div>
      ${reasonHtml}
      <div class="k-sug-card-bottom">
        <div class="k-sug-card-price">${vm.priceLabel}</div>
        <div class="k-sug-card-actions${canAdjust ? ' is-filled' : ''}${hasQty && !canAdjust ? ' has-multiple-lines' : ''}" data-add="${vm.id}" data-has-variants="${vm.hasVariants ? '1' : '0'}" data-cart-lines="${cartSummary.lineCount}" role="group" aria-label="Quantité de ${vm.safeName}">
          ${renderAddControl(vm.id, cartSummary, vm.safeName, controlVariant)}
        </div>
      </div>
    </div>`;
}

export function renderProductCard(product, options = {}) {
  const variant = options.variant || 'grid';
  const cartSummary = getProductCartSummary(state.cart, product.id);
  if (variant === 'suggestion') {
    return renderSuggestionCard(product, cartSummary, options.actionVariant || 'catalog');
  }
  return renderGridCard(product, cartSummary);
}
