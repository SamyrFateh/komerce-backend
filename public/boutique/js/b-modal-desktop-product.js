/**
 * @komerce-arch
 * @role          desktop-product-modal-renderer
 * @domain        catalog
 * @layer         ui-renderer
 * @criticality   high
 * @inputs        product_detail_v1, modal_selection_state
 * @outputs       desktop_product_modal_dom
 * @depends       b-store.js, b-utils.js, b-scroll-owner.js, b-modal-product.js, b-modal-image-ux.js, view-models/modal-selection-model.js
 * @used-by       b-modal-product-detail-bootstrap.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_PRODUCT_DETAIL_CONTRACT.md, docs/boutique/BOUTIQUE_MODAL_ARCHITECTURE.md
 * @impact-areas  product-modal, desktop, sku-selection, delivery-options, media-carousel
 * @version       2026-07
 */

'use strict';

import { state, dom, modalZone } from './b-store.js';
import { fmtPrice, optimizeImgUrl } from './b-utils.js';
import { isDesktop } from './b-scroll-owner.js';
import {
  OPTION_STATE,
  selectModalOption,
} from './view-models/modal-selection-model.js';
import { buildCarouselSlides, goToSlide } from './b-modal-product.js';
import { setupImageUX } from './b-modal-image-ux.js';

let _qtyObserver = null;
let _qtyObservedEl = null;

function isPhotoAxis(axis) {
  return /couleur|color|coloris|teinte/i.test(axis.key || axis.display_name || '');
}

function activeUnit(detail, selection) {
  return (detail.sellable_units || []).find((unit) => unit.sku_id === selection.selected_sku_id) || null;
}

function currentPrice(detail, selection) {
  const unit = activeUnit(detail, selection);
  return unit?.price_kmf ?? detail?.pricing?.price_kmf ?? null;
}

function mediaSignature(selection) {
  return (selection.selected_media || []).map((media) => `${media.id}:${media.url}`).join('|');
}

function renderMedia(detail, selection, force = false) {
  const signature = mediaSignature(selection);
  if (!force && state.modalMediaSignature === signature) return;
  state.modalMediaSignature = signature;

  const media = selection.selected_media && selection.selected_media.length
    ? selection.selected_media
    : (detail.media || []);

  buildCarouselSlides({
    name: detail.product.name,
    images: media.map((item) => item.url),
    image_url: media[0]?.url || '',
  });
  goToSlide(0);
  setupImageUX();
}

function renderIdentity(detail) {
  if (dom.modalName) dom.modalName.textContent = detail.product.name;
  if (dom.modalDesc) {
    dom.modalDesc.textContent = detail.product.description || '';
    dom.modalDesc.classList.remove('is-expanded');
  }
  if (dom.modalCat) dom.modalCat.textContent = detail.product.category || '';

  const promo = Number(detail.pricing.promo_pct || 0);
  if (dom.modalPromoBadge) {
    dom.modalPromoBadge.textContent = promo > 0 ? `-${promo}%` : '';
    dom.modalPromoBadge.classList.toggle('show', promo > 0);
  }
  dom.modal?.classList.toggle('k-modal--has-promo', promo > 0);

  // Les anciennes zones reconstruisaient prix EUR, économie et faux stock depuis
  // le produit brut. PDC-5 les neutralise ; PDC-6 supprimera leur code legacy.
  const aed = document.getElementById('k-modal-aed-price');
  const flash = document.getElementById('k-modal-flash-bar');
  const stockBar = document.getElementById('k-modal-stock-bar');
  if (aed) aed.innerHTML = '';
  if (flash) flash.innerHTML = '';
  if (stockBar) stockBar.innerHTML = '';
}

function renderPriceAndReference(detail, selection) {
  const unit = activeUnit(detail, selection);
  const price = currentPrice(detail, selection);
  if (dom.modalPrice) dom.modalPrice.textContent = price != null ? fmtPrice(price) : '';

  if (dom.modalOldPrice) {
    const oldPrice = detail.pricing.old_price_kmf;
    dom.modalOldPrice.textContent = oldPrice != null ? fmtPrice(oldPrice) : '';
    dom.modalOldPrice.classList.toggle('u-hidden', oldPrice == null);
  }

  if (dom.modalSku) {
    const reference = unit?.sku || detail.product.reference;
    dom.modalSku.textContent = reference ? `Réf. ${reference}` : '';
    dom.modalSku.hidden = !reference;
  }
}

function renderStock(selection) {
  if (!dom.modalStock) return;

  if (!selection.selection_supported) {
    dom.modalStock.textContent = '';
    dom.modalStock.hidden = true;
    return;
  }

  dom.modalStock.hidden = false;
  if (selection.selected_sku_id) {
    dom.modalStock.textContent = '✓ Disponible';
    dom.modalStock.className = 'k-modal-stock k-modal-stock--ok';
    return;
  }

  dom.modalStock.textContent = Object.keys(selection.selected_options).length > 0
    ? 'Choisissez la suite'
    : 'Choisissez vos options';
  dom.modalStock.className = 'k-modal-stock';
}

function renderActions(detail, selection) {
  const enabled = detail.inventory_model !== 'SKU' || Boolean(selection.selected_sku_id);
  [dom.addCartBtn, document.getElementById('k-buy-now-btn')].forEach((button) => {
    if (!button) return;
    button.disabled = !enabled;
    if (!enabled) button.setAttribute('aria-describedby', 'k-modal-selection-message');
    else button.removeAttribute('aria-describedby');
  });
}

function optionReason(optionState) {
  if (optionState === OPTION_STATE.OUT_OF_STOCK) return 'Rupture';
  if (optionState === OPTION_STATE.INCOMPATIBLE) return 'Non proposé';
  return '';
}

function renderSelectionMessage(root, selection) {
  const message = document.createElement('p');
  message.id = 'k-modal-selection-message';
  message.className = 'k-modal-selection-message';
  message.setAttribute('role', 'status');
  message.setAttribute('aria-live', 'polite');
  message.textContent = selection.selection_message || '';
  message.hidden = !selection.selection_message;
  root.appendChild(message);
}

function renderAxis(detail, selection, axis, onSelectionChanged) {
  const group = document.createElement('section');
  group.className = 'k-vg';
  group.dataset.axisKey = axis.key;

  const label = document.createElement('div');
  label.className = 'k-vg-label';
  const type = document.createElement('span');
  type.className = 'k-vg-label-type';
  type.textContent = axis.display_name;
  const sep = document.createElement('span');
  sep.className = 'k-vg-label-sep';
  sep.textContent = '·';
  const value = document.createElement('span');
  value.className = 'k-vg-label-val';
  value.textContent = selection.selected_options[axis.key] || 'Choisir';
  label.append(type, sep, value);
  group.appendChild(label);

  const photo = isPhotoAxis(axis);
  const wrap = document.createElement('div');
  wrap.className = photo ? 'k-vg-skus' : 'k-vg-sizes';
  const states = new Map(
    (selection.option_states[axis.key] || []).map((entry) => [entry.value, entry.state])
  );

  axis.values.forEach((option) => {
    const stateValue = states.get(option.value) || OPTION_STATE.INCOMPATIBLE;
    const active = selection.selected_options[axis.key] === option.value;
    const unavailable = stateValue !== OPTION_STATE.AVAILABLE;
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.optionValue = option.value;
    button.dataset.optionState = stateValue;
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
    button.setAttribute(
      'aria-label',
      `${axis.display_name} ${option.value}${unavailable ? ` — ${optionReason(stateValue)}` : ''}`
    );

    if (photo && option.thumbnail_url) {
      button.className = `k-sku${active ? ' k-sku--active' : ''}${unavailable ? ' k-vp--out' : ''}`;
      const image = document.createElement('img');
      image.src = optimizeImgUrl(option.thumbnail_url, 140);
      image.alt = '';
      image.loading = 'lazy';
      const name = document.createElement('span');
      name.className = 'k-sku-name';
      name.textContent = option.value;
      button.append(image, name);
    } else {
      button.className = `k-vp${active ? ' k-vp--active' : ''}${unavailable ? ' k-vp--out' : ''}`;
      button.textContent = option.value;
    }

    button.addEventListener('click', () => {
      state.modalSelection = selectModalOption(
        detail,
        state.modalSelection,
        axis.key,
        option.value
      );
      onSelectionChanged();
    });

    wrap.appendChild(button);
  });

  group.appendChild(wrap);
  return group;
}

function deliveryMeta(option) {
  const parts = [];
  if (option.price_kmf != null) parts.push(fmtPrice(option.price_kmf));
  if (option.eta_label) parts.push(option.eta_label);
  if (!option.available && option.unavailable_reason) parts.push(option.unavailable_reason);
  return parts.join(' · ');
}

function renderDeliveryOptions(detail) {
  const el = document.getElementById('k-modal-delivery');
  if (!el) return;
  el.innerHTML = '';

  const title = document.createElement('div');
  title.className = 'k-modal-section-title';
  title.textContent = 'Livraison';
  el.appendChild(title);

  const options = detail?.delivery_options || [];
  if (!options.length) {
    const empty = document.createElement('div');
    empty.className = 'k-modal-delivery-opt';
    empty.textContent = 'Option de livraison communiquée à la commande.';
    el.appendChild(empty);
    return;
  }

  options.forEach((option) => {
    const row = document.createElement('div');
    row.className = 'k-modal-delivery-opt';
    row.dataset.deliveryCode = option.code;

    const body = document.createElement('div');
    body.className = 'k-modal-opt-body';
    const row1 = document.createElement('div');
    row1.className = 'k-modal-opt-row1';
    const icon = document.createElement('span');
    icon.className = 'k-modal-opt-icon';
    icon.textContent = '📦';
    const label = document.createElement('span');
    label.textContent = option.label;
    row1.append(icon, label);

    const metaText = deliveryMeta(option);
    body.appendChild(row1);
    if (metaText) {
      const row2 = document.createElement('div');
      row2.className = 'k-modal-opt-row2';
      row2.textContent = metaText;
      body.appendChild(row2);
    }

    row.appendChild(body);
    el.appendChild(row);
  });
}

function renderSubtotal(detail, selection) {
  const actions = modalZone('.k-modal-actions');
  if (!actions) return;
  let subtotal = actions.querySelector('.k-modal-subtotal');
  if (!subtotal) {
    subtotal = document.createElement('div');
    subtotal.className = 'k-modal-subtotal';
    actions.appendChild(subtotal);
  }

  const price = currentPrice(detail, selection);
  const qty = Math.max(1, Number(state.modalQty) || 1);
  if (price == null) {
    subtotal.textContent = '';
    return;
  }

  subtotal.textContent = 'Sous-total : ';
  const strong = document.createElement('strong');
  strong.textContent = fmtPrice(price * qty);
  subtotal.appendChild(strong);
}

function ensureQtyObserver() {
  const qtyEl = dom.modalQtyVal;
  if (!qtyEl || typeof MutationObserver === 'undefined') return;
  if (_qtyObserver && _qtyObservedEl === qtyEl) return;

  if (_qtyObserver) _qtyObserver.disconnect();
  _qtyObservedEl = qtyEl;
  _qtyObserver = new MutationObserver(() => {
    if (!isDesktop() || !state.modalProductDetail || !state.modalSelection) return;
    renderSubtotal(state.modalProductDetail, state.modalSelection);
  });
  _qtyObserver.observe(qtyEl, {
    childList: true,
    characterData: true,
    subtree: true,
  });
}

/**
 * Composition desktop : galerie à gauche et Buy Box à droite. Toute disponibilité
 * provient de `selection`; ce renderer ne lit jamais product_variants.stock.
 */
export function renderDesktopProductDetail(detail, selection, { forceMedia = false } = {}) {
  const container = dom.modalVariants || document.getElementById('k-modal-variants');
  if (!container || !isDesktop()) return;

  state.modalProductDetail = detail;
  state.modalSelection = selection;
  state.modalVariantCombo = selection.selection_supported
    ? { ...selection.selected_options }
    : {};

  function rerender() {
    renderDesktopProductDetail(detail, state.modalSelection);
  }

  container.innerHTML = '';
  const root = document.createElement('div');
  root.dataset.pdc5Root = '1';
  container.appendChild(root);

  if (selection.selection_supported) {
    (detail.option_axes || []).forEach((axis) => {
      root.appendChild(renderAxis(detail, selection, axis, rerender));
    });
  }
  renderSelectionMessage(root, selection);

  renderIdentity(detail);
  renderPriceAndReference(detail, selection);
  renderStock(selection);
  renderActions(detail, selection);
  renderDeliveryOptions(detail);
  renderSubtotal(detail, selection);
  renderMedia(detail, selection, forceMedia);
  ensureQtyObserver();
}

export function refreshDesktopProductSubtotal() {
  if (!state.modalProductDetail || !state.modalSelection) return;
  renderSubtotal(state.modalProductDetail, state.modalSelection);
}

export function clearDesktopProductDetailState() {
  if (_qtyObserver) _qtyObserver.disconnect();
  _qtyObserver = null;
  _qtyObservedEl = null;
}
