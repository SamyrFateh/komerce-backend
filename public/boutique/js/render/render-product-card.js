/**
 * @module render-product-card
 * @brief Renderer unique des cartes produit Komerce.
 */

import { state } from '../b-store.js';
import {
  sanitize,
  fmt,
  fmtPrice,
  optimizeImgUrl,
  renderProductCarousel,
} from '../b-utils.js';
import { isFav } from '../b-cart-core.js';

function getCartQty(productId) {
  const inCart = state.cart.find((item) => String(item.product.id) === String(productId));
  return inCart ? inCart.qty : 0;
}

function renderAddControl(productId, qty, variant) {
  if (variant === 'suggestion') {
    if (qty > 0) {
      return `<button class="k-sug-step k-sug-minus" data-pid="${productId}">−</button><span class="k-sug-qty">${qty}</span><button class="k-sug-step k-sug-plus" data-pid="${productId}">+</button>`;
    }
    return `<button class="k-sug-add" data-add="${productId}"><img src="/images/panier_tresse_vert.png" width="28" height="28" alt="+" style="pointer-events:none"></button>`;
  }

  if (qty > 0) {
    return `<span class="k-add-minus" data-pid="${productId}">−</span><span class="k-add-qty">${qty}</span><span class="k-add-plus-ic">+</span>`;
  }
  return '<img src="/images/panier_tresse_vert.png" class="k-card-add-basket" alt="+" width="28" height="28">';
}

function renderGridCard(product, qty) {
  return `
    <div class="k-card" data-id="${product.id}">
      <div class="k-card-img-wrap">
        ${renderProductCarousel(product, 400)}
        ${product.promo_pct ? `<span class="k-card-promo">-${product.promo_pct}%</span>` : ''}
        <button class="k-card-fav${isFav(product.id) ? ' liked' : ''}" data-fav="${product.id}" aria-label="Favori">
          ${isFav(product.id) ? '❤️' : '🤍'}
        </button>
      </div>
      <div class="k-card-info">
        <div class="k-card-name">${sanitize(product.name)}</div>
        ${product.description ? `<div class="k-card-desc">${sanitize(product.description)}</div>` : ''}
        <div class="k-card-bottom k-card-prices-row">
          <div class="k-card-price-col">
            <span class="k-card-price">${fmtPrice(product.price_kmf)}</span>
            <span class="k-card-price-eur">≈ ${fmt(product.price_kmf, 'EUR')}</span>
            ${product.promo_pct ? `<span class="k-card-old-price">${fmtPrice(Math.round(product.price_kmf / (1 - product.promo_pct / 100)))}</span>` : ''}
          </div>
          <button class="k-card-add${qty > 0 ? ' in-cart' : ''}" data-add="${product.id}" aria-label="Ajouter">
            ${renderAddControl(product.id, qty, 'grid')}
          </button>
        </div>
      </div>
    </div>`;
}

function renderSuggestionCard(product, qty) {
  return `
    <div class="k-sug-card" data-id="${product.id}" data-subcat="${sanitize(product.subcategory || '')}">
      <div class="k-sug-card-img">
        <img src="${optimizeImgUrl(product.image_url, 200)}" alt="${sanitize(product.name)}" loading="lazy" decoding="async">
        ${product.promo_pct ? `<span class="k-sug-promo-badge">-${product.promo_pct}%</span>` : ''}
      </div>
      <div class="k-sug-card-name">${sanitize(product.name)}</div>
      <div class="k-sug-card-bottom">
        <div class="k-sug-card-price">${fmtPrice(product.price_kmf)}</div>
        <div class="k-sug-card-actions">
          ${renderAddControl(product.id, qty, 'suggestion')}
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
