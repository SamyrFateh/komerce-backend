/** @test-kind unit @test-runner jest @test-requires none */
'use strict';

jest.mock('../../db', () => ({ getClient: jest.fn() }));
jest.mock('../../utils/rules', () => ({ getRule: jest.fn().mockResolvedValue(100) }));
jest.mock('../../services/catalog-public-view', () => ({
  publicCatalogVisibilitySql: jest.fn(() => 'TRUE'),
}));
jest.mock('../../services/order-checkout-item-resolution', () => ({
  resolveCheckoutItems: jest.fn(),
}));
jest.mock('../../services/market-local-price-resolution-service', () => ({
  applyActiveMarketPricesToCheckoutItems: jest.fn(),
}));
jest.mock('../../services/transport-pricing', () => ({
  resolveOrderItemTransportRail: jest.fn(),
}));

const db = require('../../db');
const { resolveCheckoutItems } = require('../../services/order-checkout-item-resolution');
const { applyActiveMarketPricesToCheckoutItems } = require('../../services/market-local-price-resolution-service');
const { quotePublicCart, validatePublicCartQuote } = require('../../services/public-cart-quote-service');

const ID = '11111111-1111-4111-8111-111111111111';
const payload = () => ({
  market_code: 'KM',
  items: [{ product_id: ID, quantity: 1, variant_combo: { cj_size: 'S' } }],
});

let client;
beforeEach(() => {
  jest.clearAllMocks();
  client = {
    query: jest.fn(async (sql) => {
      if (sql.includes('FROM markets')) return {
        rows: [{ id: 'market-1', code: 'KM', currency: 'KMF', lifecycle_status: 'ACTIVE' }],
      };
      if (sql.includes('SELECT p.id FROM products')) return { rows: [{ id: ID }] };
      return { rows: [] };
    }),
    release: jest.fn(),
  };
  db.getClient.mockResolvedValue(client);
  resolveCheckoutItems.mockImplementation(async ({ items }) => {
    items[0]._effective_unit_price_kmf = 7990;
    return { ok: true, productMap: { [ID]: { id: ID, name: 'Robe' } } };
  });
  applyActiveMarketPricesToCheckoutItems.mockResolvedValue({ total_kmf: 7990 });
});

describe('devis anonyme — prix et vente contrôlés côté serveur', () => {
  test('panier et marché obligatoires, jamais de prix fourni par le navigateur', () => {
    expect(() => validatePublicCartQuote({ ...payload(), market_code: '' })).toThrow(/marché/);
    expect(() => validatePublicCartQuote({ ...payload(), items: [] })).toThrow();
    expect(() => validatePublicCartQuote({ ...payload(), items: [{ product_id: ID, quantity: -1 }] })).toThrow();
    expect(validatePublicCartQuote({ ...payload(), total_kmf: 999999 }).items[0]).not.toHaveProperty('total_kmf');
  });

  test('devis 7 990 KMF = commande sans supplément maritime, transaction annulée', async () => {
    const result = await quotePublicCart(payload());
    expect(result).toMatchObject({
      market_code: 'KM', items_total_kmf: 7990, total_kmf: 7990,
      transport_price_kmf: 0, discount_kmf: 0,
    });
    expect(result.items[0].variant_combo).toEqual({ cj_size: 'S' });
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.query).not.toHaveBeenCalledWith('COMMIT');
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  test('refuse une modification de prix entre aperçu et génération PDF', async () => {
    await expect(quotePublicCart({ ...payload(), expected_total_kmf: 8016 }))
      .rejects.toMatchObject({ code: 'quote_price_changed', status: 409 });
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  test('refuse un produit non exposé sans retomber sur un prix local du client', async () => {
    client.query.mockImplementation(async sql => {
      if (sql.includes('FROM markets')) return { rows: [{ id: 'market-1', lifecycle_status: 'ACTIVE' }] };
      if (sql.includes('SELECT p.id FROM products')) return { rows: [] };
      return { rows: [] };
    });
    await expect(quotePublicCart(payload())).rejects.toMatchObject({ code: 'quote_product_unavailable', status: 409 });
    expect(resolveCheckoutItems).not.toHaveBeenCalled();
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
  });
});
