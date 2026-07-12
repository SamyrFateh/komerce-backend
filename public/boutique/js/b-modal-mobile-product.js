/**
 * @komerce-arch
 * @role          mobile-product-modal-renderer
 * @domain        catalog
 * @layer         ui-renderer
 * @criticality   high
 * @inputs        product_detail_v1, modal_selection_state
 * @outputs       mobile_product_modal_dom
 * @depends       b-store.js, b-utils.js, view-models/modal-selection-model.js
 * @used-by       b-modal-core.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_PRODUCT_DETAIL_CONTRACT.md, docs/boutique/BOUTIQUE_MODAL_ARCHITECTURE.md
 * @impact-areas  product-modal, mobile, sku-selection, delivery-options, media-carousel
 * @version       2026-07
 */

'use strict';

import { state, dom } from './b-store.js';
import { fmtPrice, optimizeImgUrl } from './b-utils.js';
import {
  OPTION_STATE,
  selectModalOption,
} from './view-models/modal-selection-model.js';
import { buildCarouselSlides, goToSlide } from './b-modal-product.js';

function isPhotoAxis(axis) {
  return /couleur|color|coloris|teinte/i.test(axis.key || axis.display_name || '');
}

function activeUnit(detail, selection) {
  return (detail.sellable_units || []).find((unit) => unit.sku_id === selection.selected_sku_id) || null;
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
    : detail.media;

  buildCarouselSlides({
    name: detail.product.name,
    images: media.map((item) => item.url),
    image_url: media[0]?.url || '',
  });
  goToSlide(0);

  const wrap = dom.modal?.querySelector('.k-modal-img-wrap');
  if (!wrap) return;
  let editorial = wrap.querySelector('.k-modal-media-editorial');
  if (!editorial) {
    editorial = document.createElement('div');
    editorial.className = 'k-modal-media-editorial';
    wrap.appendChild(editorial);
  }

  const sceneCount = media.filter((item) => item.role === 'SCENE').length;
  editorial.textContent = media.length > 1
    ? `${sceneCount > 0 ? 'Mises en scène' : 'Photos produit'} · swipe ↔`
    : '';
  editorial.hidden = !editorial.textContent;
}

function renderPriceAndReference(detail, selection) {
  const unit = activeUnit(detail, selection);
  const price = unit?.price_kmf ?? detail.pricing.price_kmf;
  dom.modalPrice.textContent = fmtPrice(price);

  if (dom.modalOldPrice) {
    if (detail.pricing.old_price_kmf != null) {
      dom.modalOldPrice.textContent = fmtPrice(detail.pricing.old_price_kmf);
      dom.modalOldPrice.classList.remove('u-hidden');
    } else {
      dom.modalOldPrice.textContent = '';
      dom.modalOldPrice.classList.add('u-hidden');
    }
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
    dom.modalStock.className = 'k-modal-stock';
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
  dom.modalStock.className = 'k-modal-stock k-modal-stock--choose';
}

function actionNeedsSku(detail) {
  return detail.inventory_model === 'SKU';
}

function renderActions(detail, selection) {
  const enabled = !actionNeedsSku(detail) || Boolean(selection.selected_sku_id);
  [dom.addCartBtn, document.getElementById('k-buy-now-btn')].forEach((button) => {
    if (!button) return;
    button.disabled = !enabled;
    button.classList.toggle('k-modal-action--selection-required', !enabled);
    if (!enabled) button.setAttribute('aria-describedby', 'k-modal-selection-message');
    else button.removeAttribute('aria-describedby');
  });
}

function optionMessage(state) {
  if (state === OPTION_STATE.OUT_OF_STOCK) return 'Rupture';
  if (state === OPTION_STATE.INCOMPATIBLE) return 'Non proposé';
  return '';
}

function renderSelectionMessage(container, selection) {
  let message = container.querySelector('#k-modal-selection-message');
  if (!message) {
    message = document.createElement('p');
    message.id = 'k-modal-selection-message';
    message.className = 'k-modal-selection-message';
    container.appendChild(message);
  }
  message.textContent = selection.selection_message || '';
  message.hidden = !selection.selection_message;
}

function renderAxis(detail, selection, axis, onSelectionChanged) {
  const group = document.createElement('section');
  group.className = 'k-vg k-vg--detail';
  group.dataset.axisKey = axis.key;

  const label = document.createElement('div');
  label.className = 'k-vg-label';
  const selected = selection.selected_options[axis.key] || '';
  label.innerHTML =
    `<span class="k-vg-label-type"></span>` +
    `<span class="k-vg-label-sep">·</span>` +
    `<span class="k-vg-label-val"></span>`;
  label.querySelector('.k-vg-label-type').textContent = axis.display_name;
  label.querySelector('.k-vg-label-val').textContent = selected || 'Choisir';
  group.appendChild(label);

  const photo = isPhotoAxis(axis);
  const wrap = document.createElement('div');
  wrap.className = photo ? 'k-vg-skus' : 'k-vg-sizes';

  const states = new Map((selection.option_states[axis.key] || []).map((entry) => [entry.value, entry.state]));

  axis.values.forEach((option) => {
    const stateValue = states.get(option.value) || OPTION_STATE.INCOMPATIBLE;
    const active = selected === option.value;
    const unavailable = stateValue !== OPTION_STATE.AVAILABLE;
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.optionValue = option.value;
    button.dataset.optionState = stateValue;
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
    button.setAttribute('aria-label', `${axis.display_name} ${option.value}${unavailable ? ` — ${optionMessage(stateValue)}` : ''}`);

    if (photo && option.thumbnail_url) {
      button.className = `k-sku${active ? ' k-sku--active' : ''}${unavailable ? ' k-sku--unavailable' : ''}`;
      const image = document.createElement('img');
      image.src = optimizeImgUrl(option.thumbnail_url, 140);
      image.alt = '';
      image.loading = 'lazy';
      const name = document.createElement('span');
      name.className = 'k-sku-name';
      name.textContent = option.value;
      button.appendChild(image);
      button.appendChild(name);
    } else {
      button.className = `k-vp${active ? ' k-vp--active' : ''}${unavailable ? ' k-vp--unavailable' : ''}`;
      button.textContent = option.value;
    }

    if (unavailable) {
      const reason = document.createElement('span');
      reason.className = 'k-option-reason';
      reason.textContent = optionMessage(stateValue);
      button.appendChild(reason);
    }

    // Intentionnel : une option indisponible reste cliquable pour que le reducer
    // fournisse une raison contextuelle. disabled ferait perdre cette explication.
    button.addEventListener('click', () => {
      state.modalSelection = selectModalOption(detail, state.modalSelection, axis.key, option.value);
      onSelectionChanged();
    });

    wrap.appendChild(button);
  });

  group.appendChild(wrap);
  return group;
}

function renderDeliveryOptions(detail, container) {
  let delivery = container.querySelector('[data-product-delivery-options]');
  if (delivery) delivery.remove();
  delivery = document.createElement('section');
  delivery.className = 'k-modal-delivery-options-mobile';
  delivery.dataset.productDeliveryOptions = '1';

  const title = document.createElement('div');
  title.className = 'k-modal-delivery-options-title';
  title.textContent = 'Livraison';
  delivery.appendChild(title);

  if (!detail.delivery_options.length) {
    const empty = document.createElement('p');
    empty.className = 'k-modal-delivery-option-empty';
    empty.textContent = 'Option de livraison communiquée à la commande.';
    delivery.appendChild(empty);
  } else {
    detail.delivery_options.forEach((option) => {
      const row = document.createElement('div');
      row.className = `k-modal-delivery-option${option.available ? '' : ' is-unavailable'}`;
      const label = document.createElement('span');
      label.className = 'k-modal-delivery-option-label';
      label.textContent = option.label;
      const meta = document.createElement('span');
      meta.className = 'k-modal-delivery-option-meta';
      const parts = [];
      if (option.price_kmf != null) parts.push(fmtPrice(option.price_kmf));
      if (option.eta_label) parts.push(option.eta_label);
      if (!option.available && option.unavailable_reason) parts.push(option.unavailable_reason);
      meta.textContent = parts.join(' · ');
      row.appendChild(label);
      if (meta.textContent) row.appendChild(meta);
      delivery.appendChild(row);
    });
  }

  container.appendChild(delivery);
}

/**
 * Rend la composition mobile PDC-4 depuis le contrat détail et l'état de
 * sélection unique. Cette fonction peut être rappelée après chaque sélection.
 */
export function renderMobileProductDetail(detail, selection, { forceMedia = false } = {}) {
  const container = dom.modalVariants || document.getElementById('k-modal-variants');
  if (!container || !window.matchMedia('(max-width: 899px)').matches) return;

  state.modalProductDetail = detail;
  state.modalSelection = selection;

  function rerender() {
    renderMobileProductDetail(detail, state.modalSelection);
  }

  container.innerHTML = '';

  if (selection.selection_supported) {
    detail.option_axes.forEach((axis) => {
      container.appendChild(renderAxis(detail, selection, axis, rerender));
    });
  }

  renderSelectionMessage(container, selection);
  renderDeliveryOptions(detail, container);
  renderPriceAndReference(detail, selection);
  renderStock(selection);
  renderActions(detail, selection);
  renderMedia(detail, selection, forceMedia);
}

export function clearMobileProductDetailState() {
  state.modalProductDetail = null;
  state.modalSelection = null;
  state.modalMediaSignature = '';
}
