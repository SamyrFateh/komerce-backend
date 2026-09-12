'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const {
  VERDICTS,
  assessSupplierFulfillment,
  evaluatePricePolicy,
} = require('../../services/suppliers/supplier-fulfillment-readiness');

function sku(overrides = {}) {
  return {
    id: 'sku-1',
    product_id: 'prod-1',
    source: 'SUPPLIER',
    supplier_sku: 'AE-RED-M',
    supplier_product_ref: '10000012345',
    supplier_unit_ref: '20000098765',
    supplier_order_identity: {
      provider: 'aliexpress',
      version: 1,
      payload: { sku_id: '20000098765', sku_attr: '14:10;5:361386' },
    },
    ...overrides,
  };
}

function adapter(overrides = {}) {
  return {
    provider: 'aliexpress',
    refresh: jest.fn(async () => ({
      available: true,
      stock_available: 8,
      unit_price: 3.2,
      currency: 'USD',
      adapter_context: {},
    })),
    preflight: jest.fn(async () => ({
      ready: true,
      shippable: true,
      freight_available: true,
    })),
    ...overrides,
  };
}

describe('Supplier Fulfillment Readiness', () => {
  test('bloque une identité persistée incomplète avant tout appel fournisseur', async () => {
    const a = adapter();
    const result = await assessSupplierFulfillment({
      sku: sku({ supplier_product_ref: null }),
      destination: { country_code: 'KM' },
      adapter: a,
    });
    expect(result.verdict).toBe(VERDICTS.BLOCKED_IDENTITY);
    expect(a.refresh).not.toHaveBeenCalled();
  });

  test('OUT_OF_STOCK si le stock live ne couvre pas la quantité', async () => {
    const a = adapter({ refresh: jest.fn(async () => ({ available: true, stock_available: 1, unit_price: 3.2, currency: 'USD' })) });
    const result = await assessSupplierFulfillment({ sku: sku(), quantity: 2, destination: { country_code: 'KM' }, adapter: a });
    expect(result.verdict).toBe(VERDICTS.OUT_OF_STOCK);
    expect(a.preflight).not.toHaveBeenCalled();
  });

  test('ne bloque jamais un drift prix sans politique explicite', async () => {
    const a = adapter({ refresh: jest.fn(async () => ({ available: true, stock_available: 8, unit_price: 99, currency: 'USD' })) });
    const result = await assessSupplierFulfillment({ sku: sku(), destination: { country_code: 'KM' }, adapter: a });
    expect(result.verdict).toBe(VERDICTS.READY);
    expect(result.price).toEqual({ evaluated: false, blocked: false });
  });

  test('PRICE_DRIFT_BLOCKED uniquement avec une tolérance explicite dépassée', async () => {
    const a = adapter({ refresh: jest.fn(async () => ({ available: true, stock_available: 8, unit_price: 12, currency: 'USD' })) });
    const result = await assessSupplierFulfillment({
      sku: sku(),
      destination: { country_code: 'KM' },
      adapter: a,
      pricePolicy: { reference_unit_price: 10, reference_currency: 'USD', max_increase_pct: 10 },
    });
    expect(result.verdict).toBe(VERDICTS.PRICE_DRIFT_BLOCKED);
    expect(result.price.delta_pct).toBe(20);
    expect(a.preflight).not.toHaveBeenCalled();
  });

  test('FREIGHT_UNAVAILABLE si le fournisseur répond sans option de fret', async () => {
    const a = adapter({ preflight: jest.fn(async () => ({ ready: false, shippable: null, freight_available: false })) });
    const result = await assessSupplierFulfillment({ sku: sku(), destination: { country_code: 'KM' }, adapter: a });
    expect(result.verdict).toBe(VERDICTS.FREIGHT_UNAVAILABLE);
  });

  test('NOT_SHIPPABLE si l’adapter fournit une preuve explicite', async () => {
    const a = adapter({ preflight: jest.fn(async () => ({ ready: false, shippable: false, freight_available: false })) });
    const result = await assessSupplierFulfillment({ sku: sku(), destination: { country_code: 'KM' }, adapter: a });
    expect(result.verdict).toBe(VERDICTS.NOT_SHIPPABLE);
  });

  test('SUPPLIER_UNAVAILABLE si le refresh fournisseur échoue', async () => {
    const a = adapter({ refresh: jest.fn(async () => { throw new Error('provider down'); }) });
    const result = await assessSupplierFulfillment({ sku: sku(), destination: { country_code: 'KM' }, adapter: a });
    expect(result.verdict).toBe(VERDICTS.SUPPLIER_UNAVAILABLE);
  });

  test('FULFILLMENT_READY seulement après refresh + preflight positifs', async () => {
    const a = adapter();
    const result = await assessSupplierFulfillment({ sku: sku(), quantity: 2, destination: { country_code: 'KM' }, adapter: a });
    expect(result.ready).toBe(true);
    expect(result.verdict).toBe(VERDICTS.READY);
    expect(result.identity).toEqual({
      supplier_product_ref: '10000012345',
      supplier_unit_ref: '20000098765',
      provider: 'aliexpress',
      version: 1,
    });
    expect(result.live.stock_available).toBe(8);
  });

  test('une devise différente est bloquée sans conversion silencieuse', () => {
    expect(evaluatePricePolicy(
      { reference_unit_price: 10, reference_currency: 'USD', max_increase_pct: 10 },
      { unit_price: 9, currency: 'AED' }
    )).toEqual(expect.objectContaining({ blocked: true, reason: 'CURRENCY_MISMATCH' }));
  });
});
