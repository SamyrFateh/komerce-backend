/** @test-kind unit @test-runner jest @test-requires none */
'use strict';

jest.mock('../../js/b-store.js', () => ({
  state: { cart: [], cartSurface: 'personal' },
}));
jest.mock('../../js/b-bus.js', () => ({
  bus: { on: jest.fn(), off: jest.fn() },
}));
jest.mock('../../js/b-utils.js', () => ({
  apiGet: jest.fn(),
  apiPost: jest.fn(),
  fmt: jest.fn((amount) => Number(amount).toLocaleString('fr-FR') + ' KMF'),
}));
jest.mock('../../js/b-identity.js', () => ({
  requireIdentity: jest.fn(),
}));
const { cartQuotePayload, renderQuotePreview } = require('../../js/b-cart-quote.js');

describe('Fais-moi un devis — panier personnel', () => {
  const cart = [
    { product: { id: 'p-1' }, qty: 2, variant_combo: { Taille: 'S' }, requested_transport_rail: 'SEA_STANDARD' },
    { product: { id: 'p-1' }, qty: 1, variant_combo: { Taille: 'M' }, requested_transport_rail: 'AIR_EXPRESS' },
  ];

  test('envoie deux lignes SKU distinctes au serveur, jamais de prix inventé', () => {
    expect(cartQuotePayload(cart, 'relay-km')).toEqual({
      relais_id: 'relay-km', payment_mode: 'cash_relais',
      items: [
        { product_id: 'p-1', quantity: 2, confection_type: 'aucun',
          variant_combo: { Taille: 'S' }, requested_transport_rail: 'SEA_STANDARD' },
        { product_id: 'p-1', quantity: 1, confection_type: 'aucun',
          variant_combo: { Taille: 'M' }, requested_transport_rail: 'AIR_EXPRESS' },
      ],
    });
  });

  test('interdit devis sans relais ou avec panier vide/quantité invalide', () => {
    expect(cartQuotePayload(cart, null)).toBeNull();
    expect(cartQuotePayload([], 'relay-km')).toBeNull();
    expect(cartQuotePayload([{ product: { id: 'p-1' }, qty: 0 }], 'relay-km')).toBeNull();
  });

  test('présente uniquement les prix du devis serveur et échappe le nom produit', () => {
    const root = document.createElement('div');
    renderQuotePreview(root, {
      relais_name: 'Moroni',
      total_kmf: 19000, items_total_kmf: 18000,
      transport_price_kmf: 1000, discount_kmf: 0,
      items: [{ product_name: '<script>bad()</script>', quantity: 1,
        variant_combo: { Taille: 'S' }, unit_price_kmf: 18000, line_total_kmf: 18000 }],
    });
    expect(root.textContent).toContain('<script>bad()</script>');
    expect(root.querySelector('script')).toBeNull();
    expect(root.textContent).toContain('19');
    expect(root.textContent).toContain('Livraison au relais');
  });
});
