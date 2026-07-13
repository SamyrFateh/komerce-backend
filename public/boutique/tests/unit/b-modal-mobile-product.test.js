'use strict';

/**
 * tests/unit/b-modal-mobile-product.test.js
 *
 * Périmètre : renderActions() dans b-modal-mobile-product.js — gouvernance
 * PDC-6 des CTA (Ajouter/Acheter) ET du stepper modal (+/-) à partir du
 * contrat détail (inventory_model, selected_sku_id).
 *
 * Matrice couverte :
 *   - LEGACY_VARIANTS (non-SKU)              → CTA actif, stepper autorisé (historique)
 *   - SKU, selected_sku_id absent             → CTA verrouillé, stepper verrouillé
 *   - SKU, selected_sku_id résolu             → CTA actif, stepper TOUJOURS verrouillé
 *       (le stepper mute le panier "product-id first" — jamais valide en SKU)
 */

jest.mock('../../js/b-store.js', () => ({
  state: {},
  dom: {},
}));

jest.mock('../../js/b-utils.js', () => ({
  fmtPrice: jest.fn((n) => String(n) + ' KMF'),
  optimizeImgUrl: jest.fn((url) => url),
}));

jest.mock('../../js/view-models/modal-selection-model.js', () => ({
  OPTION_STATE: { AVAILABLE: 'AVAILABLE', OUT_OF_STOCK: 'OUT_OF_STOCK', INCOMPATIBLE: 'INCOMPATIBLE' },
  selectModalOption: jest.fn(),
}));

jest.mock('../../js/b-modal-product.js', () => ({
  buildCarouselSlides: jest.fn(),
  goToSlide: jest.fn(),
}));

jest.mock('../../js/b-modal-image-ux.js', () => ({
  setupImageUX: jest.fn(),
}));

const { dom } = require('../../js/b-store.js');
const { renderMobileProductDetail } = require('../../js/b-modal-mobile-product.js');

function installDom() {
  document.body.innerHTML =
    '<div id="k-modal">' +
      '<div id="k-modal-variants"></div>' +
      '<button id="k-add-cart-btn"></button>' +
      '<button id="k-buy-now-btn"></button>' +
      '<button id="k-qty-minus"></button>' +
      '<button id="k-qty-plus"></button>' +
    '</div>';
  window.matchMedia = jest.fn().mockReturnValue({ matches: true }); // mobile
  dom.modal = document.getElementById('k-modal');
  dom.modalVariants = document.getElementById('k-modal-variants');
  dom.addCartBtn = document.getElementById('k-add-cart-btn');
  dom.qtyMinus = document.getElementById('k-qty-minus');
  dom.qtyPlus = document.getElementById('k-qty-plus');
  dom.modalName = document.createElement('div');
  dom.modalDesc = document.createElement('div');
  dom.modalCat = document.createElement('div');
  dom.modalPromoBadge = document.createElement('div');
  dom.modalPrice = document.createElement('div');
  dom.modalOldPrice = document.createElement('div');
  dom.modalSku = document.createElement('div');
  dom.modalStock = document.createElement('div');
}

function transactionalControls() {
  return [
    document.getElementById('k-add-cart-btn'),
    document.getElementById('k-buy-now-btn'),
  ];
}

function stepperControls() {
  return [document.getElementById('k-qty-minus'), document.getElementById('k-qty-plus')];
}

function baseDetail(overrides) {
  return Object.assign({
    contract_version: '1',
    product: { id: 'p1', name: 'Robe', description: '', category: '' },
    pricing: { price_kmf: 5000, promo_pct: 0, old_price_kmf: null },
    media: [],
    option_axes: [],
    sellable_units: [],
    delivery_options: [],
  }, overrides);
}

function baseSelection(overrides) {
  return Object.assign({
    selection_supported: false,
    selected_options: {},
    selected_sku_id: null,
    selected_media: [],
    option_states: {},
    selection_message: null,
  }, overrides);
}

describe('b-modal-mobile-product — renderActions (CTA + stepper, PDC-6)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    installDom();
  });

  test('LEGACY_VARIANTS (non-SKU) : CTA actif et stepper autorisé (comportement historique)', () => {
    const detail = baseDetail({ inventory_model: 'LEGACY_VARIANTS' });
    const selection = baseSelection();

    renderMobileProductDetail(detail, selection);

    transactionalControls().forEach((btn) => expect(btn.disabled).toBe(false));
    stepperControls().forEach((btn) => expect(btn.disabled).toBe(false));
  });

  test('SKU sans selected_sku_id : CTA verrouillé ET stepper verrouillé', () => {
    const detail = baseDetail({ inventory_model: 'SKU' });
    const selection = baseSelection({ selected_sku_id: null });

    renderMobileProductDetail(detail, selection);

    transactionalControls().forEach((btn) => expect(btn.disabled).toBe(true));
    stepperControls().forEach((btn) => expect(btn.disabled).toBe(true));
  });

  test('SKU résolu (selected_sku_id présent) : CTA actif, mais stepper TOUJOURS verrouillé', () => {
    const detail = baseDetail({ inventory_model: 'SKU' });
    const selection = baseSelection({ selected_sku_id: 'sku-42' });

    renderMobileProductDetail(detail, selection);

    transactionalControls().forEach((btn) => expect(btn.disabled).toBe(false));
    // Preuve : aucune mutation panier "product-id first" possible même une
    // fois le SKU résolu — le stepper reste hors service en SKU.
    stepperControls().forEach((btn) => expect(btn.disabled).toBe(true));
  });
});
