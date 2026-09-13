'use strict';

jest.mock('../../db', () => ({
  query: jest.fn(),
  getClient: jest.fn(),
  pool: { end: jest.fn() },
}));

jest.mock('../../services/suppliers/connectors/aliexpress-connected-connector', () => ({
  managedRuntimeEnv: jest.fn(),
}));

jest.mock('../../services/suppliers/connectors/aliexpress-connector', () => ({
  fetchProducts: jest.fn(),
}));

jest.mock('../../services/suppliers/catalog-import-orchestrator', () => ({
  importCatalog: jest.fn(),
}));

const baseConnector = require('../../services/suppliers/connectors/aliexpress-connector');
const importer = require('../../services/suppliers/catalog-import-orchestrator');
const refresh = require('../../scripts/aliexpress-refresh-imported-contracts');

describe('aliexpress-refresh-imported-contracts', () => {
  beforeEach(() => jest.clearAllMocks());

  test('reste en dry-run par défaut et borne la limite', () => {
    expect(refresh.parseArgs([])).toEqual({ execute: false, dryRun: true, limit: 50 });
    expect(refresh.parseArgs(['--limit=484'])).toEqual({ execute: false, dryRun: true, limit: 484 });
    expect(() => refresh.parseArgs(['--limit=501'])).toThrow('--limit doit être un entier 1..500');
  });

  test('execute exige staging et un flag explicite', () => {
    expect(() => refresh.assertRuntime(
      { execute: true },
      { KOMERCE_ENV: 'staging', DATABASE_URL: 'postgres://test' }
    )).toThrow('KOMERCE_ALLOW_ALIEXPRESS_CONTRACT_REFRESH=1 requis');

    expect(() => refresh.assertRuntime(
      { execute: false },
      { KOMERCE_ENV: 'production', DATABASE_URL: 'postgres://test' }
    )).toThrow('KOMERCE_ENV=staging requis');
  });

  test('découpe les appels fournisseur à 50 produits maximum', () => {
    const rows = Array.from({ length: 121 }, (_, index) => index + 1);
    expect(refresh.chunks(rows).map((batch) => batch.length)).toEqual([50, 50, 21]);
  });

  test('dry-run ne persiste rien et conserve la provenance discovery en mémoire', async () => {
    const batch = [{
      supplier_product_id: '1001',
      raw_payload: { discovery: { segment_id: 'tech-audio' } },
    }];
    baseConnector.fetchProducts.mockResolvedValue({
      products: [{
        supplier_product_id: '1001',
        raw_payload: { source: 'aliexpress_ds_api' },
        sellable_units: [{
          supplier_unit_ref: '14:193',
          supplier_order_identity: { provider: 'aliexpress', version: 1, payload: { sku_attr: '14:193' } },
        }],
      }],
      invalid: [],
    });

    const result = await refresh.refreshBatch(batch, {
      execute: false,
      providerEnv: { ALIEXPRESS_SESSION: 'x' },
      destinationCountry: 'AE',
    });

    expect(result.refreshable).toBe(1);
    expect(result.identity_units).toBe(1);
    expect(result.imported).toBe(0);
    expect(importer.importCatalog).not.toHaveBeenCalled();
  });

  test('execute ne réimporte que les produits dont une unité possède une SOI autoritaire', async () => {
    const batch = [
      { supplier_product_id: '1001', raw_payload: { discovery: { segment_id: 'tech' } } },
      { supplier_product_id: '1002', raw_payload: null },
    ];
    baseConnector.fetchProducts.mockResolvedValue({
      products: [
        {
          supplier_product_id: '1001',
          raw_payload: { source: 'aliexpress_ds_api' },
          sellable_units: [{
            supplier_unit_ref: 'SKU-1',
            supplier_order_identity: { provider: 'aliexpress', version: 1, payload: { sku_id: 'SKU-1' } },
          }],
        },
        {
          supplier_product_id: '1002',
          raw_payload: { source: 'aliexpress_ds_api' },
          sellable_units: [{ supplier_unit_ref: null, supplier_order_identity: null }],
        },
      ],
      invalid: [],
    });
    importer.importCatalog.mockImplementation(async (_body, _user, dispatch) => {
      const dispatched = await dispatch();
      expect(dispatched.products).toHaveLength(1);
      expect(dispatched.products[0].supplier_product_id).toBe('1001');
      expect(dispatched.products[0].raw_payload.discovery).toEqual({ segment_id: 'tech' });
      return { status: 200, body: { accepted: 1, rejected: 0 } };
    });

    const result = await refresh.refreshBatch(batch, {
      execute: true,
      providerEnv: { ALIEXPRESS_SESSION: 'x' },
      destinationCountry: 'AE',
    });

    expect(result.refreshable).toBe(1);
    expect(result.blocked_without_identity).toBe(1);
    expect(result.imported).toBe(1);
    expect(importer.importCatalog).toHaveBeenCalledTimes(1);
  });
});
