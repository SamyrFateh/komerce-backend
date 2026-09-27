'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

jest.mock('../../db', () => ({
  query: jest.fn(),
  getClient: jest.fn(),
  pool: { end: jest.fn() },
}));
jest.mock('../../services/pricing-engine', () => ({
  loadGlobalConfig: jest.fn(),
}));
jest.mock('../../services/supplier-catalog-scanner', () => ({
  normalizeCandidate: jest.fn(),
  scanCandidate: jest.fn(),
}));
jest.mock('../../services/sourcing-candidate-actions', () => ({
  promoteCandidate: jest.fn(),
}));
jest.mock('../../services/catalog-overrides', () => ({
  upsertOverrides: jest.fn(),
}));
jest.mock('../../scripts/catalog-fr-free-e2e-preparation', () => ({
  prepareFrenchFields: jest.fn(),
}));
jest.mock('../../scripts/catalog-cj-certified-500-materialize', () => ({
  decodeCertifiedIds: jest.fn(() => Array.from({ length: 500 }, (_, i) => `cj-${i + 1}`)),
  finalAudit: jest.fn(),
}));
jest.mock('../../services/suppliers/e2e-isolated-runtime', () => ({
  assertIsolatedE2eRuntime: jest.fn(() => ({ mode: 'railway-isolated' })),
}));

const resolver = require('../../scripts/catalog-cj-certified-500-resolve-watch');

describe('catalog CJ certified 500 WATCH resolver', () => {
  test('reconstructs the exact stored V2 source contract and preserves discovery provenance', () => {
    const row = {
      supplier_product_id: 'cj-1',
      normalized_source_contract: {
        schema_version: 2,
        supplier_name: 'CJdropshipping',
        supplier_product_id: 'cj-1',
        product_name: 'Produit',
      },
      raw_payload: {
        discovery: {
          target_category: 'Auto',
          target_subcategory: 'Freinage',
        },
      },
    };
    const out = resolver.sourceProduct(row);
    expect(out).toMatchObject({
      schema_version: 2,
      supplier_product_id: 'cj-1',
      raw_payload: {
        discovery: {
          target_category: 'Auto',
          target_subcategory: 'Freinage',
        },
      },
    });
  });

  test('refuses a projection that still has an unresolved category', () => {
    expect(() => resolver.assertProjection({
      details: [{
        normalized: { komerce_category: null },
        categorySource: 'default',
        decision: 'WATCH',
        scan: { reason: 'unresolved' },
      }],
    })).toThrow(/WATCH_UNRESOLVED/);
  });

  test('refuses economic WATCH even after category resolution instead of forcing promotion', () => {
    expect(() => resolver.assertProjection({
      details: [{
        normalized: { komerce_category: 'materiels' },
        categorySource: 'boutique_affinity',
        decision: 'WATCH',
        scan: { reason: 'Référence test à contribution fragile.' },
      }],
    })).toThrow(/WATCH_NON_ACCEPTED/);
  });

  test('accepts TEST and PRIORITY projections resolved through lexical or boutique affinity sources', () => {
    expect(() => resolver.assertProjection({
      details: [
        {
          normalized: { komerce_category: 'materiels' },
          categorySource: 'boutique_affinity',
          decision: 'TEST',
          scan: { reason: 'ok' },
        },
        {
          normalized: { komerce_category: 'electro' },
          categorySource: 'mapped',
          decision: 'PRIORITY',
          scan: { reason: 'ok' },
        },
      ],
    })).not.toThrow();
  });
});
