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
      reason: 'automatic_catalogue_handoff_pending',
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

  test('PARTIAL_BLOCKED bloque la source mais laisse le passage continuer vers Catalogue', () => {
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
      reason: 'automatic_catalogue_handoff_pending',
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

describe('import runtime — Action requise (interface d’exception)', () => {
  const intake = (over = {}) => ({
    recorded_at: T1, accepted: 12, duplicates: 0, rejected: 1, quarantined: 0, deferred: 7,
    ready_for_refinery: 12, certification_blocked: 0, pipeline_status: 'CANONICAL_RESOLVED', capture_id: 'cap-1',
    ...over,
  });
  const twelve = () => Array.from({ length: 12 }, (_, i) => candidate(i + 1));
  const deferredRows = () => Array.from({ length: 7 }, (_, i) => candidate(100 + i, { state: 'watchlist' }));

  test('CAS A/D : 20 reçus, 12 prêts, 1 rejet conforme, 7 DEFERRED → aucune action requise', () => {
    const projection = runs.buildProjection({
      run: baseRun({ source_total: 20, intake: intake() }),
      rows: [...twelve(), ...deferredRows()],
    });
    expect(projection.accounting).toMatchObject({
      source_total: 20, certified: 12, catalogued: 0, rejected: 1, deferred: 7, unaccounted: 0,
    });
    expect(projection.accounting.action_required).toBe(0);
    expect(projection.action_items).toEqual([]);
    expect(projection.sourcing_status).toBe('DONE');
  });

  test('CAS E : quarantaine + contrat bloqué → 3 éléments avec raison humaine et action', () => {
    const rows = [
      ...twelve(),
      candidate(201, { state: 'quarantined', promotion_status: 'QUARANTINED_IMAGE_MISSING', product_name: 'Coque A' }),
      candidate(202, { state: 'quarantined', findings: [{ code: 'CATEGORY_AMBIGUOUS' }], product_name: 'Coque B' }),
      candidate(203, { state: 'scanned', normalized_source_contract: null, product_name: 'Coque C' }),
    ];
    const projection = runs.buildProjection({
      run: baseRun({ source_total: 20, intake: intake({ quarantined: 2, certification_blocked: 1, deferred: 4 }) }),
      rows,
    });
    expect(projection.accounting.action_required).toBe(3);
    expect(projection.action_items.map((item) => [item.product_name, item.reason, item.action_label])).toEqual([
      ['Coque A', 'Image inexploitable', 'Corriger'],
      ['Coque B', 'Classement ambigu', 'Choisir'],
      ['Coque C', 'Donnée obligatoire manquante', 'Compléter'],
    ]);
    expect(projection.action_items[0].candidate_ref).toBe('KSC-201');
    expect(projection.sourcing_status).toBe('ACTION_REQUIRED');
  });

  test('CAS F : une correction est recalculée par la projection (3 → 2)', () => {
    const before = [
      ...twelve(),
      candidate(201, { state: 'quarantined', promotion_status: 'QUARANTINED_IMAGE_MISSING' }),
      candidate(202, { state: 'quarantined', findings: [{ code: 'CATEGORY_AMBIGUOUS' }] }),
    ];
    const run = baseRun({ source_total: 16, intake: intake({ quarantined: 2, deferred: 1 }) });
    expect(runs.buildProjection({ run, rows: before }).accounting.action_required).toBe(2);
    const after = runs.buildProjection({
      run: baseRun({ source_total: 16, intake: intake({ quarantined: 1, deferred: 1, ready_for_refinery: 13, accepted: 13 }) }),
      rows: [...twelve(), candidate(201), candidate(202, { state: 'quarantined', findings: [{ code: 'CATEGORY_AMBIGUOUS' }] })],
    });
    expect(after.accounting.action_required).toBe(1);
    expect(after.action_items).toHaveLength(1);
  });

  test('anomalie de comptage réelle → vraie action requise (19/20, 1 à retrouver)', () => {
    const projection = runs.buildProjection({
      run: baseRun({ source_total: 20, intake: intake({ deferred: 6 }) }),
      rows: [...twelve(), ...deferredRows().slice(0, 6)],
    });
    expect(projection.accounting.unaccounted).toBe(1);
    expect(projection.accounting.action_required).toBe(1);
    expect(projection.action_items[0]).toMatchObject({ reason: 'Anomalie de comptage', action_label: 'Examiner' });
    expect(projection.sourcing_status).toBe('ACTION_REQUIRED');
  });

  test('le compteur reste vrai même si la liste ne peut pas nommer le produit', () => {
    const projection = runs.buildProjection({
      run: baseRun({ source_total: 14, intake: intake({ quarantined: 2, deferred: 0, rejected: 0 }) }),
      rows: twelve(),
    });
    expect(projection.accounting.action_required).toBe(2);
    expect(projection.action_items).toHaveLength(2);
    expect(projection.action_items.every((item) => item.candidate_ref === null && item.action === 'examine')).toBe(true);
  });

  test('sourcing_status : LIVE tant que ça tourne, Bloqué seulement si Komerce ne peut plus avancer', () => {
    const running = runs.buildProjection({ run: baseRun({ source_total: 0, intake: {} }), rows: [] });
    expect(running.sourcing_status).toBe('RUNNING');
    const blocked = runs.buildProjection({
      run: baseRun({ status: 'FAILED', failure_reason: 'connector_failed: timeout', source_total: 0, intake: {} }),
      rows: [],
    });
    expect(blocked.sourcing_status).toBe('BLOCKED');
  });
});

describe('import runtime — drill-downs : populations et compteurs cohérents', () => {
  const intake = (over = {}) => ({
    recorded_at: T1, accepted: 12, duplicates: 2, rejected: 1, quarantined: 0, deferred: 5,
    ready_for_refinery: 12, certification_blocked: 0, pipeline_status: 'CANONICAL_RESOLVED', capture_id: 'cap-1',
    ...over,
  });
  const ready = (n, over = {}) => Array.from({ length: n }, (_, i) => candidate(i + 1, over));
  const rejectedRow = (i, over = {}) => candidate(300 + i, { state: 'rejected', rejected_reason: 'excluded by rule', ...over });
  const deferredRows = (n) => Array.from({ length: n }, (_, i) => candidate(100 + i, { state: 'watchlist' }));

  test('CAS A : « Produits reçus » = tous les produits persistés + le reste en groupe explicite', () => {
    const rows = [...ready(12), ...deferredRows(5), rejectedRow(1)];
    const pop = runs.buildPopulation({ kind: 'received', rows, intake: intake(), sourceTotal: 20 });
    expect(pop.total).toBe(20);
    expect(pop.items).toHaveLength(18);
    expect(pop.unlisted).toEqual([{ label: 'Écartés dès la réception (voir Écartés automatiquement)', count: 2 }]);
    expect(pop.items.map((i) => i.issue_label)).toEqual(expect.arrayContaining(['Prêt pour le Catalogue', 'Mis de côté', 'Écarté']));
    expect(JSON.stringify(pop)).not.toMatch(/REFINERY|TAXONOMY|CERTIFICATION/);
  });

  test('CAS B : « Prêts pour le Catalogue » = exactement les produits certified, avec l’état de remise', () => {
    const rows = [...ready(9), ...ready(3).map((r, i) => ({ ...r, candidate_ref: `KSC-C${i}`, supplier_product_id: `SC-${i}`, state: 'imported_to_catalog', product_ref: `P-${i}` })), ...deferredRows(5)];
    const pop = runs.buildPopulation({ kind: 'ready', rows, intake: intake(), sourceTotal: 20 });
    const projection = runs.buildProjection({ run: baseRun({ source_total: 20, intake: intake() }), rows });
    expect(pop.total).toBe(projection.accounting.certified);
    expect(pop.items).toHaveLength(12);
    expect(pop.items.filter((i) => i.issue_label === 'Remis')).toHaveLength(3);
    expect(pop.items.filter((i) => i.issue_label === 'Prêt')).toHaveLength(9);
  });

  test('CAS C : « Écartés automatiquement » = produits écartés + raison lisible, sans CTA de correction', () => {
    const rows = [...ready(12), rejectedRow(1), rejectedRow(2, { rejected_reason: 'doublon' }), ...deferredRows(5)];
    const pop = runs.buildPopulation({ kind: 'discarded', rows, intake: intake({ duplicates: 1, rejected: 2 }), sourceTotal: 20 });
    expect(pop.total).toBe(3);
    expect(pop.items.map((i) => i.issue_label).sort()).toEqual(['Doublon', 'Exclu par règle']);
    expect(pop.unlisted).toEqual([{ label: 'Produit non retenu à la réception', count: 1 }]);
    expect(pop.items.every((i) => i.reason && !('action' in i) && !('action_label' in i))).toBe(true);
    expect(pop.items.length + pop.unlisted.reduce((n, u) => n + u.count, 0)).toBe(pop.total);
  });

  test('kind inconnu → null (la route répond 400)', () => {
    expect(runs.buildPopulation({ kind: 'history', rows: [] })).toBeNull();
    expect(runs.POPULATION_KINDS).toEqual(['received', 'ready', 'discarded']);
  });

  test('CAS F : une étape COMPLETED conserve la mesure observée ; l’UI masque le ratio si ce n’est pas sa preuve de complétion', () => {
    const rows = ready(12, { scan_at: null });
    const projection = runs.buildProjection({
      run: baseRun({
        source_total: 20,
        intake: intake(),
        stages: {
          SOURCE_CONNECTED: { finished_at: T0 }, RAW_IMPORT: { finished_at: T0 }, REFINERY: { finished_at: T1 },
        },
      }),
      rows,
    });
    const refinery = projection.stages.find((s) => s.key === 'REFINERY');
    expect(refinery.status).toBe('COMPLETED');
    expect(refinery.processed).toBe(0);
    expect(refinery.total).toBe(12);
    expect(refinery.metrics).not.toHaveProperty('observed');
    for (const s of projection.stages) expect(s.processed).toBeLessThanOrEqual(s.total || s.processed);
  });
});

describe('import runtime — pagination des passages', () => {
  test('charge une page en 2 requêtes (runs + candidats batch), jamais N+1', async () => {
    const makeRun = (id, ref, startedAt) => ({
      ...baseRun({ run_ref:ref, started_at:startedAt, source_total:3 }),
      id,
    });
    const r1 = makeRun('00000000-0000-4000-8000-000000000001', 'KIR-000010', '2026-09-30T15:00:00Z');
    const r2 = makeRun('00000000-0000-4000-8000-000000000002', 'KIR-000009', '2026-09-30T14:00:00Z');
    const r3 = makeRun('00000000-0000-4000-8000-000000000003', 'KIR-000008', '2026-09-30T13:00:00Z');
    const batchRows = [
      ...rows3().map((row) => ({ ...row, run_id:r1.id })),
      ...rows3().map((row) => ({ ...row, run_id:r2.id })),
    ];
    const q = {
      query: jest.fn(async (sql, args) => {
        if (String(sql).includes('ORDER BY r.started_at DESC')) {
          expect(args).toEqual([3, 10]);
          return { rows:[r1, r2, r3] };
        }
        if (String(sql).includes('ANY($1::uuid[])')) {
          expect(args).toEqual([[r1.id, r2.id]]);
          return { rows:batchRows };
        }
        throw new Error('unexpected query');
      }),
    };

    const page = await runs.listPassages({ limit:2, offset:10 }, q);
    expect(q.query).toHaveBeenCalledTimes(2);
    expect(page.offset).toBe(10);
    expect(page.next_offset).toBe(12);
    expect(page.passages.map((item) => item.run_ref)).toEqual(['KIR-000010', 'KIR-000009']);
  });

  test('voisins d’un KIR sont lus indépendamment de la fenêtre des 12 lots récents', async () => {
    const q = { query: jest.fn().mockResolvedValue({ rows:[{ older_ref:'KIR-000003', newer_ref:'KIR-000005' }] }) };
    await expect(runs.getRunNeighbors('KIR-000004', q)).resolves.toEqual({
      older_ref:'KIR-000003',
      newer_ref:'KIR-000005',
    });
    expect(q.query).toHaveBeenCalledTimes(1);
  });
});

describe('import runtime — passages (historique Sourcing)', () => {
  const intake = (over = {}) => ({
    recorded_at: T1, accepted: 12, duplicates: 0, rejected: 1, quarantined: 0, deferred: 7,
    ready_for_refinery: 12, certification_blocked: 0, pipeline_status: 'CANONICAL_RESOLVED', capture_id: 'cap-1', ...over,
  });
  const twelve = (over = {}) => Array.from({ length: 12 }, (_, i) => candidate(i + 1, over));
  const rest = () => Array.from({ length: 7 }, (_, i) => candidate(100 + i, { state: 'watchlist' }));

  test('ligne Sourcing pure : reçus / prêts / écartés / action requise / remise — jamais de donnée aval', () => {
    const passage = runs.buildPassage(baseRun({ run_ref: 'KIR-000006', source_total: 20, intake: intake() }), [...twelve(), ...rest()]);
    expect(passage).toMatchObject({
      run_ref: 'KIR-000006', source_total: 20, certified: 12, discarded: 1, action_required: 0,
      catalogued: 0, handoff_label: 'En attente', state_label: 'Terminé', sourcing_status: 'DONE',
    });
    expect(Object.keys(passage).join(' ')).not.toMatch(/price|market|approved|commercial|closure|decisions/i);
  });

  test('remise terminée / restent / action requise', () => {
    const done = runs.buildPassage(baseRun({ source_total: 20, intake: intake() }),
      [...twelve({ state: 'imported_to_catalog', product_ref: 'P-1' }), ...rest()]);
    expect(done.handoff_label).toBe('Terminée');
    const rows = [...twelve(), ...rest(),
      candidate(201, { state: 'quarantined', promotion_status: 'QUARANTINED_IMAGE_MISSING' })];
    const action = runs.buildPassage(baseRun({ source_total: 20, intake: intake({ quarantined: 1, deferred: 6 }) }), rows);
    expect(action.action_required).toBe(1);
    expect(action.state_label).toBe('Action requise');
  });
});
