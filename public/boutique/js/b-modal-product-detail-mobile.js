/**
 * @komerce-arch
 * @role          product-modal-mobile-detail
 * @domain        catalog
 * @layer         ui-component
 * @criticality   high
 * @inputs        modal_open_event, public_product_detail_v1, modal_selection_state
 * @outputs       mobile_product_detail_render, option_selection_events
 * @depends       b-bus.js, b-store.js, b-utils.js, b-modal-product.js, b-modal-image-ux.js, b-modal-cart.js, view-models/modal-selection-model.js
 * @used-by       b-modal.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_PRODUCT_DETAIL_CONTRACT.md, docs/boutique/BOUTIQUE_MODAL_ARCHITECTURE.md
 * @impact-areas  product-modal, mobile-product-detail, sku-selection, media-carousel, delivery-display
 * @version       2026-07
 */

'use strict';

/**
 * PDC-4 — Adaptateur mobile Product Detail Contract v1 → modal.
 *
 * Le module est volontairement branché sur `modal:opened` plutôt que d'ajouter
 * une seconde orchestration d'ouverture. `b-modal-core.js` garde le lifecycle ;
 * ici on remplace uniquement les vérités produit du chemin mobile SKU lorsque
 * le contrat détail est disponible.
 *
 * LEGACY_VARIANTS reste sur le renderer historique jusqu'à PDC-6/PDC-7.
 */

import { bus } from './b-bus.js';
import { state, dom } from './b-store.js';
import { fmtPrice } from './b-utils.js';
import {
  buildCarouselSlides,
  openSizeGuide,
} from './b-modal-product.js';
import { setupImageUX } from './b-modal-image-ux.js';
import { _syncModalQtyUI } from './b-modal-cart.js';
import {
  OPTION_STATE,
  createModalSelection,
  selectModalOption,
} from './view-models/modal-selection-model.js';

let _requestVersion = 0;
let _variantObserver = null;

function isMobileViewport() {
  return window.innerWidth < 900;
}

function disconnectVariantObserver() {
  if (_variantObserver) _variantObserver.disconnect();
  _variantObserver = null;
}

function currentSelectedUnit(detail, selection) {
  if (!selection.selected_sku_id) return null;
  return detail.sellable_units.find((unit) => unit.sku_id === selection.selected_sku_id) || null;
}

function displayPrice(detail, selection) {
  const unit = currentSelectedUnit(detail, selection);
  return unit?.price_kmf ?? detail.pricing.price_kmf;
}

function optionState(selection, axisKey, value) {
  return selection.option_states[axisKey]
    .find((entry) => entry.value === value)?.state || OPTION_STATE.INCOMPATIBLE;
}

function isVisualAxis(axis) {
  const key = axis.key.toLowerCase();
  return key.includes('couleur') || key.includes('color');
}

function isSizeAxis(axis) {
  const key = axis.key.toLowerCase();
  return key.includes('taille') || key.includes('size') || key.includes('pointure');
}

function buildOptionButton(axis, option, stateValue, selected, onSelect) {
  const visual = isVisualAxis(axis) && option.thumbnail_url;
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.axis = axis.key;
  button.dataset.value = option.value;
  button.dataset.optionState = stateValue;
  button.setAttribute('aria-pressed', selected ? 'true' : 'false');

  if (visual) {
    button.className = 'k-sku';
    const image = document.createElement('img');
    image.src = option.thumbnail_url;
    image.alt = option.value;
    image.loading = 'lazy';
    button.appendChild(image);

    const label = document.createElement('span');
    label.className = 'k-sku-label';
    label.textContent = option.value;
    button.appendChild(label);
  } else {
    button.className = 'k-vp';
    button.textContent = option.value;
  }

  if (selected) button.classList.add(visual ? 'k-sku--active' : 'k-vp--active');
  if (stateValue !== OPTION_STATE.AVAILABLE) {
    button.classList.add(visual ? 'k-sku--out' : 'k-vp--out');
    // L'option reste cliquable : le reducer produit la raison contextuelle.
    button.setAttribute('aria-disabled', 'true');
  }

  button.addEventListener('click', () => onSelect(axis.key, option.value));
  return button;
}

function renderSelectionAxes(detail, selection, onSelect) {
  const container = dom.modalVariants || document.getElementById('k-modal-variants');
  if (!container) return;

  container.innerHTML = '';
  const root = document.createElement('div');
  root.dataset.pdcSkuSelection = '1';

  detail.option_axes.forEach((axis) => {
    if (!axis.values.length) return;

    const group = document.createElement('div');
    group.className = 'k-variant-group';
    group.dataset.variantType = axis.key;

    const labelRow = document.createElement('div');
    labelRow.className = 'k-vg-label';

    const label = document.createElement('span');
    label.textContent = axis.display_name;
    labelRow.appendChild(label);

    const selectedValue = selection.selected_options[axis.key] || '';
    const selectedLabel = document.createElement('span');
    selectedLabel.className = 'k-vg-label-val';
    selectedLabel.textContent = selectedValue;
    labelRow.appendChild(selectedLabel);

    if (isSizeAxis(axis)) {
      const guide = document.createElement('button');
      guide.type = 'button';
      guide.className = 'k-vg-size-guide';
      guide.dataset.sizeType = axis.key.toLowerCase().includes('pointure') ? 'shoes' : 'clothes';
      guide.textContent = 'Guide des tailles';
      guide.addEventListener('click', () => openSizeGuide(guide.dataset.sizeType));
      labelRow.appendChild(guide);
    }

    group.appendChild(labelRow);

    const options = document.createElement('div');
    options.className = 'k-vg-options ' + (isVisualAxis(axis) ? 'k-vg-colors' : 'k-vg-sizes');

    axis.values.forEach((option) => {
      const stateValue = optionState(selection, axis.key, option.value);
      options.appendChild(buildOptionButton(
        axis,
        option,
        stateValue,
        selectedValue === option.value,
        onSelect
      ));
    });

    group.appendChild(options);
    root.appendChild(group);
  });

  container.appendChild(root);
}

function renderStockState(detail, selection) {
  if (!dom.modalStock) return;

  if (selection.selection_message) {
    dom.modalStock.textContent = selection.selection_message;
    dom.modalStock.className = 'k-modal-stock k-modal-stock--out';
    return;
  }

  const unit = currentSelectedUnit(detail, selection);
  if (unit) {
    if (unit.available_quantity <= 10) {
      dom.modalStock.textContent = '🔥 Plus que ' + unit.available_quantity + ' en stock';
      dom.modalStock.className = 'k-modal-stock k-modal-stock--low';
    } else {
      dom.modalStock.textContent = '✓ Disponible';
      dom.modalStock.className = 'k-modal-stock k-modal-stock--ok';
    }
    return;
  }

  if (detail.option_axes.length > 0) {
    const remaining = detail.option_axes
      .filter((axis) => !Object.prototype.hasOwnProperty.call(selection.selected_options, axis.key))
      .map((axis) => axis.display_name);
    dom.modalStock.textContent = remaining.length
      ? 'Choisissez ' + remaining.join(' puis ')
      : 'Combinaison indisponible';
    dom.modalStock.className = 'k-modal-stock';
    return;
  }

  const defaultUnit = detail.sellable_units[0] || null;
  if (!defaultUnit || defaultUnit.stock_status !== 'AVAILABLE') {
    dom.modalStock.textContent = '✗ Rupture';
    dom.modalStock.className = 'k-modal-stock k-modal-stock--out';
  }
}

function optionDeliveryText(option) {
  const parts = [];
  if (option.price_kmf !== null) parts.push(fmtPrice(option.price_kmf));
  if (option.eta_label) parts.push(option.eta_label);
  if (!option.available && option.unavailable_reason) parts.push(option.unavailable_reason);
  return parts.join(' · ');
}

function renderDeliveryOptions(deliveryOptions) {
  if (!dom.modal) return;

  dom.modal.querySelectorAll(
    '[data-mobile-reassurance], [data-mobile-delivery], [data-mobile-trust], [data-pdc-delivery]'
  ).forEach((element) => element.remove());

  if (!deliveryOptions.length) return;

  const scroll = dom.modal.querySelector('.k-modal-scroll');
  const actions = dom.modal.querySelector('.k-modal-actions');
  const parent = scroll || dom.modal;
  const panel = document.createElement('div');
  panel.className = 'k-modal-reassurance';
  panel.dataset.pdcDelivery = '1';

  const first = deliveryOptions.find((option) => option.available) || deliveryOptions[0];
  const summary = document.createElement('button');
  summary.type = 'button';
  summary.className = 'k-modal-reassurance-main';
  summary.setAttribute('aria-expanded', 'false');

  const icon = document.createElement('span');
  icon.className = 'k-modal-reassurance-icon';
  icon.textContent = '📦';
  summary.appendChild(icon);

  const text = document.createElement('span');
  text.className = 'k-modal-reassurance-text';
  const title = document.createElement('span');
  title.className = 'k-modal-reassurance-title';
  title.textContent = first.label;
  text.appendChild(title);

  const firstMeta = optionDeliveryText(first);
  if (firstMeta) {
    const meta = document.createElement('span');
    meta.className = 'k-modal-reassurance-delay';
    meta.textContent = ' · ' + firstMeta;
    text.appendChild(meta);
  }
  summary.appendChild(text);

  const chevron = document.createElement('span');
  chevron.className = 'k-modal-reassurance-chevron';
  chevron.textContent = '⌄';
  summary.appendChild(chevron);
  panel.appendChild(summary);

  const details = document.createElement('div');
  details.className = 'k-modal-reassurance-details';
  details.hidden = true;

  deliveryOptions.forEach((option) => {
    const row = document.createElement('div');
    row.className = 'k-modal-reassurance-item';

    const rowIcon = document.createElement('span');
    rowIcon.className = 'k-modal-reassurance-item-icon';
    rowIcon.textContent = option.available ? '🚚' : '○';
    row.appendChild(rowIcon);

    const rowBody = document.createElement('span');
    const strong = document.createElement('strong');
    strong.textContent = option.label;
    rowBody.appendChild(strong);

    const optionMeta = optionDeliveryText(option);
    if (optionMeta) {
      const small = document.createElement('small');
      small.textContent = optionMeta;
      rowBody.appendChild(small);
    }
    row.appendChild(rowBody);
    details.appendChild(row);
  });

  panel.appendChild(details);
  summary.addEventListener('click', () => {
    const open = summary.getAttribute('aria-expanded') === 'true';
    summary.setAttribute('aria-expanded', open ? 'false' : 'true');
    details.hidden = open;
    panel.classList.toggle('is-open', !open);
  });

  if (actions && actions.parentElement === parent) parent.insertBefore(panel, actions);
  else parent.appendChild(panel);
}

function renderTopbar(detail, selection) {
  if (!dom.modal) return;
  const topbarName = dom.modal.querySelector('.k-modal-topbar-name');
  const topbarPrice = dom.modal.querySelector('.k-modal-topbar-price');
  const topbarThumb = dom.modal.querySelector('.k-modal-topbar-thumb');

  if (topbarName) topbarName.textContent = detail.product.name;
  if (topbarPrice) {
    const price = displayPrice(detail, selection);
    topbarPrice.textContent = price === null ? '—' : fmtPrice(price);
  }
  if (topbarThumb && selection.selected_media[0]) {
    topbarThumb.src = selection.selected_media[0].url;
    topbarThumb.alt = detail.product.name;
  }
}

function renderIdentityAndPricing(detail, selection) {
  if (dom.modalName) dom.modalName.textContent = detail.product.name;
  if (dom.modalDesc) dom.modalDesc.textContent = detail.product.description || '';
  if (dom.modalSku) {
    if (detail.product.reference) {
      dom.modalSku.textContent = 'Réf. ' + detail.product.reference;
      dom.modalSku.hidden = false;
    } else {
      dom.modalSku.textContent = '';
      dom.modalSku.hidden = true;
    }
  }

  const price = displayPrice(detail, selection);
  if (dom.modalPrice) dom.modalPrice.textContent = price === null ? '—' : fmtPrice(price);

  if (dom.modalOldPrice) {
    if (detail.pricing.old_price_kmf !== null) {
      dom.modalOldPrice.textContent = fmtPrice(detail.pricing.old_price_kmf);
      dom.modalOldPrice.classList.remove('u-hidden');
    } else {
      dom.modalOldPrice.textContent = '';
      dom.modalOldPrice.classList.add('u-hidden');
    }
  }

  const promo = detail.pricing.promo_pct;
  if (dom.modalPromoBadge) {
    if (promo !== null && promo > 0) {
      dom.modalPromoBadge.textContent = '-' + promo + '%';
      dom.modalPromoBadge.classList.add('show');
      dom.modal?.classList.add('k-modal--has-promo');
    } else {
      dom.modalPromoBadge.classList.remove('show');
      dom.modal?.classList.remove('k-modal--has-promo');
    }
  }
}

function renderMedia(detail, selection) {
  const media = selection.selected_media;
  const urls = media.map((item) => item.url);
  buildCarouselSlides({
    id: detail.product.id,
    name: detail.product.name,
    images: urls,
    image_url: urls[0] || null,
  });

  requestAnimationFrame(() => setupImageUX());
}

function renderCurrentSelection(detail) {
  const selection = state.modalSelection;
  if (!selection) return;

  state.modalVariantCombo = { ...selection.selected_options };
  renderIdentityAndPricing(detail, selection);
  renderMedia(detail, selection);
  renderSelectionAxes(detail, selection, (axisKey, value) => {
    state.modalSelection = selectModalOption(detail, state.modalSelection, axisKey, value);
    renderCurrentSelection(detail);
    bus.emit('modal:selection-changed', state.modalSelection);
  });
  renderStockState(detail, selection);
  renderDeliveryOptions(detail.delivery_options);
  renderTopbar(detail, selection);
  _syncModalQtyUI();
}

function guardVariantsAgainstLegacyRenderer(detail) {
  const container = dom.modalVariants || document.getElementById('k-modal-variants');
  if (!container) return;

  disconnectVariantObserver();
  _variantObserver = new MutationObserver(() => {
    if (!state.modalProductDetail || state.modalProductDetail !== detail) return;
    if (container.querySelector('[data-pdc-sku-selection="1"]')) return;
    renderSelectionAxes(detail, state.modalSelection, (axisKey, value) => {
      state.modalSelection = selectModalOption(detail, state.modalSelection, axisKey, value);
      renderCurrentSelection(detail);
      bus.emit('modal:selection-changed', state.modalSelection);
    });
  });
  _variantObserver.observe(container, { childList: true });
}

async function activateMobileProductDetail(product) {
  const version = ++_requestVersion;
  state.modalProductDetail = null;
  state.modalSelection = null;
  disconnectVariantObserver();

  if (!isMobileViewport()) return;

  try {
    const response = await fetch('/api/products/' + product.id + '/detail', {
      credentials: 'include',
    });
    if (!response.ok) return;
    const detail = await response.json();

    if (version !== _requestVersion) return;
    if (!state.modalOpen || String(state.modalProduct?.id) !== String(product.id)) return;
    if (detail.inventory_model !== 'SKU') return;

    state.modalProductDetail = detail;
    state.modalSelection = createModalSelection(detail);
    renderCurrentSelection(detail);
    guardVariantsAgainstLegacyRenderer(detail);
    bus.emit('modal:product-detail-ready', {
      detail,
      selection: state.modalSelection,
    });
  } catch (_) {
    // Le chemin legacy déjà rendu reste visible si le contrat détail est indisponible.
  }
}

bus.on('modal:opened', activateMobileProductDetail);

bus.on('modal:closed', () => {
  _requestVersion++;
  disconnectVariantObserver();
  state.modalProductDetail = null;
  state.modalSelection = null;
});

export {
  activateMobileProductDetail,
  renderCurrentSelection,
  renderDeliveryOptions,
  renderSelectionAxes,
};
