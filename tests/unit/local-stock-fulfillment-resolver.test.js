'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 *
 * Fulfillment mixte — Lot B.
 * Le verdict local/import appartient au checkout orders, mais la décision
 * d'engageabilité locale reste exclusivement dans local-stock-service.js.
 */

const fs = require('fs');
const path = require('path');

let mockQuery;
jest.mock('../../db', () => ({ query: (...args) => mockQuery(...args) }));

function loadService() {
  jest.resetModules();
  jest.mock('../../db', () => ({ query: (...args) => mockQuery(...args) }));
  return require('../../services/local-stock-service');
}

function fakeClient(...responses) {
  const query = jest.fn();
  for (const response of responses) query.mockResolvedValueOnce(response);
  return { query };
}

const MARKET_ID = '22222222-2222-2222-2222-222222222222';
const ORDER_ID = '55555555-5555-5555-5555-555555555555';
const P1 = '11111111-1111-1111-1111-111111111111';
const P2 = '99999999-9999-9999-9999-999999999999';
const LS1 = '44444444-4444-4444-4444-444444444444';

beforeEach(() => {
  mockQuery = jest.fn();
});

describe('resolveCheckoutFulfillmentSources', () => {
  it('exige le client de la transaction orders', async () => {
    const svc = loadService();
    await expect(svc.resolveCheckoutFulfillmentSources(null, {
      marketId: MARKET_ID,
      demands: [{ productId: P1, quantity: 1 }],
    })).rejects.toThrow(/client de transaction requis/);
  });

  it('sans marché, classe IMPORT sans interroger local_stock', async () => {
    const svc = loadService();
    const client = fakeClient();

    const result = await svc.resolveCheckoutFulfillmentSources(client, {
      marketId: null,
      demands: [{ productId: P1, quantity: 1 }],
    });

    expect(result).toEqual({ [P1]: 'IMPORT' });
    expect(client.query).not.toHaveBeenCalled();
  });

  it('sans ligne locale, classe IMPORT', async () => {
    const svc = loadService();
    const client = fakeClient({ rows: [] });

    const result = await svc.resolveCheckoutFulfillmentSources(client, {
      marketId: MARKET_ID,
      demands: [{ productId: P1, quantity: 2 }],
    });

    expect(result).toEqual({ [P1]: 'IMPORT' });
    expect(client.query.mock.calls[0][0]).toMatch(/FOR UPDATE/);
  });

  it('une ligne DISABLED reste IMPORT et ne lit pas les allocations', async () => {
    const svc = loadService();
    const client = fakeClient({
      rows: [{ id: LS1, qty_physical: 20, commercial_exposure: 'DISABLED' }],
    });

    const result = await svc.resolveCheckoutFulfillmentSources(client, {
      marketId: MARKET_ID,
      demands: [{ productId: P1, quantity: 2 }],
    });

    expect(result[P1]).toBe('IMPORT');
    expect(client.query).toHaveBeenCalledTimes(1);
  });

  it('une ligne ENABLED avec quantité suffisante devient LOCAL_STOCK sous verrou', async () => {
    const svc = loadService();
    const client = fakeClient(
      { rows: [{ id: LS1, qty_physical: 8, commercial_exposure: 'ENABLED' }] },
      { rows: [{ active: 3 }] },
    );

    const result = await svc.resolveCheckoutFulfillmentSources(client, {
      marketId: MARKET_ID,
      demands: [{ productId: P1, quantity: 5 }],
    });

    expect(result[P1]).toBe('LOCAL_STOCK');
    expect(client.query.mock.calls[0][0]).toMatch(/commercial_exposure/);
    expect(client.query.mock.calls[0][0]).toMatch(/FOR UPDATE/);
    expect(client.query.mock.calls[1][0]).toMatch(/local_stock_allocations/);
  });

  it('une lane locale exposée mais insuffisante échoue explicitement, sans fallback import', async () => {
    const svc = loadService();
    const client = fakeClient(
      { rows: [{ id: LS1, qty_physical: 5, commercial_exposure: 'ENABLED' }] },
      { rows: [{ active: 2 }] },
    );

    let caught;
    try {
      await svc.resolveCheckoutFulfillmentSources(client, {
        marketId: MARKET_ID,
        demands: [{ productId: P1, quantity: 4 }],
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeDefined();
    expect(caught.code).toBe('local_stock_insufficient');
    expect(caught.product_id).toBe(P1);
    expect(caught.available).toBe(3);
    expect(caught.requested).toBe(4);
  });

  it('agrège les quantités par produit et acquiert les locks dans un ordre déterministe', async () => {
    const svc = loadService();
    const client = fakeClient(
      // P1 est résolu avant P2 même si les demands arrivent P2 puis P1.
      { rows: [{ id: LS1, qty_physical: 6, commercial_exposure: 'ENABLED' }] },
      { rows: [{ active: 1 }] },
      { rows: [] },
    );

    const result = await svc.resolveCheckoutFulfillmentSources(client, {
      marketId: MARKET_ID,
      demands: [
        { productId: P2, quantity: 1 },
        { productId: P1, quantity: 2 },
        { productId: P1, quantity: 3 },
      ],
    });

    expect(result).toEqual({ [P1]: 'LOCAL_STOCK', [P2]: 'IMPORT' });
    expect(client.query.mock.calls[0][1]).toEqual([P1, MARKET_ID, 'KM_MAIN']);
    expect(client.query.mock.calls[2][1]).toEqual([P2, MARKET_ID, 'KM_MAIN']);
  });

  it('refuse une demande invalide avant toute lecture DB', async () => {
    const svc = loadService();
    const client = fakeClient();

    await expect(svc.resolveCheckoutFulfillmentSources(client, {
      marketId: MARKET_ID,
      demands: [{ productId: P1, quantity: 0 }],
    })).rejects.toThrow(/quantity doit être un entier positif/);
    expect(client.query).not.toHaveBeenCalled();
  });
});

describe('allocation cohérente avec commercial_exposure', () => {
  it('n’alloue jamais une ligne locale DISABLED', async () => {
    const svc = loadService();
    const client = fakeClient({
      rows: [{ id: LS1, qty_physical: 20, commercial_exposure: 'DISABLED' }],
    });

    const result = await svc.allocateForOrderItem(client, {
      productId: P1,
      marketId: MARKET_ID,
      orderId: ORDER_ID,
      quantity: 2,
    });

    expect(result).toBeNull();
    expect(client.query).toHaveBeenCalledTimes(1);
    expect(client.query.mock.calls[0][0]).toMatch(/commercial_exposure/);
  });
});

describe('wiring Feature First orders → local-stock', () => {
  it('résout LOCAL_STOCK/IMPORT avant le pricing transport et garde le verdict transitoire par ligne', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '../../services/order-checkout-service.js'),
      'utf8'
    );

    const resolverCall = source.indexOf('await resolveCheckoutFulfillmentSources');
    const pricingCall = source.indexOf('quoteTransportPriceForOrder({');

    expect(resolverCall).toBeGreaterThan(-1);
    expect(pricingCall).toBeGreaterThan(-1);
    expect(resolverCall).toBeLessThan(pricingCall);
    expect(source).toMatch(/item\._fulfillment_source/);
    expect(source).toMatch(/FULFILLMENT_SOURCE\.IMPORT/);
  });
});
