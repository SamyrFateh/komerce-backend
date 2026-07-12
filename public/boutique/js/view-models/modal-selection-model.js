/**
 * @komerce-arch
 * @role          product-modal-selection-model
 * @domain        catalog
 * @layer         view-model
 * @criticality   high
 * @inputs        public_product_detail_v1, modal_option_selection
 * @outputs       modal_selection_state
 * @depends       none
 * @used-by       future b-modal-core.js, future b-modal-product.js, future b-modal-desktop-enhancers.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_PRODUCT_DETAIL_CONTRACT.md, docs/boutique/BOUTIQUE_MODAL_ARCHITECTURE.md
 * @impact-areas  product-modal, product-selection, sku, media-carousel
 * @version       2026-07
 */

'use strict';

export const OPTION_STATE = Object.freeze({
  AVAILABLE: 'AVAILABLE',
  OUT_OF_STOCK: 'OUT_OF_STOCK',
  INCOMPATIBLE: 'INCOMPATIBLE',
});

function selectionError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function axisKeys(detail) {
  return (detail.option_axes || []).map((axis) => axis.key);
}

function unitMatches(unit, options) {
  return Object.entries(options).every(([key, value]) => unit.option_values[key] === value);
}

function optionStateFor(detail, priorOptions, axisKey, value) {
  const candidates = detail.sellable_units.filter((unit) =>
    unit.option_values[axisKey] === value && unitMatches(unit, priorOptions)
  );

  if (candidates.length === 0) return OPTION_STATE.INCOMPATIBLE;
  if (candidates.some((unit) => unit.stock_status === 'AVAILABLE')) return OPTION_STATE.AVAILABLE;
  return OPTION_STATE.OUT_OF_STOCK;
}

function buildOptionStates(detail, selectedOptions) {
  const states = {};
  const priorOptions = {};

  for (const axis of detail.option_axes) {
    states[axis.key] = axis.values.map((option) => ({
      value: option.value,
      state: optionStateFor(detail, priorOptions, axis.key, option.value),
    }));

    if (Object.prototype.hasOwnProperty.call(selectedOptions, axis.key)) {
      priorOptions[axis.key] = selectedOptions[axis.key];
    }
  }

  return states;
}

function resolveSelectedSku(detail, selectedOptions) {
  const keys = axisKeys(detail);
  if (!keys.every((key) => Object.prototype.hasOwnProperty.call(selectedOptions, key))) return null;

  const match = detail.sellable_units.find((unit) =>
    keys.every((key) => unit.option_values[key] === selectedOptions[key])
  );

  return match && match.stock_status === 'AVAILABLE' ? match : null;
}

function mediaMatchesSelection(media, selectedOptions) {
  const entries = Object.entries(media.option_values || {});
  return entries.length > 0
    && entries.every(([key, value]) => selectedOptions[key] === value);
}

function deriveSelectedMedia(detail, selectedOptions, selectedSku) {
  if (selectedSku && selectedSku.media_ids.length > 0) {
    const ids = new Set(selectedSku.media_ids);
    return detail.media.filter((media) => ids.has(media.id));
  }

  const specific = detail.media.filter((media) => mediaMatchesSelection(media, selectedOptions));
  if (specific.length > 0) return specific;

  const global = detail.media.filter((media) => Object.keys(media.option_values || {}).length === 0);
  return global.length > 0 ? global : detail.media.slice();
}

function deriveSkuState(detail, selectedOptions, selectionMessage = null) {
  const selectedSku = resolveSelectedSku(detail, selectedOptions);
  return {
    inventory_model: detail.inventory_model,
    selection_supported: true,
    selected_options: { ...selectedOptions },
    selected_sku_id: selectedSku ? selectedSku.sku_id : null,
    selected_media: deriveSelectedMedia(detail, selectedOptions, selectedSku),
    option_states: buildOptionStates(detail, selectedOptions),
    selection_message: selectionMessage,
  };
}

function deriveLegacyState(detail) {
  const mediaList = (detail && detail.media) || [];
  const global = mediaList.filter((media) => Object.keys(media.option_values || {}).length === 0);
  return {
    inventory_model: (detail && detail.inventory_model) || null,
    selection_supported: false,
    selected_options: {},
    selected_sku_id: null,
    selected_media: global.length > 0 ? global : mediaList.slice(),
    option_states: {},
    selection_message: null,
  };
}

function unavailableMessage(detail, state, axisKey, value, optionState) {
  const axisIndex = detail.option_axes.findIndex((axis) => axis.key === axisKey);
  const contextValues = detail.option_axes
    .slice(0, axisIndex)
    .map((axis) => state.selected_options[axis.key])
    .filter(Boolean);
  const context = contextValues.length > 0 ? ` pour ${contextValues.join(' / ')}` : '';
  const reason = optionState === OPTION_STATE.OUT_OF_STOCK
    ? 'rupture de stock'
    : 'combinaison non proposée';
  return `${value} indisponible${context} — ${reason}`;
}

export function createModalSelection(detail) {
  if (!detail || detail.inventory_model !== 'SKU') return deriveLegacyState(detail);
  return deriveSkuState(detail, {});
}

export function selectModalOption(detail, state, axisKey, value) {
  if (!state.selection_supported) return state;

  const axisIndex = detail.option_axes.findIndex((axis) => axis.key === axisKey);
  if (axisIndex < 0) {
    throw selectionError('MODAL_SELECTION_AXIS_UNKNOWN', `Axe produit inconnu : ${axisKey}`);
  }

  const option = state.option_states[axisKey].find((entry) => entry.value === value);
  if (!option) {
    throw selectionError('MODAL_SELECTION_VALUE_UNKNOWN', `Valeur inconnue pour ${axisKey} : ${value}`);
  }

  if (option.state !== OPTION_STATE.AVAILABLE) {
    return {
      ...state,
      selection_message: unavailableMessage(detail, state, axisKey, value, option.state),
    };
  }

  const selectedOptions = {};
  detail.option_axes.forEach((axis, index) => {
    if (index < axisIndex && Object.prototype.hasOwnProperty.call(state.selected_options, axis.key)) {
      selectedOptions[axis.key] = state.selected_options[axis.key];
    }
    if (index === axisIndex) selectedOptions[axis.key] = value;
  });

  return deriveSkuState(detail, selectedOptions);
}
