'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 *
 * Régression UX SKU : un choix indisponible doit rester explicable, et un CTA
 * bloqué par une sélection incomplète doit guider l'utilisateur au lieu de
 * devenir un bouton natif disabled silencieux.
 */

jest.mock('../../js/b-cart.js', () => ({
  addToCart: jest.fn(),
  quickAdd: jest.fn(),
  quickRemove: jest.fn(),
  setQty: jest.fn(),
}));

const { state, dom } = require('../../js/b-store.js');
const { addToCart } = require('../../js/b-cart.js');
const { OPTION_STATE } = require('../../js/view-models/modal-selection-model.js');
const {
  _syncModalQtyUI,
  setupModalCart,
  _modalCartTestApi,
} = require('../../js/b-modal-cart.js');

const {
  reconcileVariantAvailabilityUI,
  reconcilePurchaseIntentButtons,
  signalMissingVariantSelection,
} = _modalCartTestApi;

function installDom() {
  document.body.innerHTML = `
    <div id="k-modal">
      <div id="k-modal-selection-message" hidden></div>
      <section data-axis-key="Capacite">
        <button type="button" data-option-value="Standard" data-option-state="AVAILABLE">Standard</button>
        <button type="button" data-option-value="Grande" data-option-state="OUT_OF_STOCK">Grande</button>
      </section>
      <div class="k-modal-actions">
        <button id="k-qty-minus" type="button">−</button>
        <span id="k-qty-val">1</span>
        <button id="k-qty-plus" type="button">+</button>
        <button id="k-add-cart-btn" type="button">Ajouter</button>
        <button id="k-buy-now-btn" type="button">Acheter</button>
      </div>
    </div>`;

  dom.modalOverlay = document.body;
  dom.modal = document.getElementById('k-modal');
  dom.modalQtyVal = document.getElementById('k-qty-val');
  dom.addCartBtn = document.getElementById('k-add-cart-btn');
  dom.qtyMinus = document.getElementById('k-qty-minus');
  dom.qtyPlus = document.getElementById('k-qty-plus');
}

function setIncompleteSku() {
  state.modalProduct = { id: 42 };
  state.modalProductDetail = {
    inventory_model: 'SKU',
    option_axes: [
      {
        key: 'Capacite',
        display_name: 'Capacité',
        values: [{ value: 'Standard' }, { value: 'Grande' }],
      },
    ],
    sellable_units: [
      {
        sku_id: 'sku-standard',
        option_values: { Capacite: 'Standard' },
        stock_status: 'AVAILABLE',
      },
      {
        sku_id: 'sku-grande',
        option_values: { Capacite: 'Grande' },
        stock_status: 'OUT_OF_STOCK',
      },
    ],
  };
  state.modalSelection = {
    selected_sku_id: null,
    selected_options: {},
    selection_message: null,
  };
  state.cart = [];
}

describe('guided SKU selection UX', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    installDom();
    setIncompleteSku();
  });

  test('projette disponibilité sans rendre les variantes silencieusement disabled', () => {
    const standard = document.querySelector('[data-option-value="Standard"]');
    const grande = document.querySelector('[data-option-value="Grande"]');

    reconcileVariantAvailabilityUI();

    expect(standard.getAttribute('aria-disabled')).toBeNull();
    expect(standard.classList.contains('k-vp--out')).toBe(false);

    expect(grande.disabled).toBe(false);
    expect(grande.getAttribute('aria-disabled')).toBe('true');
    expect(grande.classList.contains('k-vp--out')).toBe(true);
    expect(grande.dataset.optionUnavailableReason).toBe('Rupture de stock');
  });

  test('SKU incomplet : Ajouter et Acheter restent interceptables mais aria-disabled', () => {
    const buyNow = document.getElementById('k-buy-now-btn');
    dom.addCartBtn.disabled = true;
    buyNow.disabled = true;

    reconcilePurchaseIntentButtons(false, 'SKU');

    [dom.addCartBtn, buyNow].forEach((button) => {
      expect(button.disabled).toBe(false);
      expect(button.getAttribute('aria-disabled')).toBe('true');
      expect(button.classList.contains('k-purchase-intent--blocked')).toBe(true);
      expect(button.getAttribute('aria-describedby')).toBe('k-modal-selection-message');
    });
  });

  test('tentative achat sans variante affiche le guidage et focus la première valeur disponible', () => {
    signalMissingVariantSelection();

    const message = document.getElementById('k-modal-selection-message');
    const standard = document.querySelector('[data-option-value="Standard"]');
    expect(message.hidden).toBe(false);
    expect(message.textContent).toBe('Choisissez « Capacité » pour continuer.');
    expect(document.activeElement).toBe(standard);
  });

  test('clic Acheter sans SKU ne mute rien et déclenche le guidage', () => {
    setupModalCart();
    _syncModalQtyUI();

    document.getElementById('k-buy-now-btn').click();

    expect(addToCart).not.toHaveBeenCalled();
    expect(document.getElementById('k-modal-selection-message').textContent)
      .toBe('Choisissez « Capacité » pour continuer.');
  });

  test('clic option en rupture conserve le clic explicable et expose la raison', async () => {
    setupModalCart();
    _syncModalQtyUI();

    const grande = document.querySelector('[data-option-value="Grande"]');
    expect(grande.dataset.optionState).toBe(OPTION_STATE.OUT_OF_STOCK);
    grande.click();
    await Promise.resolve();

    expect(document.getElementById('k-modal-selection-message').hidden).toBe(false);
    expect(document.getElementById('k-modal-selection-message').textContent)
      .toContain('rupture de stock');
    expect(addToCart).not.toHaveBeenCalled();
  });
});
