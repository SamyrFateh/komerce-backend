'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

jest.mock('../../db', () => ({ query: jest.fn(), getClient: jest.fn() }));

const runs = require('../../services/import-runtime-runs');

const T0 = '2026-09-28T10:00:00.000Z';
const T1 = '2026-09-28T10:00:05.000Z';

function candidate(i, over = {}) {
  return {
    candidate_ref: `KSC-${i}`,
    supplier_name: 'AliExpress',
    supplier_product_id: `SP-${i}`,
    product_name: `Produit ${i}`,
    image_url: null,
    komerce_category: 'maison',
    state: 'scanned',
    scan_at: T1,
    updated_at: T1,
    raw_payload: { ok: true },
    has_raw_payload: true,
    normalized_source_contract: { schema_version: '2' },
    scan_result: { sourcing_decision: 'TEST' },
    promotion_status: null,
    promotion_reasons: null,
    findings: null,
    rejected_reason: null,
    product_ref: null,
    ...over,
  };
}

function baseRun(over = {}) {
  const done = { started_at: T0, finished_at: T1 };
  return {
    run_ref: 'KIR-000001',
    provider: 'AliExpress',
    source_type: 'api',
    source_ref: 'aliexpress',
    mode: 'replay',
    status: 'RUNNING',
    source_total: 3,
    import_ref: 'KSI-000010',
    started_at: T0,
    finished_at: null,
    updated_at: T1,
    failure_reason: null,
    stages: {
      SOURCE_CONNECTED: done,
      RAW_IMPORT: done,
      REFINERY: done,
    },
    intake: {
      recorded_at: T1,
      accepted: 3,
      duplicates: 0,
      rejected: 0,
      quarantined: 0,
      deferred: 0,
      ready_for_refinery: 3,
      certification_blocked: 0,
      pipeline_status: 'CANONICAL_RESOLVED',
      capture_id: 'cap-1',
    },
    ...over,
  };
}

const rows3 = () => [candidate(1), candidate(2), candidate(3)];
const stage = (projection, key) => projection.stages.find((item) => item.key === key);

describe('import runtime run projection', () => {
  test('expose exactement les 6 jalons canoniques dans l’ordre', () => {
    const projection = runs.buildProjection({ run: baseRun(), rows: rows3() });
    expect(projection.stages.map((item) => item.key)).toEqual([
      'SOURCE_CONNECTED',
      'RAW_IMPORT',
      'REFINERY',
      'TAXONOMY',
      'CERTIFICATION',
      'CATALOGUE',
    ]);
  });

  test('réutilise l’accounting canonique et expose UNACCOUNTED / OVERFLOW', () => {
    const projection = runs.buildProjection({ run: baseRun(), rows: rows3() });
    expect(projection.accounting).toMatchObject({
      source_total: 3,
      accepted: 3,
      duplicates: 0,
      rejected: 0,
      quarantined: 0,
      deferred: 0,
      refined: 3,
      taxonomized: 3,
      certified: 3,
      catalogued: 0,
      unaccounted: 0,
      overflow: 0,
    });
  });

  test('certification reste fail-closed sans preuve runtime de la capture du run', () => {
    const projection = runs.buildProjection({
      run: baseRun(),
      rows: rows3(),
      sourceProof: null,
    });
    expect(stage(projection, 'CERTIFICATION')).toMatchObject({
      status: 'PENDING',
      reason: 'provider_runtime_proof_missing',
    });
    expect(stage(projection, 'CATALOGUE').status).toBe('PENDING');
  });

  test('preuve runtime + accounting équilibré terminent la certification', () => {
    const projection = runs.buildProjection({
      run: baseRun(),
      rows: rows3(),
      sourceProof: { certified_at: T1, capture_id: 'cap-1' },
    });
    expect(stage(projection, 'CERTIFICATION').status).toBe('COMPLETED');
    expect(stage(projection, 'CATALOGUE').status).toBe('RUNNING');
    expect(projection.status).toBe('RUNNING');
  });

  test('preuve d’une autre capture est refusée', () => {
    const projection = runs.buildProjection({
      run: baseRun(),
      rows: rows3(),
      sourceProof: { certified_at: T1, capture_id: 'cap-other' },
    });
    expect(stage(projection, 'CERTIFICATION').status).toBe('PENDING');
  });

  test('accounting déséquilibré fait échouer la certification', () => {
    const projection = runs.buildProjection({
      run: baseRun({ source_total: 5 }),
      rows: rows3(),
      sourceProof: { certified_at: T1, capture_id: 'cap-1' },
    });
    expect(projection.accounting.unaccounted).toBe(2);
    expect(stage(projection, 'CERTIFICATION')).toMatchObject({
      status: 'FAILED',
      reason: 'accounting_unbalanced',
    });
    expect(projection.status).toBe('FAILED');
  });

  test('run COMPLETED seulement lorsque le catalogue a absorbé tous les certifiés', () => {
    const rows = rows3().map((row, index) => candidate(index + 1, {
      state: 'imported_to_catalog',
      product_ref: `KP-${index + 1}`,
    }));
    const projection = runs.buildProjection({
      run: baseRun(),
      rows,
      sourceProof: { certified_at: T1, capture_id: 'cap-1' },
    });
    expect(stage(projection, 'CATALOGUE').status).toBe('COMPLETED');
    expect(projection.status).toBe('COMPLETED');
  });

  test('projection publique n’expose pas les UUID internes', () => {
    const projection = runs.buildProjection({
      run: { ...baseRun(), id: 'uuid-run', started_by: 'uuid-user' },
      rows: rows3().map((row) => ({ ...row, id: 'uuid-candidate', product_id: 'uuid-product' })),
    });
    const json = JSON.stringify(projection);
    expect(json).not.toContain('uuid-');
    expect(json).not.toMatch(/"(id|import_id|candidate_id|product_id|started_by)"/);
  });

  test('hooks de projection sont fail-open', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(runs.safe(() => { throw new Error('db down'); })).resolves.toBeNull();
    warn.mockRestore();
  });
});
