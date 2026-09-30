'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

jest.mock('../../db', () => ({ query: jest.fn() }));
jest.mock('../../services/import-runtime-runs', () => ({
  failRun: jest.fn(),
  syncRunsForImport: jest.fn(),
  safe: async (fn) => fn(),
}));

const db = require('../../db');
const importRuns = require('../../services/import-runtime-runs');
const {
  SourcingCatalogueHandoffError,
  handoffCertifiedImport,
  handoffImportResult,
} = require('../../services/sourcing-candidate-actions');

function row(id, decision = 'TEST', over = {}) {
  return {
    id,
    state:'scanned',
    product_id:null,
    supplier_name:'Acme',
    supplier_product_id:`SP-${id}`,
    raw_payload:{ source:'unit' },
    normalized_source_contract:{ schema_version:'2' },
    scan_result:{ sourcing_decision:decision },
    rejected_reason:null,
    promotion_status:null,
    promotion_reasons:null,
    findings:null,
    ...over,
  };
}

describe('automatic Sourcing → Catalogue handoff', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    importRuns.syncRunsForImport.mockResolvedValue([]);
    importRuns.failRun.mockResolvedValue(null);
  });

  test('remet automatiquement seulement les candidats SOURCING_CERTIFIED, sans prix', async () => {
    db.query.mockResolvedValueOnce({
      rows:[
        row('c1', 'TEST'),
        row('c2', 'PRIORITY'),
        row('c3', 'WATCH'),
        row('c4', 'EXCLUDED', { state:'rejected', rejected_reason:'interdit' }),
      ],
    });
    const promote = jest.fn().mockResolvedValue({
      product_id:'product-1',
      price_decision:'DEFERRED_TO_PUBLICATION',
    });

    const result = await handoffCertifiedImport('import-1', {
      actorId:'admin-1',
      promote,
    });

    expect(result).toEqual({
      attempted:2,
      catalogued:2,
      already_catalogued:0,
      failed:[],
    });
    expect(promote).toHaveBeenCalledTimes(2);
    for (const call of promote.mock.calls) {
      expect(call[1]).toEqual({ enrichment_mode:'source_only' });
      expect(call[1]).not.toHaveProperty('price_kmf');
      expect(call[2]).toBe('admin-1');
      expect(call[3]).toEqual({ syncRuntime:false });
    }
    expect(importRuns.syncRunsForImport).toHaveBeenCalledWith('import-1', db);
  });

  test('est idempotent : un brouillon déjà imported_to_catalog est compté mais jamais recréé', async () => {
    db.query.mockResolvedValueOnce({
      rows:[row('c1', 'TEST', { state:'imported_to_catalog', product_id:'p1' })],
    });
    const promote = jest.fn();

    await expect(handoffCertifiedImport('import-2', { promote })).resolves.toEqual({
      attempted:0,
      catalogued:0,
      already_catalogued:1,
      failed:[],
    });
    expect(promote).not.toHaveBeenCalled();
    expect(importRuns.syncRunsForImport).toHaveBeenCalledWith('import-2', db);
  });

  test('un échec de matérialisation bloque réellement le passage au lieu de demander un prix humain', async () => {
    db.query
      .mockResolvedValueOnce({ rows:[row('c1', 'TEST')] })
      .mockResolvedValueOnce({ rows:[{ id:'run-1' }] });
    const promote = jest.fn().mockRejectedValueOnce(
      Object.assign(new Error('catalog media failure'), { code:'catalogue_materialization_failed' })
    );

    await expect(handoffCertifiedImport('import-3', { promote })).rejects.toMatchObject({
      name:'SourcingCatalogueHandoffError',
      status:500,
      code:'sourcing_catalogue_handoff_failed',
      details: {
        attempted:1,
        catalogued:0,
        failed:[expect.objectContaining({ candidate_id:'c1', code:'catalogue_materialization_failed' })],
      },
    });
    expect(importRuns.failRun).toHaveBeenCalledWith('run-1', 'catalogue_handoff_failed:1', db);
    expect(importRuns.syncRunsForImport).not.toHaveBeenCalled();
  });

  test('handoffImportResult enrichit la réponse d’import et laisse intactes les erreurs HTTP', async () => {
    db.query.mockResolvedValueOnce({ rows:[row('c1', 'TEST')] });
    const promote = jest.fn().mockResolvedValue({
      product_id:'product-draft',
      price_decision:'DEFERRED_TO_PUBLICATION',
    });

    const ok = await handoffImportResult(
      { status:200, body:{ import_id:'import-4', accepted:1 } },
      'admin',
      { promote }
    );
    expect(ok.body.catalogue_handoff).toEqual({
      attempted:1,
      catalogued:1,
      already_catalogued:0,
      failed:[],
    });

    jest.clearAllMocks();
    const bad = { status:400, body:{ error:'source invalide' } };
    await expect(handoffImportResult(bad, 'admin', { promote })).resolves.toBe(bad);
    expect(db.query).not.toHaveBeenCalled();
  });

  test('erreur typée reste exploitable par les façades HTTP', () => {
    const error = new SourcingCatalogueHandoffError('x', { failed:[] });
    expect(error).toMatchObject({ status:500, code:'sourcing_catalogue_handoff_failed' });
  });
});
