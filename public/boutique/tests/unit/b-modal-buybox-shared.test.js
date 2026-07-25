'use strict';

jest.mock('../../js/b-utils.js', () => ({
  fmtPrice: (value) => (value == null ? '' : `${value} KMF`),
}));

jest.mock('../../js/b-modal.js', () => ({ closeModal: jest.fn() }));
jest.mock('../../js/b-cart.js', () => ({ addToCart: jest.fn(), openCart: jest.fn() }));
jest.mock('../../js/b-share-cart.js', () => ({ startShareFlow: jest.fn() }));

const { state } = require('../../js/b-store.js');
const { closeModal } = require('../../js/b-modal.js');
const { addToCart, openCart } = require('../../js/b-cart.js');
const { startShareFlow } = require('../../js/b-share-cart.js');
const {
  wireBuyNowButton,
  getCurrentPrice,
  computeSubtotal,
  renderSubtotalInto,
  renderPaymentModes,
  startGroupCartFlow,
  PAYMENT_MODES,
  _buyboxSharedTestApi,
} = require('../../js/b-modal-buybox-shared.js');

function detailWith(unitPrice, productPrice) {
  return {
    pricing: { price_kmf: productPrice },
    sellable_units: unitPrice == null
      ? []
      : [{ sku_id: 'sku-1', sku: 'SKU-1', price_kmf: unitPrice }],
  };
}

function installSkuState() {
  state.modalProduct = { id: 1, name: 'Thermos', price_kmf: 5000, image_url: '/base.jpg' };
  state.modalProductDetail = {
    inventory_model: 'SKU',
    pricing: { price_kmf: 5500 },
    sellable_units: [{ sku_id: 'sku-1', sku: 'SKU-1', price_kmf: 9000 }],
  };
  state.modalSelection = {
    selected_sku_id: 'sku-1',
    selected_media: [{ url: '/sku-1.jpg' }],
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useRealTimers();
  state.modalProduct = null;
  state.modalProductDetail = null;
  state.modalSelection = null;
  state.modalQty = 1;
});

afterEach(() => {
  jest.useRealTimers();
});

describe('b-modal-buybox-shared — achat immédiat', () => {
  test('bouton absent ou clic sans produit : no-op', () => {
    expect(() => wireBuyNowButton(null)).not.toThrow();
    const button = document.createElement('button');
    wireBuyNowButton(button);
    button.click();
    expect(addToCart).not.toHaveBeenCalled();
  });

  test('Buy Now ajoute le snapshot SKU puis restaure le bouton et ouvre le panier', () => {
    jest.useFakeTimers();
    installSkuState();
    state.modalQty = 1;
    const button = document.createElement('button');
    const initialLabel = document.createElement('span');
    initialLabel.textContent = 'Acheter';
    button.appendChild(initialLabel);

    wireBuyNowButton(button);
    button.click();

    expect(button.disabled).toBe(true);
    expect(button.classList.contains('buy-confirmed')).toBe(true);
    expect(button.textContent).toContain('Ajouté au panier');
    expect(addToCart).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 1,
        sku_id: 'sku-1',
        price_kmf: 9000,
        image_url: '/sku-1.jpg',
      }),
      1,
      button,
      { requested_transport_rail: null }
    );

    jest.advanceTimersByTime(1200);
    expect(button.disabled).toBe(false);
    expect(button.classList.contains('buy-confirmed')).toBe(false);
    expect(button.textContent).toBe('Acheter');
    expect(closeModal).toHaveBeenCalledTimes(1);
    expect(openCart).not.toHaveBeenCalled();

    jest.advanceTimersByTime(400);
    expect(openCart).toHaveBeenCalledTimes(1);
  });

  test('currentCartProduct accepte le produit explicite et le produit modal par défaut', () => {
    installSkuState();
    expect(_buyboxSharedTestApi.currentCartProduct()).toMatchObject({ sku_id: 'sku-1', price_kmf: 9000 });
    expect(
      _buyboxSharedTestApi.currentCartProduct({ id: 2, price_kmf: 1 })
    ).toMatchObject({ id: 2, sku_id: 'sku-1', price_kmf: 9000 });
  });
});

describe('b-modal-buybox-shared — prix & sous-total', () => {
  test('getCurrentPrice privilégie le SKU puis le prix produit du contrat', () => {
    expect(getCurrentPrice(detailWith(9000, 5000), { selected_sku_id: 'sku-1' })).toBe(9000);
    expect(getCurrentPrice(detailWith(9000, 5000), { selected_sku_id: null })).toBe(5000);
    expect(getCurrentPrice(undefined, undefined)).toBeNull();
    expect(getCurrentPrice(detailWith(null, null), { selected_sku_id: null })).toBeNull();
  });

  test('computeSubtotal traite quantité valide, chaîne, zéro, négatif et prix absent', () => {
    const detail = detailWith(2000, 2000);
    const selection = { selected_sku_id: 'sku-1' };
    expect(computeSubtotal(detail, selection, 3)).toBe(6000);
    expect(computeSubtotal(detail, selection, '2')).toBe(4000);
    expect(computeSubtotal(detail, selection, 0)).toBe(2000);
    expect(computeSubtotal(detail, selection, -5)).toBe(2000);
    expect(computeSubtotal(detailWith(null, null), { selected_sku_id: null }, 2)).toBeNull();
  });

  test('renderSubtotalInto garde DOM absent, peuple le texte et le vide sans prix', () => {
    expect(() => renderSubtotalInto(null, detailWith(1, 1), { selected_sku_id: 'sku-1' }, 1)).not.toThrow();

    const el = document.createElement('div');
    renderSubtotalInto(el, detailWith(1000, 1000), { selected_sku_id: 'sku-1' }, 2);
    expect(el.textContent).toBe('Sous-total : 2000 KMF');
    expect(el.querySelector('strong').textContent).toBe('2000 KMF');

    renderSubtotalInto(el, detailWith(null, null), { selected_sku_id: null }, 2);
    expect(el.textContent).toBe('');
  });
});

describe('b-modal-buybox-shared — modes de paiement', () => {
  let el;

  beforeEach(() => {
    el = document.createElement('div');
  });

  test('élément absent : no-op', () => {
    expect(() => renderPaymentModes(null)).not.toThrow();
  });

  test('rend les quatre modes avec Carte actif par défaut et remplace un contenu existant', () => {
    const previous = document.createElement('span');
    previous.textContent = 'ancien';
    el.appendChild(previous);
    renderPaymentModes(el);
    expect(el.textContent).not.toContain('ancien');
    expect(el.querySelectorAll('.k-buybox-payment-tab')).toHaveLength(Object.keys(PAYMENT_MODES).length);
    expect(el.querySelector('.k-buybox-payment-tab.is-active').dataset.pay).toBe('stripe');
    expect(el.querySelector('.k-buybox-payment-detail').dataset.payDetail).toBe('stripe');
  });

  test('mode actif invalide retombe sur Carte', () => {
    renderPaymentModes(el, { activeMode: 'unknown' });
    expect(el.querySelector('.k-buybox-payment-tab.is-active').dataset.pay).toBe('stripe');
  });

  test('respecte le mode actif, bascule les aria et notifie le changement', () => {
    const onModeChange = jest.fn();
    renderPaymentModes(el, { activeMode: 'cash', onModeChange });
    expect(el.querySelector('[data-pay="cash"]').getAttribute('aria-selected')).toBe('true');

    el.querySelector('[data-pay="pot"]').click();

    expect(onModeChange).toHaveBeenCalledWith('pot');
    expect(el.querySelector('[data-pay="cash"]').getAttribute('aria-selected')).toBe('false');
    expect(el.querySelector('[data-pay="pot"]').getAttribute('aria-selected')).toBe('true');
    expect(el.querySelector('.k-buybox-payment-detail').dataset.payDetail).toBe('pot');
    expect(el.querySelector('.k-buybox-payment-badge').textContent).toBe('Collectif');
  });

  test('changement sans callback reste fonctionnel', () => {
    renderPaymentModes(el);
    expect(() => el.querySelector('[data-pay="cash"]').click()).not.toThrow();
    expect(el.querySelector('.k-buybox-payment-detail').dataset.payDetail).toBe('cash');
  });

  test('group appelle le callback sans modifier l actif', () => {
    const onModeChange = jest.fn();
    const onGroupSelect = jest.fn();
    renderPaymentModes(el, { onModeChange, onGroupSelect });
    const groupTab = el.querySelector('[data-pay="group"]');
    groupTab.click();

    expect(onGroupSelect).toHaveBeenCalledWith(groupTab);
    expect(onModeChange).not.toHaveBeenCalled();
    expect(el.querySelector('.k-buybox-payment-tab.is-active').dataset.pay).toBe('stripe');
  });

  test('group sans callback reste un no-op sûr', () => {
    renderPaymentModes(el);
    expect(() => el.querySelector('[data-pay="group"]').click()).not.toThrow();
    expect(el.querySelector('.k-buybox-payment-tab.is-active').dataset.pay).toBe('stripe');
  });

  test('buildPaymentDetail utilise le fallback Carte pour une clé inconnue', () => {
    const detail = _buyboxSharedTestApi.buildPaymentDetail('unknown');
    expect(detail.dataset.payDetail).toBe('unknown');
    expect(detail.querySelector('.k-buybox-payment-copy strong').textContent).toBe('Carte bancaire');
  });
});

describe('b-modal-buybox-shared — panier partagé', () => {
  test('legacy ajoute le produit inchangé et borne la quantité vide à 1', () => {
    jest.useFakeTimers();
    const product = { id: 1 };
    startGroupCartFlow(product, 0, null);

    expect(addToCart).toHaveBeenCalledWith(product, 1, null, { requested_transport_rail: null });
    expect(closeModal).toHaveBeenCalled();
    jest.advanceTimersByTime(250);
    expect(startShareFlow).toHaveBeenCalled();
  });

  test('SKU ajoute le snapshot au prix sélectionné', () => {
    jest.useFakeTimers();
    installSkuState();

    startGroupCartFlow(state.modalProduct, 2, null);

    expect(addToCart).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 1,
        price_kmf: 9000,
        sku_id: 'sku-1',
        image_url: '/sku-1.jpg',
      }),
      2,
      null,
      { requested_transport_rail: null }
    );
    jest.advanceTimersByTime(250);
    expect(startShareFlow).toHaveBeenCalled();
  });

  test('sans produit : no-op', () => {
    startGroupCartFlow(null, 2, null);
    expect(addToCart).not.toHaveBeenCalled();
    expect(closeModal).not.toHaveBeenCalled();
  });
});
