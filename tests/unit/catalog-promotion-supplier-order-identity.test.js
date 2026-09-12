'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const { planSkuReconciliation } = require('../../services/catalog-promotion/sku');
const { BLOCKED_SUPPLIER_IDENTITY } = require('../../services/suppliers/supplier-order-identity');

const IDENTITY = {
  provider: 'aliexpress',
  version: 1,
  payload: { sku_id: '20000098765', sku_attr: '14:29;5:361386' },
};

function existing(overrides = {}) {
  return {
    id: 'sku-1',
    supplier_sku: 'SUP-1',
    source: 'SUPPLIER',
    supplier_unit_ref: null,
    supplier_order_identity: null,
    variant_combo: { color: 'Pink' },
    stock: 10,
    is_active: true,
    ...overrides,
  };
}

function unit(overrides = {}) {
  return {
    supplier_sku: 'SUP-1',
    option_values: { color: 'Pink' },
    stock_available: 10,
    ...overrides,
  };
}

function captureError(fn) {
  try {
    fn();
    return null;
  } catch (error) {
    return error;
  }
}

describe('catalog promotion — Supplier Order Identity persistence', () => {
  test('new supplier SKU carries native order identity into the persistence plan', () => {
    const plan = planSkuReconciliation([], [unit({
      supplier_unit_ref: '20000098765',
      supplier_order_identity: IDENTITY,
    })]);

    expect(plan.toCreate[0]).toMatchObject({
      supplier_unit_ref: '20000098765',
      supplier_order_identity: IDENTITY,
    });
  });

  test('native identity can complete a historical SKU that had none', () => {
    const plan = planSkuReconciliation([existing()], [unit({
      supplier_unit_ref: '20000098765',
      supplier_order_identity: IDENTITY,
    })]);

    expect(plan.toUpdate[0]).toMatchObject({
      id: 'sku-1',
      supplier_unit_ref: '20000098765',
      supplier_order_identity: IDENTITY,
    });
  });

  test('identity already persisted survives a replay that no longer carries identity', () => {
    const plan = planSkuReconciliation([existing({
      supplier_unit_ref: '20000098765',
      supplier_order_identity: IDENTITY,
    })], [unit()]);

    expect(plan.toUpdate[0]).toMatchObject({
      supplier_unit_ref: '20000098765',
      supplier_order_identity: IDENTITY,
    });
  });

  test('same canonical identity is idempotent', () => {
    const plan = planSkuReconciliation([existing({
      supplier_unit_ref: '20000098765',
      supplier_order_identity: IDENTITY,
    })], [unit({
      supplier_unit_ref: '20000098765',
      supplier_order_identity: {
        provider: 'aliexpress',
        version: 1,
        payload: { sku_attr: '14:29;5:361386', sku_id: '20000098765' },
      },
    })]);

    expect(plan.toUpdate).toHaveLength(1);
  });

  test('different supplier_unit_ref for same Komerce SKU is blocked', () => {
    const error = captureError(() => planSkuReconciliation([existing({
      supplier_unit_ref: 'UNIT-A',
      supplier_order_identity: { provider: 'aliexpress', version: 1, payload: { sku_id: 'UNIT-A' } },
    })], [unit({
      supplier_unit_ref: 'UNIT-B',
      supplier_order_identity: { provider: 'aliexpress', version: 1, payload: { sku_id: 'UNIT-B' } },
    })]));

    expect(error).toBeTruthy();
    expect(error.code).toBe(BLOCKED_SUPPLIER_IDENTITY);
  });

  test('different order payload for same persisted unit is blocked', () => {
    const error = captureError(() => planSkuReconciliation([existing({
      supplier_unit_ref: '20000098765',
      supplier_order_identity: IDENTITY,
    })], [unit({
      supplier_unit_ref: '20000098765',
      supplier_order_identity: {
        provider: 'aliexpress',
        version: 1,
        payload: { sku_id: '20000098765', sku_attr: 'DIFFERENT' },
      },
    })]));

    expect(error).toBeTruthy();
    expect(error.code).toBe(BLOCKED_SUPPLIER_IDENTITY);
  });

  test('order identity without supplier_unit_ref is blocked', () => {
    const error = captureError(() => planSkuReconciliation([], [unit({ supplier_order_identity: IDENTITY })]));
    expect(error).toBeTruthy();
    expect(error.code).toBe(BLOCKED_SUPPLIER_IDENTITY);
  });

  test('one supplier_unit_ref cannot resolve to two supplier SKUs in the same replay', () => {
    const error = captureError(() => planSkuReconciliation([], [
      unit({ supplier_sku: 'SUP-A', supplier_unit_ref: 'UNIT-1' }),
      unit({ supplier_sku: 'SUP-B', supplier_unit_ref: 'UNIT-1' }),
    ]));

    expect(error).toBeTruthy();
    expect(error.code).toBe(BLOCKED_SUPPLIER_IDENTITY);
  });
});
