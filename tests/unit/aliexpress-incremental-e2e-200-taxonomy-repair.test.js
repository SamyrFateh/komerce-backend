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

    const out = await repair.project(rows, {});
    expect(out.summary.total).toBe(2);
    expect(out.summary.changed).toBe(1);
    expect(out.summary.transitions).toEqual({
      'cosmetiques -> vetements': 1,
      'cosmetiques -> cosmetiques': 1,
    });
    expect(out.summary.scan_decision_drift).toBe(0);
  });

  test('refuses apply unless the projected 200-product distribution is exact', () => {
    expect(() => repair.assertSafeProjection({
      summary: {
        total: 200,
        scan_decision_drift: 0,
        after: { vetements: 117, enfants: 60, cosmetiques: 23 },
      },
    })).not.toThrow();

    expect(() => repair.assertSafeProjection({
      summary: {
        total: 200,
        scan_decision_drift: 0,
        after: { cosmetiques: 200 },
      },
    })).toThrow(/UNEXPECTED_DISTRIBUTION/);

    expect(() => repair.assertSafeProjection({
      summary: {
        total: 200,
        scan_decision_drift: 1,
        after: { vetements: 117, enfants: 60, cosmetiques: 23 },
      },
    })).toThrow(/DECISION_DRIFT/);
  });

  test('accepts only audit or apply operations', () => {
    expect(repair.parseArgs(['--operation=audit'])).toEqual({ operation: 'audit' });
    expect(repair.parseArgs(['--operation=apply'])).toEqual({ operation: 'apply' });
    expect(() => repair.parseArgs(['--operation=publish'])).toThrow(/invalide/);
  });
});
