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

const repair = require('../../scripts/aliexpress-incremental-e2e-200-taxonomy-repair');
const scanner = require('../../services/supplier-catalog-scanner');

describe('AliExpress incremental +200 taxonomy repair', () => {
  test('is strictly limited to staging/test and the known wave', () => {
    expect(repair.WAVE_ID).toBe('incremental-e2e-200-v1');
    expect(repair.TARGET).toBe(200);
    expect(() => repair.assertRuntime({
      KOMERCE_ENV: 'staging',
      NODE_ENV: 'test',
      DATABASE_URL: 'postgres://test',
      KOMERCE_ALLOW_ALIEXPRESS_INCREMENTAL_E2E_200: '1',
    })).not.toThrow();
    expect(() => repair.assertRuntime({
      KOMERCE_ENV: 'production',
      NODE_ENV: 'test',
      DATABASE_URL: 'postgres://test',
      KOMERCE_ALLOW_ALIEXPRESS_INCREMENTAL_E2E_200: '1',
    })).toThrow(/staging\/test/);
  });

  test('keeps a deterministic 200-row repair cohort when semantic top-up appended a tail', () => {
    const rows = Array.from({ length: 215 }, (_, index) => ({ candidate_id: `c-${index + 1}` }));
    const scope = repair.selectRepairCohort(rows);

    expect(scope.cohort).toHaveLength(200);
    expect(scope.tail).toHaveLength(15);
    expect(scope.cohort[0].candidate_id).toBe('c-1');
    expect(scope.cohort[199].candidate_id).toBe('c-200');
    expect(scope.tail[0].candidate_id).toBe('c-201');
    expect(() => repair.selectRepairCohort(rows.slice(0, 199))).toThrow(/au moins 200/);
  });

  test('projects category transitions without resourcing', async () => {
    scanner.normalizeCandidate
      .mockResolvedValueOnce({
        komerce_category: 'vetements',
        estimated_weight_kg: 0.4,
        estimated_volume_m3: 0.005,
        target_margin_pct: 45,
        data_sources: { category: 'mapped' },
        confidence: 'high',
      })
      .mockResolvedValueOnce({
        komerce_category: 'cosmetiques',
        estimated_weight_kg: 0.2,
        estimated_volume_m3: 0.0008,
        target_margin_pct: 50,
        data_sources: { category: 'mapped' },
        confidence: 'high',
      });
    scanner.scanCandidate
      .mockResolvedValueOnce({ scan_result: {}, sourcing_decision: 'TEST' })
      .mockResolvedValueOnce({ scan_result: {}, sourcing_decision: 'TEST' });

    const rows = [
      {
        candidate_id: 'c1', product_id: 'p1', product_ref: 'KPR-1',
        supplier_product_id: 'a1', old_candidate_category: 'cosmetiques',
        old_product_category: 'cosmetiques',
        raw_payload: { discovery: { wave: repair.WAVE_ID } },
        normalized_source_contract: { schema_version: '2' },
        old_scan_result: { sourcing_decision: 'TEST' },
      },
      {
        candidate_id: 'c2', product_id: 'p2', product_ref: 'KPR-2',
        supplier_product_id: 'a2', old_candidate_category: 'cosmetiques',
        old_product_category: 'cosmetiques',
        raw_payload: { discovery: { wave: repair.WAVE_ID } },
        normalized_source_contract: { schema_version: '2' },
        old_scan_result: { sourcing_decision: 'TEST' },
      },
    ];

    const out = await repair.project(rows, {
      categories: {
        vetements: { key: 'vetements', is_active: true },
        cosmetiques: { key: 'cosmetiques', is_active: true },
      },
    });
    expect(out.summary.total).toBe(2);
    expect(out.summary.changed).toBe(1);
    expect(out.summary.transitions).toEqual({
      'cosmetiques -> vetements': 1,
      'cosmetiques -> cosmetiques': 1,
    });
    expect(out.summary.scan_decision_drift).toBe(0);
    expect(out.summary.unresolved_category).toBe(0);
    expect(out.summary.invalid_category).toBe(0);
  });

  test('accepts any configured distribution but refuses unresolved, invalid, or decision drift', () => {
    const safe = {
      total: 200,
      scan_decision_drift: 0,
      unresolved_category: 0,
      invalid_category: 0,
      after: { arbitrary_a: 73, arbitrary_b: 127 },
    };
    expect(() => repair.assertSafeProjection({ summary: safe })).not.toThrow();

    expect(() => repair.assertSafeProjection({
      summary: { ...safe, unresolved_category: 1, after: { arbitrary_a: 72, arbitrary_b: 127, UNRESOLVED: 1 } },
    })).toThrow(/UNRESOLVED_CATEGORY/);

    expect(() => repair.assertSafeProjection({
      summary: { ...safe, invalid_category: 1 },
    })).toThrow(/INVALID_CATEGORY/);

    expect(() => repair.assertSafeProjection({
      summary: { ...safe, scan_decision_drift: 1 },
    })).toThrow(/DECISION_DRIFT/);

    expect(() => repair.assertSafeProjection({
      summary: { ...safe, after: { arbitrary_a: 72, arbitrary_b: 127 } },
    })).toThrow(/AFTER_TOTAL_MISMATCH/);
  });

  test('proves dynamic customs category configuration is actually loaded', () => {
    expect(repair.summarizeTaxonomyConfig({
      categories: {
        configured: {
          key: 'configured',
          is_active: true,
          classification_terms: { crossbody: 10, handbag: 8 },
          default_weight_kg: 0.4,
        },
        inactive: {
          key: 'inactive',
          is_active: false,
          classification_terms: { ignored: 10 },
        },
        empty: {
          key: 'empty',
          is_active: true,
          classification_terms: {},
        },
      },
    })).toEqual({
      categories: [
        {
          key: 'configured',
          is_active: true,
          classification_terms_count: 2,
          default_weight_kg: 0.4,
        },
        {
          key: 'inactive',
          is_active: false,
          classification_terms_count: 1,
          default_weight_kg: null,
        },
        {
          key: 'empty',
          is_active: true,
          classification_terms_count: 0,
          default_weight_kg: null,
        },
      ],
      configured_active: 1,
    });
  });

  test('accepts only audit or apply operations', () => {
    expect(repair.parseArgs(['--operation=audit'])).toEqual({ operation: 'audit' });
    expect(repair.parseArgs(['--operation=apply'])).toEqual({ operation: 'apply' });
    expect(() => repair.parseArgs(['--operation=publish'])).toThrow(/invalide/);
  });
});
