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
} from '../b-utils.js';
import { isFav } from '../b-cart-core.js';
import { buildProductCardViewModel } from '../view-models/product-card-view-model.js';
import { getCategoryByKey } from '../shop-schema.js';

function getCartQty(productId) {
  const inCart = state.cart.find((item) => String(item.product.id) === String(productId));
  return inCart ? inCart.qty : 0;
}

function renderAddControl(productId, qty, variant) {
  if (variant === 'suggestion') {
    if (qty > 0) {
      return `<button class="k-sug-step k-sug-minus" data-pid="${productId}">−</button><span class="k-sug-qty">${qty}</span><button class="k-sug-step k-sug-plus" data-pid="${productId}">+</button>`;
    }
    return `<button class="k-catalog-sug-add" data-add="${productId}"><img src="/images/panier_tresse_vert.png" width="28" height="28" alt="+" style="pointer-events:none"></button>`;
  }

  if (qty > 0) {
    return `<span class="k-add-minus" data-pid="${productId}">−</span><span class="k-add-qty">${qty}</span><span class="k-add-plus-ic">+</span>`;
  }
  return '<img src="/images/panier_tresse_vert.png" class="k-card-add-basket" alt="+" width="28" height="28">';
}

function renderGridCard(product, qty) {
  const vm = buildProductCardViewModel(product, {
    variant: 'grid',
    imageSize: 400,
    category: getCategoryByKey(product.category) || null,
  });

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
          <button class="k-card-add${qty > 0 ? ' in-cart' : ''}" data-add="${vm.id}" aria-label="Ajouter">
            ${renderAddControl(vm.id, qty, 'grid')}
          </button>
        </div>
      </div>
    </div>`;
}

function renderSuggestionCard(product, qty) {
  const vm = buildProductCardViewModel(product, {
    variant: 'suggestion',
    imageSize: 200,
    category: getCategoryByKey(product.category) || null,
  });

  return `
    <div class="k-sug-card ${vm.cssClassName}" data-id="${vm.id}" data-subcat="${sanitize(vm.raw.subcategory || '')}">
      <div class="k-sug-card-img">
        <img src="${vm.optimizedImageUrl}" alt="${vm.imageAlt}" loading="lazy" decoding="async">
        ${vm.promoLabel ? `<span class="k-sug-promo-badge">${vm.promoLabel}</span>` : ''}
      </div>
      <div class="k-sug-card-name">${vm.safeName}</div>
      <div class="k-sug-card-bottom">
        <div class="k-sug-card-price">${vm.priceLabel}</div>
        <div class="k-sug-card-actions">
          ${renderAddControl(vm.id, qty, 'suggestion')}
        </div>
      </div>
    </div>`;
}

export function renderProductCard(product, options = {}) {
  const variant = options.variant || 'grid';
  const qty = getCartQty(product.id);
  if (variant === 'suggestion') return renderSuggestionCard(product, qty);
  return renderGridCard(product, qty);
}