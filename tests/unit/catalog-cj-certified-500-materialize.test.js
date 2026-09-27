'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const zlib = require('zlib');

jest.mock('../../db', () => ({
  query: jest.fn(),
  getClient: jest.fn(),
  pool: { end: jest.fn() },
}));
jest.mock('../../services/suppliers/connectors/cj-connector', () => ({
  PROVIDER_ID: 'cj',
  getAccessToken: jest.fn(),
  fetchProductDetail: jest.fn(),
  normalizeCjProduct: jest.fn(),
}));
jest.mock('../../services/suppliers/catalog-import-orchestrator', () => ({
  importCatalog: jest.fn(),
}));
jest.mock('../../services/sourcing-candidate-actions', () => ({
  promoteCandidate: jest.fn(),
}));
jest.mock('../../services/catalog-promotion', () => ({
  promoteCatalog: jest.fn(),
}));
jest.mock('../../services/catalog-overrides', () => ({
  upsertOverrides: jest.fn(),
}));
jest.mock('../../scripts/catalog-fr-free-e2e-preparation', () => ({
  prepareFrenchFields: jest.fn(),
}));
jest.mock('../../scripts/aliexpress-incremental-e2e-200', () => ({
  TARGET: 200,
  collectAcceptance: jest.fn(),
}));
jest.mock('../../services/suppliers/e2e-isolated-runtime', () => ({
  assertIsolatedE2eRuntime: jest.fn(() => ({ mode: 'railway-isolated' })),
}));
jest.mock('../../scripts/cj-reconcile-current-new-12-promote', () => ({
  NEW_UNIQUE_IDS: Array.from({ length: 12 }, (_, i) => `new-${i + 1}`),
}));

const materializer = require('../../scripts/catalog-cj-certified-500-materialize');
const { BALANCED_E2E_500_PLAN } = require('../../services/suppliers/e2e-catalog-500-plan');

function snapshot(ids) {
  return zlib.gzipSync(Buffer.from(JSON.stringify(ids))).toString('base64');
}

describe('catalog certified CJ 500 materializer', () => {
  test('decodes exactly 500 unique certified supplier ids', () => {
    const ids = Array.from({ length: 500 }, (_, i) => `cj-${i + 1}`);
    expect(materializer.decodeCertifiedIds({
      [materializer.SNAPSHOT_ENV]: snapshot(ids),
    })).toEqual(ids);
  });

  test('refuses wrong-sized or duplicate certified snapshots', () => {
    expect(() => materializer.decodeCertifiedIds({
      [materializer.SNAPSHOT_ENV]: snapshot(['one']),
    })).toThrow(/COUNT/);

    const ids = Array.from({ length: 500 }, (_, i) => `cj-${i + 1}`);
    ids[499] = ids[0];
    expect(() => materializer.decodeCertifiedIds({
      [materializer.SNAPSHOT_ENV]: snapshot(ids),
    })).toThrow(/DUPLICATE/);
  });

  test('maps certified product-ref order deterministically onto the balanced 21-segment plan', () => {
    const ids = Array.from({ length: 500 }, (_, i) => `cj-${i + 1}`);
    const assignments = materializer.buildAssignments(ids);

    expect(assignments).toHaveLength(500);
    expect(assignments[0]).toMatchObject({
      supplier_product_id: 'cj-1',
      certified_product_ref: 'KPR-000001',
      segment_id: BALANCED_E2E_500_PLAN[0].id,
      target_category: BALANCED_E2E_500_PLAN[0].category,
      target_subcategory: BALANCED_E2E_500_PLAN[0].subcategory,
    });
    expect(assignments[20].segment_id).toBe('mode-femme');
    expect(assignments[21].segment_id).toBe('mode-homme');
    expect(assignments[499]).toMatchObject({
      supplier_product_id: 'cj-500',
      certified_product_ref: 'KPR-000500',
      segment_id: 'auto-moto',
      target_category: 'Auto',
      target_subcategory: 'Moto',
    });
  });

  test('restored exact detail carries immutable certified provenance and boutique target', () => {
    const product = materializer.withCertifiedProvenance(
      { supplier_product_id: 'cj-1', raw_payload: { source_fact: true } },
      {
        certified_product_ref: 'KPR-000001',
        segment_id: 'mode-femme',
        target_category: 'Mode & Beauté',
        target_subcategory: 'Femme',
      }
    );
    expect(product.raw_payload.source_fact).toBe(true);
    expect(product.raw_payload.discovery).toMatchObject({
      campaign: materializer.CAMPAIGN,
      segment_id: 'mode-femme',
      target_category: 'Mode & Beauté',
      target_subcategory: 'Femme',
      certified_run_id: materializer.CERTIFIED_RUN_ID,
      certified_product_ref: 'KPR-000001',
      semantic_relevance: {
        relevant: true,
        authority: `github-actions-run-${materializer.CERTIFIED_RUN_ID}`,
      },
    });
  });

  test('fully materialized means inactive candidate plus complete active supplier SOI and boutique taxonomy', () => {
    const base = {
      state: 'imported_to_catalog',
      product_id: 'p1',
      lifecycle_status: 'candidate',
      is_active: false,
      active_skus: 3,
      complete_skus: 3,
      boutique_category_key: 'Tech',
      boutique_subcategory_key: 'Audio',
    };
    expect(materializer.fullyMaterialized(base)).toBe(true);
    expect(materializer.fullyMaterialized({ ...base, complete_skus: 2 })).toBe(false);
    expect(materializer.fullyMaterialized({ ...base, boutique_subcategory_key: null })).toBe(false);
  });
});
