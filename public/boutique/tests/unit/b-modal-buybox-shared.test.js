'use strict';

jest.mock('../../js/b-utils.js', () => ({
  fmtPrice: (value) => (value == null ? '' : `${value} KMF`),
}));

jest.mock('../../js/b-modal.js', () => ({ closeModal: jest.fn() }));
jest.mock('../../js/b-cart.js', () => ({ addToCart: jest.fn() }));
jest.mock('../../js/b-share-cart.js', () => ({ startShareFlow: jest.fn() }));

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
    sellable_units: unitPrice == null ? [] : [{ sku_id: 'sku-1', price_kmf: unitPrice }],
  };
}

describe('b-modal-buybox-shared — prix & sous-total (une seule logique)', () => {
  test('getCurrentPrice privilégie le prix de l’unité SKU résolue', () => {
    const detail = detailWith(9000, 5000);
    const selection = { selected_sku_id: 'sku-1' };
    expect(getCurrentPrice(detail, selection)).toBe(9000);
  });

  test('getCurrentPrice retombe sur le prix produit du contrat si aucun SKU résolu', () => {
    const detail = detailWith(9000, 5000);
    const selection = { selected_sku_id: null };
    expect(getCurrentPrice(detail, selection)).toBe(5000);
  });

  test('getCurrentPrice ne lit jamais un champ prix legacy hors du contrat', () => {
    const detail = detailWith(null, null);
    const selection = { selected_sku_id: null };
    expect(getCurrentPrice(detail, selection)).toBeNull();
  });

  test('computeSubtotal = prix courant × quantité, bornée à 1 minimum', () => {
    const detail = detailWith(2000, 2000);
    const selection = { selected_sku_id: 'sku-1' };
    expect(computeSubtotal(detail, selection, 3)).toBe(6000);
    expect(computeSubtotal(detail, selection, 0)).toBe(2000);
    expect(computeSubtotal(detail, selection, -5)).toBe(2000);
  });

  test('computeSubtotal retourne null si aucun prix n’est disponible', () => {
    const detail = detailWith(null, null);
    const selection = { selected_sku_id: null };
    expect(computeSubtotal(detail, selection, 2)).toBeNull();
  });

  test('renderSubtotalInto peuple le texte et vide si prix absent', () => {
    const el = document.createElement('div');
    const detail = detailWith(1000, 1000);
    const selection = { selected_sku_id: 'sku-1' };
    renderSubtotalInto(el, detail, selection, 2);
    expect(el.textContent).toBe('Sous-total : 2000 KMF');

    renderSubtotalInto(el, detailWith(null, null), { selected_sku_id: null }, 2);
    expect(el.textContent).toBe('');
  });
});

describe('b-modal-buybox-shared — modes de paiement (logique partagée mobile/desktop)', () => {
  let el;

  beforeEach(() => {
    jest.clearAllMocks();
    el = document.createElement('div');
  });

  test('rend les quatre modes avec Carte actif par défaut', () => {
    renderPaymentModes(el);
    const tabs = el.querySelectorAll('.k-buybox-payment-tab');
    expect(tabs).toHaveLength(Object.keys(PAYMENT_MODES).length);
    expect(el.querySelector('.k-buybox-payment-tab.is-active').dataset.pay).toBe('stripe');
    expect(el.querySelector('.k-buybox-payment-detail').dataset.payDetail).toBe('stripe');
  });

  test('respecte un mode actif fourni et notifie onModeChange au changement', () => {
    const onModeChange = jest.fn();
    renderPaymentModes(el, { activeMode: 'cash', onModeChange });
    expect(el.querySelector('.k-buybox-payment-tab.is-active').dataset.pay).toBe('cash');

    el.querySelector('[data-pay="pot"]').click();
    expect(onModeChange).toHaveBeenCalledWith('pot');
    expect(el.querySelector('.k-buybox-payment-detail').dataset.payDetail).toBe('pot');
    expect(el.querySelector('.k-buybox-payment-badge').textContent).toBe('Collectif');
  });

  test('le mode "group" ne bascule pas l’onglet actif et appelle onGroupSelect', () => {
    const onModeChange = jest.fn();
    const onGroupSelect = jest.fn();
    renderPaymentModes(el, { onModeChange, onGroupSelect });

    el.querySelector('[data-pay="group"]').click();
    expect(onGroupSelect).toHaveBeenCalled();
    expect(onModeChange).not.toHaveBeenCalled();
    expect(el.querySelector('.k-buybox-payment-tab.is-active').dataset.pay).toBe('stripe');
  });

  test('startGroupCartFlow ajoute au panier, ferme la modal puis ouvre le partage', () => {
    jest.useFakeTimers();
    const product = { id: 1 };
    startGroupCartFlow(product, 2, null);

    expect(addToCart).toHaveBeenCalledWith(product, 2, null);
    expect(closeModal).toHaveBeenCalled();
    jest.advanceTimersByTime(250);
    expect(startShareFlow).toHaveBeenCalled();
    jest.useRealTimers();
  });

  test('startGroupCartFlow est un no-op sans produit', () => {
    startGroupCartFlow(null, 2, null);
    expect(addToCart).not.toHaveBeenCalled();
    expect(closeModal).not.toHaveBeenCalled();
  });
});
