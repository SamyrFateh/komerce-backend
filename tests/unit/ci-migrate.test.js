'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
jest.mock('../../db', () => ({
  getClient: jest.fn(),
}));

jest.mock('../../scripts/run-migrations', () => ({
  run: jest.fn(),
  listMigrationFiles: jest.fn(),
}));

const {
  reconcileStructuralBaseline,
  STRUCTURAL_PROBES,
} = require('../../scripts/ci-migrate');

describe('ci-migrate — structural baseline reconciliation', () => {
  test('keeps migration 110 baselined when the dump contains all sentinels', async () => {
    const client = {
      query: jest.fn().mockResolvedValue({ rows: [{ represented: true }] }),
    };
    const baseline = new Set(['109_previous.sql', '110_catalog_import_audit.sql']);

    const result = await reconcileStructuralBaseline(client, baseline);

    expect(result).not.toBe(baseline);
    expect(result.has('110_catalog_import_audit.sql')).toBe(true);
    expect(client.query).toHaveBeenCalledTimes(1);
  });

  test('removes migration 110 from baseline when the live snapshot is partial', async () => {
    const client = {
      query: jest.fn().mockResolvedValue({ rows: [{ represented: false }] }),
    };
    const baseline = new Set(['109_previous.sql', '110_catalog_import_audit.sql']);

    const result = await reconcileStructuralBaseline(client, baseline);

    expect(result.has('109_previous.sql')).toBe(true);
    expect(result.has('110_catalog_import_audit.sql')).toBe(false);
    expect(baseline.has('110_catalog_import_audit.sql')).toBe(true);
  });

  test('does not query probes for migrations absent from the git baseline', async () => {
    const client = { query: jest.fn() };

    const result = await reconcileStructuralBaseline(client, new Set(['109_previous.sql']));

    expect(result).toEqual(new Set(['109_previous.sql']));
    expect(client.query).not.toHaveBeenCalled();
  });

  test('migration 110 probe checks both altered tables and both audit tables', () => {
    const probeSource = String(STRUCTURAL_PROBES['110_catalog_import_audit.sql']);

    expect(probeSource).toContain('supplier_catalog_imports');
    expect(probeSource).toContain('profile_id');
    expect(probeSource).toContain('batch_findings');
    expect(probeSource).toContain('sourcing_candidates');
    expect(probeSource).toContain('promotion_status');
    expect(probeSource).toContain('supplier_catalog_import_rejections');
    expect(probeSource).toContain('sourcing_candidate_observations');
  });
});
