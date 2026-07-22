'use strict';

jest.mock('../../js/b-utils.js', () => ({
  fmtPrice: (value) => (value == null ? '' : `${value} KMF`),
}));

jest.mock('../../js/b-modal.js', () => ({ closeModal: jest.fn() }));
jest.mock('../../js/b-cart.js', () => ({ addToCart: jest.fn(), openCart: jest.fn() }));
jest.mock('../../js/b-share-cart.js', () => ({ startShareFlow: jest.fn() }));

const { state } = require('../../js/b-store.js');
const { closeModal } = require('../../js/b-modal.js');
const { addToCart } = require('../../js/b-cart.js');
const { startShareFlow } = require('../../js/b-share-cart.js');
const {
  getCurrentPrice,
  computeSubtotal,
  renderSubtotalInto,
  renderPaymentModes,
  startGroupCartFlow,
  PAYMENT_MODES,
} = require('../../js/b-modal-buybox-shared.js');

function detailWith(unitPrice, productPrice) {
  return {
    pricing: { price_kmf: productPrice },
    sellable_units: unitPrice == null ? [] : [{ sku_id: 'sku-1', sku: 'SKU-1', price_kmf: unitPrice }],
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  state.modalProduct = null;
  state.modalProductDetail = null;
  state.modalSelection = null;
  state.modalQty = 1;
});

describe('b-modal-buybox-shared — prix & sous-total', () => {
  test('getCurrentPrice privilégie le prix de l unité SKU résolue', () => {
    expect(getCurrentPrice(detailWith(9000, 5000), { selected_sku_id: 'sku-1' })).toBe(9000);
  });

  test('getCurrentPrice retombe sur le prix produit du contrat', () => {
    expect(getCurrentPrice(detailWith(9000, 5000), { selected_sku_id: null })).toBe(5000);
  });

  test('getCurrentPrice ne lit jamais un prix legacy hors contrat', () => {
    expect(getCurrentPrice(detailWith(null, null), { selected_sku_id: null })).toBeNull();
  });

  test('computeSubtotal borne la quantité à 1', () => {
    const detail = detailWith(2000, 2000);
    const selection = { selected_sku_id: 'sku-1' };
    expect(computeSubtotal(detail, selection, 3)).toBe(6000);
    expect(computeSubtotal(detail, selection, 0)).toBe(2000);
    expect(computeSubtotal(detail, selection, -5)).toBe(2000);
  });

  test('computeSubtotal retourne null sans prix', () => {
    expect(computeSubtotal(detailWith(null, null), { selected_sku_id: null }, 2)).toBeNull();
  });

  test('renderSubtotalInto peuple le texte et le vide sans prix', () => {
    const el = document.createElement('div');
    renderSubtotalInto(el, detailWith(1000, 1000), { selected_sku_id: 'sku-1' }, 2);
    expect(el.textContent).toBe('Sous-total : 2000 KMF');

    renderSubtotalInto(el, detailWith(null, null), { selected_sku_id: null }, 2);
    expect(el.textContent).toBe('');
  });
});

describe('b-modal-buybox-shared — modes de paiement', () => {
  let el;

  beforeEach(() => {
    el = document.createElement('div');
  });

  test('rend les quatre modes avec Carte actif par défaut', () => {
    renderPaymentModes(el);
    expect(el.querySelectorAll('.k-buybox-payment-tab')).toHaveLength(Object.keys(PAYMENT_MODES).length);
    expect(el.querySelector('.k-buybox-payment-tab.is-active').dataset.pay).toBe('stripe');
    expect(el.querySelector('.k-buybox-payment-detail').dataset.payDetail).toBe('stripe');
  });

  test('respecte le mode actif et notifie le changement', () => {
    const onModeChange = jest.fn();
    renderPaymentModes(el, { activeMode: 'cash', onModeChange });
    el.querySelector('[data-pay="pot"]').click();

    expect(onModeChange).toHaveBeenCalledWith('pot');
    expect(el.querySelector('.k-buybox-payment-detail').dataset.payDetail).toBe('pot');
    expect(el.querySelector('.k-buybox-payment-badge').textContent).toBe('Collectif');
  });

  test('group appelle onGroupSelect sans modifier l onglet actif', () => {
    const onModeChange = jest.fn();
    const onGroupSelect = jest.fn();
    renderPaymentModes(el, { onModeChange, onGroupSelect });
    el.querySelector('[data-pay="group"]').click();

    expect(onGroupSelect).toHaveBeenCalled();
    expect(onModeChange).not.toHaveBeenCalled();
    expect(el.querySelector('.k-buybox-payment-tab.is-active').dataset.pay).toBe('stripe');
  });

  test('startGroupCartFlow legacy ajoute le produit inchangé', () => {
    jest.useFakeTimers();
    const product = { id: 1 };
    startGroupCartFlow(product, 2, null);

    expect(addToCart).toHaveBeenCalledWith(product, 2, null);
    expect(closeModal).toHaveBeenCalled();
    jest.advanceTimersByTime(250);
    expect(startShareFlow).toHaveBeenCalled();
    jest.useRealTimers();
  });

  test('startGroupCartFlow SKU ajoute le snapshot au prix sélectionné', () => {
    jest.useFakeTimers();
    const product = { id: 1, price_kmf: 5000, image_url: '/base.jpg' };
    state.modalProduct = product;
    state.modalProductDetail = {
      inventory_model: 'SKU',
      pricing: { price_kmf: 5500 },
      sellable_units: [{ sku_id: 'sku-1', sku: 'SKU-1', price_kmf: 9000 }],
    };
    state.modalSelection = {
      selected_sku_id: 'sku-1',
      selected_media: [{ url: '/sku-1.jpg' }],
    };

    startGroupCartFlow(product, 2, null);

    expect(addToCart).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 1,
        price_kmf: 9000,
        sku_id: 'sku-1',
        image_url: '/sku-1.jpg',
      }),
      2,
      null
    );
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  test('startGroupCartFlow est un no-op sans produit', () => {
    startGroupCartFlow(null, 2, null);
    expect(addToCart).not.toHaveBeenCalled();
    expect(closeModal).not.toHaveBeenCalled();
  });
});
