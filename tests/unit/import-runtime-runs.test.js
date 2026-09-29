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
      awaiting_catalogue_promotion: 3,
      unaccounted: 0,
      overflow: 0,
    });
  });

  test('certification produit avance même si la preuve runtime fournisseur manque', () => {
    const projection = runs.buildProjection({
      run: baseRun(),
      rows: rows3(),
      sourceProof: null,
    });
    expect(stage(projection, 'CERTIFICATION')).toMatchObject({
      status: 'COMPLETED',
      reason: null,
      processed: 3,
      total: 3,
    });
    expect(stage(projection, 'CATALOGUE')).toMatchObject({
      status: 'RUNNING',
      reason: 'awaiting_explicit_operator_promotion',
    });
    expect(projection.status).toBe('COMPLETED');
    expect(projection.progress_pct).toBe(100);
    expect(projection.current_stage).toBe('CATALOGUE');
    expect(projection.diagnostics).toMatchObject({
      provider_runtime_status: 'PENDING',
      provider_runtime_reason: 'provider_runtime_proof_missing',
      runtime_certified: false,
      certification_reason: null,
    });
  });

  test('PARTIAL_BLOCKED bloque la source mais laisse le lot continuer vers Catalogue', () => {
    const projection = runs.buildProjection({
      run: baseRun({
        source_total: 3,
        intake: {
          recorded_at: T1,
          accepted: 2,
          duplicates: 0,
          rejected: 1,
          quarantined: 0,
          deferred: 0,
          ready_for_refinery: 2,
          certification_blocked: 0,
          pipeline_status: 'PARTIAL_BLOCKED',
          canonical_resolved: true,
          reject_reasons: { 'media absent': 1 },
          capture_id: 'cap-partial',
        },
      }),
      rows: [candidate(1), candidate(2)],
      sourceProof: null,
    });
    expect(stage(projection, 'CERTIFICATION')).toMatchObject({
      status: 'COMPLETED',
      reason: null,
      processed: 2,
      total: 2,
      metrics: expect.objectContaining({
        certified: 2,
        provider_runtime_status: 'BLOCKED',
        runtime_certified: false,
      }),
    });
    expect(stage(projection, 'CATALOGUE')).toMatchObject({
      status: 'RUNNING',
      reason: 'awaiting_explicit_operator_promotion',
      processed: 0,
      total: 2,
    });
    expect(projection.status).toBe('COMPLETED');
    expect(projection.progress_pct).toBe(100);
    expect(projection.current_stage).toBe('CATALOGUE');
    expect(projection.accounting).toMatchObject({
      source_total: 3, accepted: 2, rejected: 1, certified: 2,
      awaiting_catalogue_promotion: 2,
    });
    expect(projection.diagnostics).toEqual({
      pipeline_status: 'PARTIAL_BLOCKED',
      canonical_resolved: true,
      reject_reasons: { 'media absent': 1 },
      runtime_certified: false,
      provider_runtime_status: 'BLOCKED',
      provider_runtime_reason: 'pipeline_partial_blocked',
      certification_reason: null,
    });
  });

  test('preuve runtime + accounting équilibré terminent la certification', () => {
    const projection = runs.buildProjection({
      run: baseRun(),
      rows: rows3(),
      sourceProof: { certified_at: T1, capture_id: 'cap-1' },
    });
    expect(stage(projection, 'CERTIFICATION').status).toBe('COMPLETED');
    expect(stage(projection, 'CATALOGUE').status).toBe('RUNNING');
    expect(projection.accounting.awaiting_catalogue_promotion).toBe(3);
    expect(projection.status).toBe('COMPLETED');
    expect(projection.progress_pct).toBe(100);
  });

  test('preuve d’une autre capture bloque uniquement le rail fournisseur', () => {
    const projection = runs.buildProjection({
      run: baseRun(),
      rows: rows3(),
      sourceProof: { certified_at: T1, capture_id: 'cap-other' },
    });
    expect(stage(projection, 'CERTIFICATION').status).toBe('COMPLETED');
    expect(stage(projection, 'CATALOGUE').status).toBe('RUNNING');
    expect(projection.diagnostics).toMatchObject({
      provider_runtime_status: 'PENDING',
      provider_runtime_reason: 'provider_runtime_proof_missing',
      runtime_certified: false,
    });
  });

  test('ancien FAILED pipeline_partial_blocked est re-projeté comme lot vivant', () => {
    const projection = runs.buildProjection({
      run: baseRun({
        status: 'FAILED',
        failure_reason: 'pipeline_partial_blocked',
        finished_at: T1,
        source_total: 3,
        intake: {
          recorded_at: T1,
          accepted: 2,
          duplicates: 0,
          rejected: 1,
          quarantined: 0,
          deferred: 0,
          ready_for_refinery: 2,
          certification_blocked: 0,
          pipeline_status: 'PARTIAL_BLOCKED',
          canonical_resolved: true,
          reject_reasons: { 'media absent': 1 },
          capture_id: 'cap-partial',
        },
      }),
      rows: [candidate(1), candidate(2)],
      sourceProof: null,
    });
    expect(projection.status).toBe('COMPLETED');
    expect(projection.failure_reason).toBeNull();
    expect(projection.progress_pct).toBe(100);
    expect(stage(projection, 'CERTIFICATION').status).toBe('COMPLETED');
    expect(stage(projection, 'CATALOGUE').status).toBe('RUNNING');
    expect(projection.current_stage).toBe('CATALOGUE');
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

  test('un run échoué pendant le pull marque Import brut FAILED au lieu de rester RUNNING', () => {
    const projection = runs.buildProjection({
      run: baseRun({
        status: 'FAILED',
        source_total: 0,
        failure_reason: 'supplier_source_empty',
        finished_at: T1,
        stages: {
          SOURCE_CONNECTED: { started_at: T0, finished_at: T1 },
        },
        intake: {},
      }),
      rows: [],
      sourceProof: null,
    });
    expect(projection.status).toBe('FAILED');
    expect(projection.current_stage).toBe('RAW_IMPORT');
    expect(stage(projection, 'SOURCE_CONNECTED').status).toBe('COMPLETED');
    expect(stage(projection, 'RAW_IMPORT')).toMatchObject({
      status: 'FAILED',
      reason: 'supplier_source_empty',
    });
  });

  test('run automatique est déjà COMPLETED à la frontière de décision Catalogue', () => {
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


test('projection live expose la référence métier source sans UUID interne', () => {
  const projection = runs.buildProjection({
    run: {
      run_ref: 'KIR-000001',
      provider: 'CJdropshipping',
      source_type: 'api',
      source_ref: 'api:cj',
      mode: 'normal',
      status: 'RUNNING',
      source_total: 0,
      stages: {},
      intake: {},
      started_at: '2026-09-28T12:00:00Z',
      updated_at: '2026-09-28T12:00:00Z',
    },
    rows: [],
    sourceProof: null,
  });
  expect(projection.source_ref).toBe('api:cj');
  expect(projection).not.toHaveProperty('id');
});
