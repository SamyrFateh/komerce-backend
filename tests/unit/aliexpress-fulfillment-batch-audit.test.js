'use strict';

jest.mock('../../db', () => ({
  query: jest.fn(),
  pool: { end: jest.fn() },
}));

jest.mock('../../services/suppliers/supplier-fulfillment-readiness', () => ({
  VERDICT: {
    READY: 'FULFILLMENT_READY',
    PREFLIGHT_FAILED: 'PREFLIGHT_FAILED',
  },
  evaluateSupplierFulfillmentReadiness: jest.fn(),
}));

const audit = require('../../scripts/aliexpress-fulfillment-batch-audit');

function env(overrides = {}) {
  return {
    KOMERCE_ENV: 'staging',
    DATABASE_URL: 'postgres://test',
    KOMERCE_ALLOW_ALIEXPRESS_FULFILLMENT_AUDIT: '1',
    KOMERCE_ALIEXPRESS_COUNTRY_CODE: 'KM',
    KOMERCE_ALIEXPRESS_SEND_GOODS_COUNTRY_CODE: 'CN',
    KOMERCE_ALIEXPRESS_FULFILLMENT_AUDIT_DELAY_MS: '0',
    ...overrides,
  };
}

describe('aliexpress-fulfillment-batch-audit', () => {
  it('refuse tout runtime autre que staging', () => {
    expect(() => audit.guard(env({ KOMERCE_ENV: 'production' })))
      .toThrow(/réservé à KOMERCE_ENV=staging/);
    expect(() => audit.guard(env({ KOMERCE_ENV: 'unknown' })))
      .toThrow(/réservé à KOMERCE_ENV=staging/);
  });

  it('exige le flag humain explicite', () => {
    expect(() => audit.guard(env({ KOMERCE_ALLOW_ALIEXPRESS_FULFILLMENT_AUDIT: '0' })))
      .toThrow(`${audit.AUDIT_FLAG}=1 requis`);
  });

  it('exige un pays d’expédition explicite pour le fret AliExpress', () => {
    expect(() => audit.guard(env({ KOMERCE_ALIEXPRESS_SEND_GOODS_COUNTRY_CODE: '' })))
      .toThrow(/SEND_GOODS_COUNTRY_CODE requis/);
    expect(audit.sendGoodsCountry(env())).toBe('CN');
  });

  it('borne le nombre de SKU audités', () => {
    expect(audit.auditLimit(env({ KOMERCE_ALIEXPRESS_FULFILLMENT_AUDIT_LIMIT: '0' }))).toBe(1);
    expect(audit.auditLimit(env({ KOMERCE_ALIEXPRESS_FULFILLMENT_AUDIT_LIMIT: '12' }))).toBe(12);
    expect(audit.auditLimit(env({ KOMERCE_ALIEXPRESS_FULFILLMENT_AUDIT_LIMIT: '999' }))).toBe(audit.MAX_LIMIT);
  });

  it('agrège les verdicts sans double comptage', () => {
    expect(audit.summarize([
      { ready: true, status: 'FULFILLMENT_READY' },
      { ready: false, status: 'OUT_OF_STOCK' },
      { ready: false, status: 'OUT_OF_STOCK' },
      { ready: false, status: 'NOT_SHIPPABLE' },
    ])).toEqual({
      evaluated: 4,
      ready: 1,
      ready_rate_pct: 25,
      counts: {
        FULFILLMENT_READY: 1,
        OUT_OF_STOCK: 2,
        NOT_SHIPPABLE: 1,
      },
    });
  });

  it('exécute un batch borné et conserve le hard stop fournisseur', async () => {
    const rows = [
      {
        product_sku_id: 'sku-1', product_id: 'product-1', supplier_sku: 'A', supplier_unit_ref: 'ua',
      },
      {
        product_sku_id: 'sku-2', product_id: 'product-2', supplier_sku: 'B', supplier_unit_ref: 'ub',
      },
    ];
    const dbImpl = { query: jest.fn().mockResolvedValue({ rows }) };
    const evaluate = jest.fn()
      .mockResolvedValueOnce({
        ready: true,
        status: 'FULFILLMENT_READY',
        reason: null,
        evidence: {
          supplier_product_id: '1001', stock_available: 5, unit_price: 2.5,
          currency: 'USD', destination_country_code: 'KM', freight: { success: true, has_options: true },
          place_order_invoked: false, payment_invoked: false,
        },
      })
      .mockResolvedValueOnce({
        ready: false,
        status: 'OUT_OF_STOCK',
        reason: 'stock insuffisant',
        evidence: { supplier_product_id: '1002', stock_available: 0 },
      });

    const out = await audit.run(env({ KOMERCE_ALIEXPRESS_FULFILLMENT_AUDIT_LIMIT: '2' }), {
      dbImpl,
      evaluate,
      sleepImpl: jest.fn(),
    });

    expect(dbImpl.query).toHaveBeenCalledTimes(1);
    expect(evaluate).toHaveBeenCalledTimes(2);
    expect(evaluate.mock.calls[0][0]).toMatchObject({
      productSkuId: 'sku-1',
      quantity: 1,
      destination: { country_code: 'KM', send_goods_country_code: 'CN' },
    });
    expect(out).toMatchObject({
      runtime: 'staging',
      destination_country_code: 'KM',
      send_goods_country_code: 'CN',
      selected: 2,
      evaluated: 2,
      ready: 1,
      ready_rate_pct: 50,
      counts: { FULFILLMENT_READY: 1, OUT_OF_STOCK: 1 },
      hard_stop: { place_order_invoked: false, payment_invoked: false },
    });
  });

  it('échoue si une preuve indique une mutation fournisseur', () => {
    expect(() => audit.assertNoSupplierMutation([
      {
        product_sku_id: 'sku-danger',
        evidence: { place_order_invoked: true, payment_invoked: false },
      },
    ])).toThrow(/SAFETY VIOLATION/);
  });
});
