'use strict';

const {
  computeCascadeClosure,
  protectedHits,
  PROTECTED_TABLES,
} = require('../../scripts/controlled-business-purge');

describe('controlled business purge safety', () => {
  test('computes recursive FK cascade closure', () => {
    const closure = computeCascadeClosure(['orders'], [
      { referenced_table: 'orders', referencing_table: 'order_items' },
      { referenced_table: 'order_items', referencing_table: 'parcel_items' },
      { referenced_table: 'markets', referencing_table: 'market_prices' },
    ]);

    expect(closure).toEqual(['order_items', 'orders', 'parcel_items']);
  });

  test('detects protected foundation inside cascade and would abort execute', () => {
    expect(PROTECTED_TABLES.has('markets')).toBe(true);
    expect(PROTECTED_TABLES.has('relais')).toBe(true);
    expect(PROTECTED_TABLES.has('supplier_oauth_connections')).toBe(true);
    expect(PROTECTED_TABLES.has('sourcing_sources')).toBe(true);

    expect(protectedHits(['orders', 'order_items', 'markets', 'sourcing_sources']))
      .toEqual(['markets', 'sourcing_sources']);
  });

  test('ordinary commerce cascade contains no protected foundation', () => {
    const closure = computeCascadeClosure(['products', 'orders'], [
      { referenced_table: 'products', referencing_table: 'product_skus' },
      { referenced_table: 'products', referencing_table: 'product_market_exposure' },
      { referenced_table: 'orders', referencing_table: 'order_items' },
      { referenced_table: 'order_items', referencing_table: 'purchase_order_items' },
    ]);

    expect(protectedHits(closure)).toEqual([]);
  });
});
