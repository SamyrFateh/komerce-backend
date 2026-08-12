'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
jest.mock('../../js/b-utils.js', () => ({
  fmtPrice: (value) => (value == null ? '' : `${value} KMF`),
}));

jest.mock('../../js/b-bus.js', () => ({ bus: { emit: jest.fn() } }));
jest.mock('../../js/b-cart.js', () => ({ addToCart: jest.fn() }));

const { state } = require('../../js/b-store.js');
const { bus } = require('../../js/b-bus.js');
const { addToCart } = require('../../js/b-cart.js');
const {
  wireBuyNowButton,
  getCurrentPrice,
  computeSubtotal,
  renderSubtotalInto,
  renderPaymentModes,
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

  test('bloque toute mutation si le SKU manque ou si les variantes restent legacy', () => {
    const button = document.createElement('button');
    state.modalProduct = { id: 1, has_variants: true };
    state.modalProductDetail = {
      inventory_model: 'SKU',
      sellable_units: [{ sku_id: 'sku-1', stock_status: 'AVAILABLE' }],
    };
    state.modalSelection = { selected_sku_id: null };
    wireBuyNowButton(button);
    button.click();

    state.modalProductDetail = {
      inventory_model: 'LEGACY_VARIANTS',
      option_axes: [{ key: 'Pointure' }],
    };
    button.click();

    expect(addToCart).not.toHaveBeenCalled();
  });

  test('Buy Now ajoute le snapshot SKU puis ouvre immédiatement le checkout sur cette seule ligne', () => {
    installSkuState();
    state.modalQty = 1;
    const button = document.createElement('button');
    const initialLabel = document.createElement('span');
    initialLabel.textContent = 'Acheter';
    button.appendChild(initialLabel);

    const checkoutLine = { id: 1, sku_id: 'sku-1', qty: 1, price: 9000 };
    addToCart.mockImplementation(() => {
      expect(button.disabled).toBe(true);
      expect(button.textContent).toContain('Ouverture du paiement');
      return checkoutLine;
    });

    wireBuyNowButton(button);
    button.click();

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

    expect(button.disabled).toBe(false);
    expect(button.classList.contains('buy-confirmed')).toBe(false);
    expect(button.textContent).toBe('Acheter');
    expect(bus.emit).toHaveBeenCalledWith('checkout:open', {
      lines: [checkoutLine],
      context: { origin: 'BUY_NOW' },
    });
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

  // P1-B — doctrine finale (2026-08) : la liste partagée n'est PAS un mode
  // de paiement. Seuls stripe/cash subsistent (group/pot supprimés).
  test('rend les deux modes (Carte, Livraison) avec Carte actif par défaut et remplace un contenu existant', () => {
    const previous = document.createElement('span');
    previous.textContent = 'ancien';
    el.appendChild(previous);
    renderPaymentModes(el);
    expect(el.textContent).not.toContain('ancien');
    expect(el.querySelectorAll('.k-buybox-payment-tab')).toHaveLength(2);
    expect(Object.keys(PAYMENT_MODES)).toEqual(['stripe', 'cash']);
    expect(el.querySelector('.k-buybox-payment-tab.is-active').dataset.pay).toBe('stripe');
    expect(el.querySelector('.k-buybox-payment-detail').dataset.payDetail).toBe('stripe');
  });

  test('mode actif invalide retombe sur Carte', () => {
    renderPaymentModes(el, { activeMode: 'unknown' });
    expect(el.querySelector('.k-buybox-payment-tab.is-active').dataset.pay).toBe('stripe');
  });

  test('P1-B — un mode "group" ou "pot" ne peut plus être sélectionné : absents du sélecteur', () => {
    renderPaymentModes(el, { activeMode: 'group' });
    // activeMode invalide (mode retiré) -> retombe sur stripe, comme tout
    // autre mode inconnu.
    expect(el.querySelector('.k-buybox-payment-tab.is-active').dataset.pay).toBe('stripe');
    expect(el.querySelector('[data-pay="group"]')).toBeNull();
    expect(el.querySelector('[data-pay="pot"]')).toBeNull();
    expect(el.textContent).not.toContain('Panier partagé');
    expect(el.textContent).not.toContain('Cagnotte');
  });

  test('respecte le mode actif, bascule les aria et notifie le changement', () => {
    const onModeChange = jest.fn();
    renderPaymentModes(el, { activeMode: 'cash', onModeChange });
    expect(el.querySelector('[data-pay="cash"]').getAttribute('aria-selected')).toBe('true');

    el.querySelector('[data-pay="stripe"]').click();

    expect(onModeChange).toHaveBeenCalledWith('stripe');
    expect(el.querySelector('[data-pay="cash"]').getAttribute('aria-selected')).toBe('false');
    expect(el.querySelector('[data-pay="stripe"]').getAttribute('aria-selected')).toBe('true');
    expect(el.querySelector('.k-buybox-payment-detail').dataset.payDetail).toBe('stripe');
  });

  test('changement sans callback reste fonctionnel', () => {
    renderPaymentModes(el);
    expect(() => el.querySelector('[data-pay="cash"]').click()).not.toThrow();
    expect(el.querySelector('.k-buybox-payment-detail').dataset.payDetail).toBe('cash');
  });

  test('buildPaymentDetail utilise le fallback Carte pour une clé inconnue', () => {
    const detail = _buyboxSharedTestApi.buildPaymentDetail('unknown');
    expect(detail.dataset.payDetail).toBe('unknown');
    expect(detail.querySelector('.k-buybox-payment-copy strong').textContent).toBe('Carte bancaire');
  });
});
