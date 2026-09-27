'use strict';

const stress = require('../../scripts/real-supplier-1000-stress-staging');

function row(supplier, id, overrides = {}) {
  return {
    id,
    supplier_name: supplier,
    supplier_product_id: id,
    state: 'scanned',
    product_id: null,
    normalized_source_contract: { schema_version: '2' },
    scan_result: {
      sourcing_decision: 'TEST',
      test_price_kmf: 1500,
      recommended_price_authority: 'ECONOMIC_REFERENCE_NOT_MARKET_DECISION',
    },
    ...overrides,
  };
}

describe('real supplier 1000 staging stress tooling', () => {
  test('hard caps the campaign at 1000 rows', () => {
    expect(stress.TARGET_TOTAL).toBe(1000);
    expect(stress.TARGET_PER_SUPPLIER).toBe(500);
    expect(stress.parseArgs(['--operation=refinery-audit', '--limit=1000']))
      .toMatchObject({ operation: 'refinery-audit', limit: 1000 });
    expect(() => stress.parseArgs(['--limit=1001'])).toThrow(/1\.\.1000/);
  });

  test('refuses any non-staging runtime and requires explicit write flags', () => {
    expect(() => stress.assertRuntime(
      { operation: 'audit' },
      { KOMERCE_ENV: 'production', NODE_ENV: 'test', DATABASE_URL: 'x' }
    )).toThrow(/staging/);

    expect(() => stress.assertRuntime(
      { operation: 'promote' },
      { KOMERCE_ENV: 'staging', NODE_ENV: 'test', DATABASE_URL: 'x' }
    )).toThrow(/KOMERCE_ALLOW_REAL_SUPPLIER_STRESS_PROMOTION/);

    expect(() => stress.assertRuntime(
      { operation: 'prepare-fr' },
      { KOMERCE_ENV: 'staging', NODE_ENV: 'test', DATABASE_URL: 'x' }
    )).toThrow(/KOMERCE_ALLOW_REAL_SUPPLIER_STRESS_FR_PREP/);
  });

  test('promotes only refinery-approved V2 rows with explicit economic reference authority', () => {
    expect(stress.classifyForPromotion(row('AliExpress', 'a1'))).toMatchObject({
      status: 'promotable',
      price_kmf: 1500,
    });
    expect(stress.classifyForPromotion(row('CJdropshipping', 'c1', {
      scan_result: {
        sourcing_decision: 'WATCH',
        test_price_kmf: 1500,
        recommended_price_authority: 'ECONOMIC_REFERENCE_NOT_MARKET_DECISION',
      },
    }))).toMatchObject({ status: 'blocked', reason: 'decision:WATCH' });
    expect(stress.classifyForPromotion(row('CJdropshipping', 'c2', {
      scan_result: {
        sourcing_decision: 'TEST',
        test_price_kmf: 1500,
        recommended_price_authority: 'MARKET_PRICE',
      },
    }))).toMatchObject({ status: 'blocked' });
  });

  test('prepare-fr is a bounded free operation', () => {
    expect(stress.parseArgs(['--operation=prepare-fr', '--limit=974']))
      .toMatchObject({ operation: 'prepare-fr', limit: 974 });
  });

  test('round-robin selection prevents one supplier from swallowing the stress sample', () => {
    const rows = [
      row('AliExpress', 'a1'), row('AliExpress', 'a2'),
      row('CJdropshipping', 'c1'), row('CJdropshipping', 'c2'),
    ];
    const selected = stress.roundRobinPromotable(rows, 4);
    expect(selected.map(x => x.row.supplier_name)).toEqual([
      'AliExpress', 'CJdropshipping', 'AliExpress', 'CJdropshipping',
    ]);
  });
});
