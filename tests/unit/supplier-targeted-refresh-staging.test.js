'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const refresh = require('../../scripts/supplier-targeted-refresh-staging');

describe('supplier targeted refresh staging', () => {
  test('est dry-run par défaut et borne le lot', () => {
    expect(refresh.parseArgs(['--supplier=cj'])).toEqual({
      supplierId: 'cj',
      limit: 5,
      execute: false,
    });
    expect(refresh.parseArgs(['--supplier=CJ', '--limit=20', '--execute'])).toEqual({
      supplierId: 'cj',
      limit: 20,
      execute: true,
    });
    expect(() => refresh.parseArgs(['--supplier=cj', '--limit=21'])).toThrow(/1 et 20/);
  });

  test('refuse toute écriture en production même si le flag est armé', () => {
    const options = { supplierId: 'cj', limit: 5, execute: true };
    expect(() => refresh.assertExecuteAllowed(options, {
      KOMERCE_ENV: 'production',
      KOMERCE_ALLOW_SUPPLIER_TARGETED_REFRESH: '1',
    })).toThrow(/interdit en production/i);
  });

  test('exige un flag séparé pour exécuter en staging', () => {
    const options = { supplierId: 'cj', limit: 5, execute: true };
    expect(() => refresh.assertExecuteAllowed(options, { KOMERCE_ENV: 'staging' }))
      .toThrow(/KOMERCE_ALLOW_SUPPLIER_TARGETED_REFRESH=1/);
    expect(() => refresh.assertExecuteAllowed(options, {
      KOMERCE_ENV: 'staging',
      KOMERCE_ALLOW_SUPPLIER_TARGETED_REFRESH: '1',
    })).not.toThrow();
  });

  test('audite la complétude SOI sans interpréter le payload fournisseur', () => {
    const rows = [{
      id: 'candidate-1',
      supplier_product_id: 'P-1',
      state: 'scanned',
      product_id: null,
      scan_result: {
        sourcing_decision: 'TEST',
        test_price_kmf: 4990,
        recommended_price_authority: 'ECONOMIC_REFERENCE_NOT_MARKET_DECISION',
      },
      normalized_source_contract: {
        stock_available: 12,
        sellable_units: [{
          supplier_sku: 'SKU-1',
          supplier_unit_ref: 'UNIT-1',
          supplier_order_identity: {
            provider: 'any-provider',
            version: 1,
            payload: { opaque_variant_id: 'V-1' },
          },
          stock_available: 12,
          is_active: true,
        }],
      },
    }];

    expect(refresh.summarizeAfter(rows)).toEqual([expect.objectContaining({
      active_units: 1,
      complete_soi_units: 1,
      all_active_units_have_soi: true,
    })]);
  });
});
