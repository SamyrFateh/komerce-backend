'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

jest.mock('../../db', () => ({
  query: jest.fn(),
  pool: { end: jest.fn() },
}));
jest.mock('../../services/order-checkout-service', () => ({
  runOrderCheckout: jest.fn(),
}));

const {
  parseArgs,
  runGoldenCustomerCheckout,
} = require('../../scripts/allegro-golden-customer-checkout-proof');

describe('allegro-golden-customer-checkout-proof', () => {
  test('parseArgs exige produit, client et relais explicites', () => {
    expect(() => parseArgs([])).toThrow(/Usage/);
    expect(parseArgs([
      '--product-id=p1', '--user-id=u1', '--relais-id=r1', '--quantity=2',
    ])).toEqual({ productId: 'p1', userId: 'u1', relaisId: 'r1', quantity: 2 });
  });

  test('compose le vrai checkout cash puis prouve le SKU Allegro exact persisté', async () => {
    const query = jest.fn()
      .mockResolvedValueOnce({ rows: [{
        id: 'u1', full_name: 'ITest client', phone: '+2690000000', email: 'itest@test.local', role: 'client',
      }] })
      .mockResolvedValueOnce({ rows: [{
        order_id: 'o1', reference: 'K-1', status: 'pending', payment_status: 'pending',
        payment_mode: 'cash_relais', cash_ref_code: 'CASH-1', relais_id: 'r1', total_kmf: 12000,
        order_item_id: 'oi1', product_id: 'p1', sku_id: 'sku1', quantity: 1, price_kmf: 12000,
        fulfillment_source: 'IMPORT', supplier_sku: 'allegro-sandbox:7782182471',
        supplier_unit_ref: '7782182471', supplier_order_identity: {
          provider: 'allegro', version: 1, payload: { environment: 'sandbox', offer_id: '7782182471' },
        },
      }] });
    const checkout = jest.fn().mockResolvedValue({ ok: true, order: { id: 'o1' } });

    const report = await runGoldenCustomerCheckout({
      productId: 'p1', userId: 'u1', relaisId: 'r1', query, checkout,
    });

    expect(checkout).toHaveBeenCalledWith({
      user: expect.objectContaining({ id: 'u1', role: 'client' }),
      body: expect.objectContaining({
        items: [{ product_id: 'p1', quantity: 1, variant_combo: null }],
        relais_id: 'r1', payment_mode: 'cash_relais', pickup_code_recipient: 'buyer',
      }),
    });
    expect(report).toMatchObject({
      stage: 'CUSTOMER_CHECKOUT', status: 'PASS', payment_confirmed: false, purchasing_triggered: false,
      order: { order_id: 'o1', sku_id: 'sku1', supplier_unit_ref: '7782182471' },
    });
  });

  test('échoue fermé si le checkout métier refuse', async () => {
    const query = jest.fn().mockResolvedValueOnce({ rows: [{
      id: 'u1', full_name: 'ITest client', phone: '+2690000000', role: 'client',
    }] });
    const checkout = jest.fn().mockResolvedValue({
      ok: false, status: 409, body: { code: 'market_price_not_purchasable' },
    });

    await expect(runGoldenCustomerCheckout({
      productId: 'p1', userId: 'u1', relaisId: 'r1', query, checkout,
    })).rejects.toThrow('ALLEGRO_GOLDEN_CUSTOMER_CHECKOUT_BLOCKED_market_price_not_purchasable');
  });

  test('échoue fermé si la ligne persistée ne porte pas une SOI Allegro Sandbox', async () => {
    const query = jest.fn()
      .mockResolvedValueOnce({ rows: [{ id: 'u1', full_name: 'ITest client', phone: '+2690000000', role: 'client' }] })
      .mockResolvedValueOnce({ rows: [{
        product_id: 'p1', sku_id: 'sku1', payment_mode: 'cash_relais', payment_status: 'pending',
        supplier_order_identity: { provider: 'cj', version: 1, payload: {} },
      }] });
    const checkout = jest.fn().mockResolvedValue({ ok: true, order: { id: 'o1' } });

    await expect(runGoldenCustomerCheckout({
      productId: 'p1', userId: 'u1', relaisId: 'r1', query, checkout,
    })).rejects.toThrow('ALLEGRO_GOLDEN_SOLD_SKU_PROVIDER_MISMATCH');
  });
});
