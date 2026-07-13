'use strict';

/**
 * tests/unit/sourcing-scanner.test.js
 *
 * Tests du router routes/sourcing-scanner.js (scanner catalogue fournisseur)
 *
 * Couverture (invariants critiques, pas de logique métier interne re-testée) :
 *   ✓ accès admin requis sur tous les endpoints
 *   ✓ GET /connectors : liste csv/manual actifs + état des connecteurs API (noon inactif)
 *   ✓ POST /catalogs/import : délègue au catalog-import-orchestrator avec le bon dispatcher
 *   ✓ PUT /candidates/:id : 400 si aucun champ autorisé ; 404 si introuvable ;
 *     déclenche la conversion KMF + écrit l'événement audit 'data_correction' si purchase_price/currency change
 *   ✓ POST /candidates/:id/scan : 404 si introuvable, sinon scan + UPDATE + event 'scan'
 *   ✓ POST /candidates/scan-batch : 400 si ni import_id ni ids fournis
 *   ✓ POST /candidates/:id/import-product : 404 introuvable, 409 si déjà importé,
 *     400 si aucun prix calculable, produit créé toujours is_active=FALSE
 *   ✓ POST /candidates/:id/reject et /watchlist : 404 si introuvable, sinon transition + event
 */

jest.mock('../../middleware/auth', () => ({
  authenticate: (req, res, next) => { req.user = req.user || { id: 'admin-1', role: 'admin' }; next(); },
}));

const { makeClient } = require('../integration/test-harness/mock-db');

const mockQuery = jest.fn();
const mockGetClient = jest.fn();
jest.mock('../../db', () => ({
  query: (...args) => mockQuery(...args),
  getClient: (...args) => mockGetClient(...args),
}));

const mockScanCandidate = jest.fn();
const mockConvertToKMF = jest.fn();
jest.mock('../../services/supplier-catalog-scanner', () => ({
  scanCandidate: (...args) => mockScanCandidate(...args),
  convertToKMF: (...args) => mockConvertToKMF(...args),
}));

const mockLoadGlobalConfig = jest.fn();
jest.mock('../../services/pricing-engine', () => ({
  loadGlobalConfig: (...args) => mockLoadGlobalConfig(...args),
}));

const mockImportCatalog = jest.fn();
jest.mock('../../services/suppliers/catalog-import-orchestrator', () => ({
  importCatalog: (...args) => mockImportCatalog(...args),
}));

// K-3 — l'étage ⑤ est testé dans catalog-enrichment.test.js ; ici on vérifie
// seulement le câblage (appelé avec le bon productId, résultat exposé).
const mockEnrichAndApply = jest.fn();
jest.mock('../../services/catalog-enrichment', () => ({
  enrichAndApply: (...args) => mockEnrichAndApply(...args),
}));

jest.mock('../../services/suppliers/connectors/csv-connector', () => ({ fetchProducts: jest.fn() }));
jest.mock('../../services/suppliers/connectors/manual-connector', () => ({ fetchProducts: jest.fn() }));
jest.mock('../../services/suppliers/connectors/noon-connector', () => ({ IS_ACTIVE: false, INACTIVE_REASON: 'Non implémenté' }));

const csvConnector = require('../../services/suppliers/connectors/csv-connector');
const manualConnector = require('../../services/suppliers/connectors/manual-connector');

const express = require('express');
const request = require('supertest');

let app;
let currentUser;

beforeEach(() => {
  jest.clearAllMocks();
  currentUser = { id: 'admin-1', role: 'admin' };
  mockLoadGlobalConfig.mockResolvedValue({ finance: {} });

  app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.user = currentUser; next(); });

  jest.isolateModules(() => {
    const router = require('../../routes/sourcing-scanner');
    app.use('/api/admin/sourcing', router);
  });
});

describe('sourcing-scanner — accès', () => {
  it('refuse un non-admin', async () => {
    currentUser = { id: 'u1', role: 'agent_hub' };
    const res = await request(app).get('/api/admin/sourcing/connectors');
    expect(res.status).toBe(403);
  });
});

describe('sourcing-scanner — GET /connectors', () => {
  it('liste csv/manual actifs et le connecteur noon inactif avec sa raison', async () => {
    const res = await request(app).get('/api/admin/sourcing/connectors');
    expect(res.status).toBe(200);
    expect(res.body.sources).toEqual([
      { type: 'csv', active: true, label: 'CSV import' },
      { type: 'manual', active: true, label: 'Saisie manuelle' },
    ]);
    expect(res.body.api_suppliers).toEqual([
      { supplier: 'noon', active: false, label: 'Noon API', reason: 'Non implémenté' },
    ]);
  });
});

describe('sourcing-scanner — POST /catalogs/import', () => {
  it('délègue à catalogImportOrchestrator.importCatalog avec le dispatcher', async () => {
    mockImportCatalog.mockResolvedValueOnce({ status: 200, body: { imported: 5 } });

    const res = await request(app)
      .post('/api/admin/sourcing/catalogs/import')
      .send({ source_type: 'csv', supplier_name: 'Fournisseur X' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ imported: 5 });
    expect(mockImportCatalog).toHaveBeenCalledWith(
      expect.objectContaining({ source_type: 'csv' }),
      'admin-1',
      expect.any(Function)
    );
  });
});

describe('sourcing-scanner — PUT /candidates/:id', () => {
  it('400 si aucun champ autorisé fourni', async () => {
    const res = await request(app).put('/api/admin/sourcing/candidates/c1').send({ unknown_field: 1 });
    expect(res.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('404 si le candidat est introuvable', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE ... RETURNING * → vide

    const res = await request(app).put('/api/admin/sourcing/candidates/c-404').send({ notes: 'x' });

    expect(res.status).toBe(404);
  });

  // ING-5 (verrou 2, doctrine ING-I2) — une devise hors whitelist ne doit plus
  // jamais pouvoir produire un purchase_price_kmf faux (ex: GBP traité comme KMF).
  it('400 si currency fournie est hors whitelist (ex: GBP)', async () => {
    const res = await request(app).put('/api/admin/sourcing/candidates/c1').send({ currency: 'GBP' });
    expect(res.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('déclenche la conversion KMF et l\'audit "data_correction" quand purchase_price change', async () => {
    mockConvertToKMF.mockReturnValueOnce(45000);
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'c1', purchase_price_kmf: 45000 }] }) // UPDATE RETURNING *
      .mockResolvedValueOnce({ rows: [] });                                       // INSERT event

    const res = await request(app)
      .put('/api/admin/sourcing/candidates/c1')
      .send({ purchase_price: 100, currency: 'EUR' });

    expect(res.status).toBe(200);
    expect(mockLoadGlobalConfig).toHaveBeenCalled();
    expect(mockConvertToKMF).toHaveBeenCalledWith(100, 'EUR', {});
    const updateSql = mockQuery.mock.calls[0][0];
    expect(updateSql).toMatch(/purchase_price_kmf = \$/);
    const auditCall = mockQuery.mock.calls[1];
    expect(auditCall[0]).toMatch(/INSERT INTO sourcing_candidate_events/);
    expect(auditCall[0]).toMatch(/'data_correction'/);
  });
});

describe('sourcing-scanner — POST /candidates/:id/scan', () => {
  it('404 si le candidat est introuvable', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).post('/api/admin/sourcing/candidates/c-404/scan');
    expect(res.status).toBe(404);
    expect(mockScanCandidate).not.toHaveBeenCalled();
  });

  it('scanne, met à jour le candidat et journalise un événement "scan"', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'c1' }] })                  // SELECT candidate
      .mockResolvedValueOnce({ rows: [{ id: 'c1', state: 'scanned' }] }) // UPDATE
      .mockResolvedValueOnce({ rows: [] });                              // INSERT event
    mockScanCandidate.mockResolvedValueOnce({
      scan_result: { foo: 'bar' }, sourcing_decision: 'go', reason: 'ok', recommended_action: 'import', confidence: 'high',
    });

    const res = await request(app).post('/api/admin/sourcing/candidates/c1/scan');

    expect(res.status).toBe(200);
    expect(res.body.candidate.state).toBe('scanned');
    expect(mockQuery.mock.calls[2][0]).toMatch(/'scan'/);
  });
});

describe('sourcing-scanner — POST /candidates/scan-batch', () => {
  it('400 si ni import_id ni ids fourni', async () => {
    const res = await request(app).post('/api/admin/sourcing/candidates/scan-batch').send({});
    expect(res.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe('sourcing-scanner — POST /candidates/:id/import-product', () => {
  // Lot 6 (PDC-8) — la route ouvre une transaction dédiée (db.getClient()) :
  // toute la séquence (SELECT candidat inclus) passe désormais par client.query,
  // plus par db.query. `client.calls` sert de trace pour les assertions.

  it('404 si le candidat est introuvable', async () => {
    const client = makeClient([{ rows: [] }]);
    mockGetClient.mockResolvedValue(client);

    const res = await request(app).post('/api/admin/sourcing/candidates/c-404/import-product');
    expect(res.status).toBe(404);
    expect(client.release).toHaveBeenCalled();
  });

  it('409 si déjà importé avec un product_id', async () => {
    const client = makeClient([{ rows: [{ state: 'imported_to_catalog', product_id: 'p1' }] }]);
    mockGetClient.mockResolvedValue(client);

    const res = await request(app).post('/api/admin/sourcing/candidates/c1/import-product');
    expect(res.status).toBe(409);
    expect(res.body.product_id).toBe('p1');
  });

  // ING-5 (verrou 1, doctrine ING-I5) — une exclusion absolue est terminale partout.
  it('409 si le candidat est à l\'état "rejected" (rejet manuel ou auto-exclusion)', async () => {
    const client = makeClient([{ rows: [{ state: 'rejected', scan_result: {} }] }]);
    mockGetClient.mockResolvedValue(client);

    const res = await request(app).post('/api/admin/sourcing/candidates/c1/import-product');
    expect(res.status).toBe(409);
    expect(mockScanCandidate).not.toHaveBeenCalled();
  });

  it('409 si scan_result.sourcing_decision vaut "EXCLUDED" même si le state n\'est pas "rejected"', async () => {
    const client = makeClient([{ rows: [{ state: 'scanned', scan_result: { sourcing_decision: 'EXCLUDED' } }] }]);
    mockGetClient.mockResolvedValue(client);

    const res = await request(app).post('/api/admin/sourcing/candidates/c1/import-product');
    expect(res.status).toBe(409);
  });

  it('400 si aucun prix calculable', async () => {
    const client = makeClient([{ rows: [{ state: 'scanned', scan_result: {} }] }]);
    mockGetClient.mockResolvedValue(client);

    const res = await request(app).post('/api/admin/sourcing/candidates/c1/import-product');
    expect(res.status).toBe(400);
  });

  it('crée le produit toujours en is_active=FALSE même avec un prix fourni explicitement', async () => {
    const client = makeClient([
      { rows: [{ state: 'scanned', scan_result: {}, product_name: 'X', description: 'desc EN', komerce_category: 'mode', purchase_price_kmf: 1000, normalized_source_contract: null }] },
      { rows: [{ id: 'prod-1' }] }, // INSERT products
      { rows: [] },                 // UPDATE candidate
      { rows: [] },                 // INSERT event
    ]);
    mockGetClient.mockResolvedValue(client);
    mockEnrichAndApply.mockResolvedValue({ status: 'ok', confidence: 0.9 });

    const res = await request(app)
      .post('/api/admin/sourcing/candidates/c1/import-product')
      .send({ price_kmf: 5000 });

    expect(res.status).toBe(200);
    expect(res.body.product_id).toBe('prod-1');
    expect(res.body.promotion).toEqual({ promoted: false, reason: 'v1_legacy' });
    const insertSql = client.calls.find((c) => /INSERT INTO products/.test(c.sql)).sql;
    expect(insertSql).toMatch(/FALSE, 'candidate'/);
    expect(client.calls.map((c) => c.sql.trim())).toContain('COMMIT');
    expect(client.release).toHaveBeenCalled();
  });

  it('persiste la donnée source à l\'import (DOCTRINE_CATALOGUE §7) et câble l\'étage ⑤', async () => {
    const client = makeClient([
      { rows: [{ state: 'scanned', scan_result: {}, product_name: 'Power Bank EN', description: 'desc EN', komerce_category: 'tech', purchase_price_kmf: 1000, normalized_source_contract: null }] },
      { rows: [{ id: 'prod-2' }] },
      { rows: [] },
      { rows: [] },
    ]);
    mockGetClient.mockResolvedValue(client);
    mockEnrichAndApply.mockResolvedValue({ status: 'low_confidence', confidence: 0.6, needsReview: true });

    const res = await request(app)
      .post('/api/admin/sourcing/candidates/c1/import-product')
      .send({ price_kmf: 5000 });

    expect(res.status).toBe(200);
    const insertCall = client.calls.find((c) => /INSERT INTO products/.test(c.sql));
    expect(insertCall.sql).toContain('name_source');
    expect(insertCall.sql).toContain("'connector_raw'");
    expect(insertCall.params).toEqual(expect.arrayContaining(['Power Bank EN', 'desc EN', 'en']));
    // câblage étage ⑤ : appelé avec le produit créé, résultat exposé au client, APRÈS le commit
    expect(mockEnrichAndApply).toHaveBeenCalledWith('prod-2');
    expect(res.body.enrichment).toEqual(expect.objectContaining({ status: 'low_confidence' }));
  });

  it('PDC-8 Lot 6 : normalized_source_contract V2 présent → promotion appelée dans la même transaction', async () => {
    const contract = {
      schema_version: '2',
      media: [],
      option_axes: [],
      sellable_units: [],
    };
    // sellable_units: [] serait rejeté par promoteCatalog (aucune sellable_unit
    // exploitable) — on utilise ici un contrat sans sellable_units du tout
    // (undefined) pour rester V2 valide sans SKU, et vérifier le câblage.
    delete contract.sellable_units;

    const client = makeClient([
      { rows: [{ state: 'scanned', scan_result: {}, product_name: 'Robe', purchase_price_kmf: 1000, normalized_source_contract: contract }] },
      { rows: [{ id: 'prod-5' }] }, // INSERT products
      { rows: [] },                  // SELECT product_skus existants (Lot 6, aucun)
      { rows: [] },                  // UPDATE candidate
      { rows: [] },                  // INSERT event
    ]);
    mockGetClient.mockResolvedValue(client);
    mockEnrichAndApply.mockResolvedValue({ status: 'ok' });

    const res = await request(app)
      .post('/api/admin/sourcing/candidates/c1/import-product')
      .send({ price_kmf: 5000 });

    expect(res.status).toBe(200);
    expect(res.body.promotion).toEqual({ promoted: true, media: 0, variants: 0, skus: { count: 0 }, skuMediaLinks: 0 });
  });

  it('rollback si la promotion catalogue échoue (contrat invalide) — produit non commité', async () => {
    const contract = { schema_version: '2', media: [], option_axes: [], sellable_units: [] }; // rejeté : vide explicite
    const client = makeClient([
      { rows: [{ state: 'scanned', scan_result: {}, product_name: 'Robe', purchase_price_kmf: 1000, normalized_source_contract: contract }] },
      { rows: [{ id: 'prod-6' }] }, // INSERT products
    ]);
    mockGetClient.mockResolvedValue(client);

    const res = await request(app)
      .post('/api/admin/sourcing/candidates/c1/import-product')
      .send({ price_kmf: 5000 });

    expect([422, 500]).toContain(res.status);
    expect(client.calls.map((c) => c.sql.trim())).toContain('ROLLBACK');
    expect(client.calls.map((c) => c.sql.trim())).not.toContain('COMMIT');
    expect(mockEnrichAndApply).not.toHaveBeenCalled();
    expect(client.release).toHaveBeenCalled();
  });
});

describe('sourcing-scanner — POST /candidates/:id/reject et /watchlist', () => {
  it('reject : 404 si introuvable', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).post('/api/admin/sourcing/candidates/c-404/reject').send({ reason: 'bad' });
    expect(res.status).toBe(404);
  });

  it('reject : transition vers "rejected" + audit', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ state: 'scanned' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app).post('/api/admin/sourcing/candidates/c1/reject').send({ reason: 'Prix trop élevé' });

    expect(res.status).toBe(200);
    expect(mockQuery.mock.calls[1][0]).toMatch(/state='rejected'/);
  });

  it('watchlist : 404 si introuvable', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).post('/api/admin/sourcing/candidates/c-404/watchlist');
    expect(res.status).toBe(404);
  });

  it('watchlist : transition vers "watchlist" + audit', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ state: 'scanned' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app).post('/api/admin/sourcing/candidates/c1/watchlist');

    expect(res.status).toBe(200);
    expect(mockQuery.mock.calls[1][0]).toMatch(/state='watchlist'/);
  });
});

describe('sourcing-scanner — dispatchToConnector (passé à catalogImportOrchestrator)', () => {
  // Le dispatcher est une fonction interne non exportée : on la récupère telle
  // que le router la passe en 3e argument à importCatalog(), puis on l'invoque
  // directement pour couvrir chacune de ses branches (source_type).
  async function getDispatcher(sourceTypeBody) {
    mockImportCatalog.mockResolvedValueOnce({ status: 200, body: {} });
    await request(app).post('/api/admin/sourcing/catalogs/import').send(sourceTypeBody);
    return mockImportCatalog.mock.calls[mockImportCatalog.mock.calls.length - 1][2];
  }

  it('source_type=csv → délègue à csvConnector.fetchProducts avec les bons champs', async () => {
    const dispatch = await getDispatcher({ source_type: 'csv', supplier_name: 'X', csv_text: 'a,b', csv_mapping: { a: 1 } });
    csvConnector.fetchProducts.mockResolvedValueOnce([{ id: 1 }]);

    const result = await dispatch({ source_type: 'csv', supplier_name: 'X', csv_text: 'a,b', csv_mapping: { a: 1 } });

    expect(csvConnector.fetchProducts).toHaveBeenCalledWith({
      supplier_name: 'X', csv_text: 'a,b', csv_mapping: { a: 1 },
    });
    expect(result).toEqual([{ id: 1 }]);
  });

  it('source_type=manual → délègue à manualConnector.fetchProducts', async () => {
    const dispatch = await getDispatcher({ source_type: 'manual', supplier_name: 'Y', items: [{ x: 1 }] });
    manualConnector.fetchProducts.mockResolvedValueOnce([{ id: 2 }]);

    const result = await dispatch({ source_type: 'manual', supplier_name: 'Y', items: [{ x: 1 }] });

    expect(manualConnector.fetchProducts).toHaveBeenCalledWith({ supplier_name: 'Y', items: [{ x: 1 }] });
    expect(result).toEqual([{ id: 2 }]);
  });

  it('source_type absent → traité comme "manual" par défaut', async () => {
    const dispatch = await getDispatcher({});
    manualConnector.fetchProducts.mockResolvedValueOnce([]);

    await dispatch({});

    expect(manualConnector.fetchProducts).toHaveBeenCalled();
  });

  it('source_type=api sans supplier_id → traité comme chaîne vide, supplier inconnu', async () => {
    const dispatch = await getDispatcher({ source_type: 'api' });

    await expect(dispatch({ source_type: 'api' })).rejects.toThrow(/supplier "" inconnu/);
  });

  it('source_type=api avec supplier inconnu → lève une erreur explicite', async () => {
    const dispatch = await getDispatcher({ source_type: 'api', supplier_id: 'inconnu' });

    await expect(dispatch({ source_type: 'api', supplier_id: 'inconnu' }))
      .rejects.toThrow(/supplier "inconnu" inconnu/);
  });

  it('source_type=api avec supplier connu mais inactif (noon) → lève avec la raison', async () => {
    const dispatch = await getDispatcher({ source_type: 'api', supplier_id: 'noon' });

    await expect(dispatch({ source_type: 'api', supplier_id: 'noon' }))
      .rejects.toThrow(/Non implémenté/);
  });

  it('source_type inconnu (ni csv/manual/api) → lève une erreur explicite', async () => {
    const dispatch = await getDispatcher({ source_type: 'ftp' });

    await expect(dispatch({ source_type: 'ftp' })).rejects.toThrow(/source_type inconnu : "ftp"/);
  });

  it('POST /catalogs/import : erreur du dispatcher/orchestrateur → next(err) → 500', async () => {
    mockImportCatalog.mockRejectedValueOnce(new Error('orchestrator down'));
    const res = await request(app).post('/api/admin/sourcing/catalogs/import').send({ source_type: 'csv' });
    expect(res.status).toBe(500);
  });
});

describe('sourcing-scanner — GET /catalogs', () => {
  it('liste les imports avec compteurs items_count/imported_count, limit par défaut 50', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'imp1', items_count: '10', imported_count: '3' }] });

    const res = await request(app).get('/api/admin/sourcing/catalogs');

    expect(res.status).toBe(200);
    expect(res.body.imports).toEqual([{ id: 'imp1', items_count: '10', imported_count: '3' }]);
    expect(mockQuery.mock.calls[0][1]).toEqual([50]);
  });

  it('plafonne limit à 200', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await request(app).get('/api/admin/sourcing/catalogs?limit=9999');
    expect(mockQuery.mock.calls[0][1]).toEqual([200]);
  });

  it('erreur DB → next(err) → 500', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'));
    const res = await request(app).get('/api/admin/sourcing/catalogs');
    expect(res.status).toBe(500);
  });
});

describe('sourcing-scanner — GET /candidates (filtres)', () => {
  it('défaut : exclut rejected/archived, limit 100', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await request(app).get('/api/admin/sourcing/candidates');
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/state NOT IN \('rejected', 'archived'\)/);
    expect(params).toEqual([100]);
  });

  it('plafonne limit à 500', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await request(app).get('/api/admin/sourcing/candidates?limit=99999');
    expect(mockQuery.mock.calls[0][1]).toEqual([500]);
  });

  it('state=all → aucun filtre de state', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await request(app).get('/api/admin/sourcing/candidates?state=all');
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).not.toMatch(/state NOT IN/);
    expect(sql).not.toMatch(/state = \$/);
  });

  it('state=<valeur> → filtre explicite', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await request(app).get('/api/admin/sourcing/candidates?state=watchlist');
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/state = \$1/);
    expect(params[0]).toBe('watchlist');
  });

  it('filtre supplier (ILIKE)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await request(app).get('/api/admin/sourcing/candidates?supplier=Ali');
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/supplier_name ILIKE/);
    expect(params).toContain('%Ali%');
  });

  it('filtre decision (scan_result->>sourcing_decision)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await request(app).get('/api/admin/sourcing/candidates?decision=go');
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/sourcing_decision/);
    expect(params).toContain('go');
  });

  it('filtre import_id', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await request(app).get('/api/admin/sourcing/candidates?import_id=imp-1');
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/import_id = \$/);
    expect(params).toContain('imp-1');
  });

  it('combine tous les filtres avec la numérotation $N correcte', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'c1' }] });
    const res = await request(app).get(
      '/api/admin/sourcing/candidates?state=watchlist&supplier=Ali&decision=go&import_id=imp-1&limit=10'
    );
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/state = \$1/);
    expect(sql).toMatch(/supplier_name ILIKE \$2/);
    expect(sql).toMatch(/sourcing_decision'\s*=\s*\$3/);
    expect(sql).toMatch(/import_id = \$4/);
    expect(params).toEqual(['watchlist', '%Ali%', 'go', 'imp-1', 10]);
  });

  it('erreur DB → next(err) → 500', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'));
    const res = await request(app).get('/api/admin/sourcing/candidates');
    expect(res.status).toBe(500);
  });
});

describe('sourcing-scanner — GET /candidates/:id', () => {
  it('404 si le candidat est introuvable', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/api/admin/sourcing/candidates/c-404');
    expect(res.status).toBe(404);
  });

  it('renvoie le candidat + ses événements (limités à 50, triés desc)', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'c1', state: 'scanned' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'ev1', event_type: 'scan' }] });

    const res = await request(app).get('/api/admin/sourcing/candidates/c1');

    expect(res.status).toBe(200);
    expect(res.body.candidate).toEqual({ id: 'c1', state: 'scanned' });
    expect(res.body.events).toEqual([{ id: 'ev1', event_type: 'scan' }]);
    expect(mockQuery.mock.calls[1][0]).toMatch(/ORDER BY created_at DESC LIMIT 50/);
  });

  it('erreur DB → next(err) → 500', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'));
    const res = await request(app).get('/api/admin/sourcing/candidates/c1');
    expect(res.status).toBe(500);
  });
});

describe('sourcing-scanner — PUT /candidates/:id (erreur)', () => {
  it('erreur DB → next(err) → 500', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'));
    const res = await request(app).put('/api/admin/sourcing/candidates/c1').send({ notes: 'x' });
    expect(res.status).toBe(500);
  });
});

describe('sourcing-scanner — POST /candidates/:id/scan (erreur)', () => {
  it('erreur DB → next(err) → 500', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'));
    const res = await request(app).post('/api/admin/sourcing/candidates/c1/scan');
    expect(res.status).toBe(500);
  });
});

describe('sourcing-scanner — POST /candidates/scan-batch (exécution)', () => {
  it('branche import_id : filtre par import_id', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockLoadGlobalConfig.mockResolvedValueOnce({ finance: {} });

    const res = await request(app).post('/api/admin/sourcing/candidates/scan-batch').send({ import_id: 'imp-1' });

    expect(res.status).toBe(200);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/import_id = \$1/);
    expect(params).toEqual(['imp-1']);
  });

  it('branche ids[] : filtre par tableau d\'ids', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockLoadGlobalConfig.mockResolvedValueOnce({ finance: {} });

    const res = await request(app).post('/api/admin/sourcing/candidates/scan-batch').send({ ids: ['a', 'b'] });

    expect(res.status).toBe(200);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/id = ANY\(\$1::uuid\[\]\)/);
    expect(params).toEqual([['a', 'b']]);
  });

  it('scanne chaque candidat, incrémente scanned, journalise les erreurs individuelles sans interrompre le batch', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'c1' }, { id: 'c2' }] }) // SELECT batch
      .mockResolvedValueOnce({ rows: [] })                            // UPDATE c1
      // pas de mock pour c2 → mockScanCandidate va rejeter pour c2
      ;
    mockLoadGlobalConfig.mockResolvedValueOnce({ finance: {} });
    mockScanCandidate
      .mockResolvedValueOnce({ scan_result: {}, sourcing_decision: 'go', reason: 'ok', recommended_action: 'import', confidence: 'high' })
      .mockRejectedValueOnce(new Error('scan failed for c2'));

    const res = await request(app).post('/api/admin/sourcing/candidates/scan-batch').send({ import_id: 'imp-1' });

    expect(res.status).toBe(200);
    expect(res.body.scanned).toBe(1);
    expect(res.body.errors).toEqual([{ id: 'c2', error: 'scan failed for c2' }]);
  });

  it('erreur DB au niveau du SELECT batch → next(err) → 500', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'));
    const res = await request(app).post('/api/admin/sourcing/candidates/scan-batch').send({ import_id: 'imp-1' });
    expect(res.status).toBe(500);
  });
});

describe('sourcing-scanner — POST /candidates/:id/import-product (erreur)', () => {
  it('erreur DB → next(err) → 500', async () => {
    const client = makeClient([{ error: new Error('db down') }]);
    mockGetClient.mockResolvedValue(client);
    const res = await request(app).post('/api/admin/sourcing/candidates/c1/import-product');
    expect(res.status).toBe(500);
    expect(client.release).toHaveBeenCalled();
  });
});

describe('sourcing-scanner — POST /candidates/:id/reject (erreur)', () => {
  it('erreur DB → next(err) → 500', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'));
    const res = await request(app).post('/api/admin/sourcing/candidates/c1/reject').send({ reason: 'x' });
    expect(res.status).toBe(500);
  });
});

describe('sourcing-scanner — GET /connectors (erreur)', () => {
  it('erreur de sérialisation → next(err) → 500', async () => {
    // Pas d'I/O dans ce handler (juste de la construction JSON synchrone) :
    // on force le catch en faisant échouer res.json() pour cette seule requête.
    const brokenApp = express();
    brokenApp.use(express.json());
    brokenApp.use((req, res, next) => {
      req.user = { id: 'admin-1', role: 'admin' };
      const realJson = res.json.bind(res);
      res.json = () => { throw new Error('serialization boom'); };
      res.json.restore = realJson;
      next();
    });
    jest.isolateModules(() => {
      const router = require('../../routes/sourcing-scanner');
      brokenApp.use('/api/admin/sourcing', router);
    });

    const res = await request(brokenApp).get('/api/admin/sourcing/connectors');
    expect(res.status).toBe(500);
  });
});

describe('sourcing-scanner — dispatchToConnector — api actif mais non câblé', () => {
  it('supplier connu et actif (hypothétique) → erreur explicite "déclaré mais non câblé" ; GET /connectors reflète active=true, reason=null', async () => {
    jest.resetModules();
    jest.doMock('../../services/suppliers/connectors/noon-connector', () => ({
      IS_ACTIVE: true,
      INACTIVE_REASON: null,
    }));
    jest.doMock('../../middleware/auth', () => ({
      authenticate: (req, res, next) => { req.user = { id: 'admin-1', role: 'admin' }; next(); },
    }));
    jest.doMock('../../db', () => ({ query: (...a) => mockQuery(...a), getClient: (...a) => mockGetClient(...a) }));
    jest.doMock('../../services/pricing-engine', () => ({ loadGlobalConfig: (...a) => mockLoadGlobalConfig(...a) }));
    jest.doMock('../../services/suppliers/catalog-import-orchestrator', () => ({ importCatalog: (...a) => mockImportCatalog(...a) }));
    jest.doMock('../../services/supplier-catalog-scanner', () => ({ scanCandidate: (...a) => mockScanCandidate(...a), convertToKMF: (...a) => mockConvertToKMF(...a) }));
    jest.doMock('../../services/catalog-enrichment', () => ({ enrichAndApply: (...a) => mockEnrichAndApply(...a) }));

    let dispatcher;
    mockImportCatalog.mockResolvedValueOnce({ status: 200, body: {} });

    await jest.isolateModulesAsync(async () => {
      const router = require('../../routes/sourcing-scanner');
      const isolatedApp = express();
      isolatedApp.use(express.json());
      isolatedApp.use((req, res, next) => { req.user = { id: 'admin-1', role: 'admin' }; next(); });
      isolatedApp.use('/api/admin/sourcing', router);

      const connectorsRes = await request(isolatedApp).get('/api/admin/sourcing/connectors');
      expect(connectorsRes.body.api_suppliers).toEqual([
        { supplier: 'noon', active: true, label: 'Noon API', reason: null },
      ]);

      await request(isolatedApp).post('/api/admin/sourcing/catalogs/import').send({ source_type: 'api', supplier_id: 'noon' });
      dispatcher = mockImportCatalog.mock.calls[mockImportCatalog.mock.calls.length - 1][2];
    });

    await expect(dispatcher({ source_type: 'api', supplier_id: 'noon' }))
      .rejects.toThrow(/déclarée mais non câblée/);

    // Restaurer explicitement les mocks d'origine (dontMock renverrait le VRAI
    // module non mocké pour les requires suivants, pas le mock de tête de fichier).
    jest.doMock('../../services/suppliers/connectors/noon-connector', () => ({
      IS_ACTIVE: false, INACTIVE_REASON: 'Non implémenté',
    }));
    jest.doMock('../../middleware/auth', () => ({
      authenticate: (req, res, next) => { req.user = req.user || { id: 'admin-1', role: 'admin' }; next(); },
    }));
    jest.doMock('../../db', () => ({ query: (...a) => mockQuery(...a), getClient: (...a) => mockGetClient(...a) }));
    jest.doMock('../../services/pricing-engine', () => ({ loadGlobalConfig: (...a) => mockLoadGlobalConfig(...a) }));
    jest.doMock('../../services/suppliers/catalog-import-orchestrator', () => ({ importCatalog: (...a) => mockImportCatalog(...a) }));
    jest.doMock('../../services/supplier-catalog-scanner', () => ({ scanCandidate: (...a) => mockScanCandidate(...a), convertToKMF: (...a) => mockConvertToKMF(...a) }));
    jest.doMock('../../services/catalog-enrichment', () => ({ enrichAndApply: (...a) => mockEnrichAndApply(...a) }));
  });

  it('supplier inactif sans raison déclarée → repli "connecteur inactif"', async () => {
    jest.resetModules();
    jest.doMock('../../services/suppliers/connectors/noon-connector', () => ({
      IS_ACTIVE: false,
      INACTIVE_REASON: undefined,
    }));
    jest.doMock('../../middleware/auth', () => ({
      authenticate: (req, res, next) => { req.user = { id: 'admin-1', role: 'admin' }; next(); },
    }));
    jest.doMock('../../db', () => ({ query: (...a) => mockQuery(...a), getClient: (...a) => mockGetClient(...a) }));
    jest.doMock('../../services/pricing-engine', () => ({ loadGlobalConfig: (...a) => mockLoadGlobalConfig(...a) }));
    jest.doMock('../../services/suppliers/catalog-import-orchestrator', () => ({ importCatalog: (...a) => mockImportCatalog(...a) }));
    jest.doMock('../../services/supplier-catalog-scanner', () => ({ scanCandidate: (...a) => mockScanCandidate(...a), convertToKMF: (...a) => mockConvertToKMF(...a) }));
    jest.doMock('../../services/catalog-enrichment', () => ({ enrichAndApply: (...a) => mockEnrichAndApply(...a) }));

    let dispatcher;
    mockImportCatalog.mockResolvedValueOnce({ status: 200, body: {} });

    await jest.isolateModulesAsync(async () => {
      const router = require('../../routes/sourcing-scanner');
      const isolatedApp = express();
      isolatedApp.use(express.json());
      isolatedApp.use((req, res, next) => { req.user = { id: 'admin-1', role: 'admin' }; next(); });
      isolatedApp.use('/api/admin/sourcing', router);
      await request(isolatedApp).post('/api/admin/sourcing/catalogs/import').send({ source_type: 'api', supplier_id: 'noon' });
      dispatcher = mockImportCatalog.mock.calls[mockImportCatalog.mock.calls.length - 1][2];
    });

    await expect(dispatcher({ source_type: 'api', supplier_id: 'noon' }))
      .rejects.toThrow(/connecteur inactif/);

    jest.doMock('../../services/suppliers/connectors/noon-connector', () => ({
      IS_ACTIVE: false, INACTIVE_REASON: 'Non implémenté',
    }));
    jest.doMock('../../middleware/auth', () => ({
      authenticate: (req, res, next) => { req.user = req.user || { id: 'admin-1', role: 'admin' }; next(); },
    }));
    jest.doMock('../../db', () => ({ query: (...a) => mockQuery(...a), getClient: (...a) => mockGetClient(...a) }));
    jest.doMock('../../services/pricing-engine', () => ({ loadGlobalConfig: (...a) => mockLoadGlobalConfig(...a) }));
    jest.doMock('../../services/suppliers/catalog-import-orchestrator', () => ({ importCatalog: (...a) => mockImportCatalog(...a) }));
    jest.doMock('../../services/supplier-catalog-scanner', () => ({ scanCandidate: (...a) => mockScanCandidate(...a), convertToKMF: (...a) => mockConvertToKMF(...a) }));
    jest.doMock('../../services/catalog-enrichment', () => ({ enrichAndApply: (...a) => mockEnrichAndApply(...a) }));
  });
});

describe('sourcing-scanner — branches fallback défensifs (req.user sans id, valeurs absentes)', () => {
  it('PUT /candidates/:id : currency absente du body mais présente en DB → repli sur la currency DB (toujours valide)', async () => {
    mockConvertToKMF.mockReturnValueOnce(1000);
    mockQuery
      .mockResolvedValueOnce({ rows: [{ currency: 'EUR' }] })          // SELECT currency → présente en DB
      .mockResolvedValueOnce({ rows: [{ id: 'c1' }] })                 // UPDATE RETURNING *
      .mockResolvedValueOnce({ rows: [] });                            // INSERT event

    const res = await request(app).put('/api/admin/sourcing/candidates/c1').send({ purchase_price: 50 });

    expect(res.status).toBe(200);
    expect(mockConvertToKMF).toHaveBeenCalledWith(50, 'EUR', {});
  });

  it('PUT /candidates/:id : currency absente et ligne DB sans currency → 400 explicite (ING-I2 : jamais de défaut fabriqué)', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{}] });                          // SELECT currency → pas de champ currency

    const res = await request(app).put('/api/admin/sourcing/candidates/c1').send({ purchase_price: 50 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/devise introuvable/i);
    expect(mockConvertToKMF).not.toHaveBeenCalled();
  });

  it('PUT /candidates/:id : purchase_price absent mais currency fournie → repli sur le prix DB', async () => {
    mockConvertToKMF.mockReturnValueOnce(2000);
    mockQuery
      .mockResolvedValueOnce({ rows: [{ purchase_price: 80 }] })       // SELECT purchase_price
      .mockResolvedValueOnce({ rows: [{ id: 'c1' }] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app).put('/api/admin/sourcing/candidates/c1').send({ currency: 'USD' });

    expect(res.status).toBe(200);
    expect(mockConvertToKMF).toHaveBeenCalledWith(80, 'USD', {});
  });

  it('PUT /candidates/:id : notes absentes → audit avec notes=null ; req.user sans id → updated_by=null', async () => {
    currentUser = { role: 'admin' }; // pas d'id
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'c1' }] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app).put('/api/admin/sourcing/candidates/c1').send({ product_name: 'X' });

    expect(res.status).toBe(200);
    const updateParams = mockQuery.mock.calls[0][1];
    expect(updateParams).toContain(null); // updated_by fallback
    const auditParams = mockQuery.mock.calls[1][1];
    expect(auditParams[2]).toBeNull(); // notes fallback
    expect(auditParams[3]).toBeNull(); // triggered_by fallback
  });

  it('POST /candidates/:id/scan : req.user sans id → updated_by/triggered_by=null', async () => {
    currentUser = { role: 'admin' };
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'c1' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'c1', state: 'scanned' }] })
      .mockResolvedValueOnce({ rows: [] });
    mockScanCandidate.mockResolvedValueOnce({ scan_result: {}, sourcing_decision: 'go', reason: 'ok', recommended_action: 'import', confidence: 'high' });

    const res = await request(app).post('/api/admin/sourcing/candidates/c1/scan');

    expect(res.status).toBe(200);
    expect(mockQuery.mock.calls[1][1]).toContain(null);
  });

  it('POST /candidates/:id/import-product : scan_result absent (candidat jamais scanné) → 400 pas de prix', async () => {
    const client = makeClient([{ rows: [{ state: 'raw_imported' }] }]); // pas de scan_result du tout
    mockGetClient.mockResolvedValue(client);
    const res = await request(app).post('/api/admin/sourcing/candidates/c1/import-product');
    expect(res.status).toBe(400);
  });

  it('POST /candidates/:id/import-product : price_kmf absent du body, utilise test_price_kmf du scan', async () => {
    const client = makeClient([
      { rows: [{ state: 'scanned', scan_result: { test_price_kmf: 7000 }, product_name: 'X', normalized_source_contract: null }] },
      { rows: [{ id: 'prod-3' }] },
      { rows: [] },
      { rows: [] },
    ]);
    mockGetClient.mockResolvedValue(client);
    mockEnrichAndApply.mockResolvedValue({ status: 'ok' });

    const res = await request(app).post('/api/admin/sourcing/candidates/c1/import-product').send({});

    expect(res.status).toBe(200);
    const insertParams = client.calls.find((c) => /INSERT INTO products/.test(c.sql)).params;
    expect(insertParams).toContain(7000); // initialPrice via test_price_kmf
  });

  it('POST /candidates/:id/import-product : komerce_category/purchase_price_kmf/description/weight absents → replis appliqués', async () => {
    currentUser = { role: 'admin' }; // pas d'id non plus, pour couvrir le fallback updated_by/triggered_by
    const client = makeClient([
      { rows: [{ state: 'scanned', scan_result: { recommended_price_kmf: 3000 }, product_name: 'X', normalized_source_contract: null }] }, // pas de category/prix/description/weight
      { rows: [{ id: 'prod-4' }] },
      { rows: [] },
      { rows: [] },
    ]);
    mockGetClient.mockResolvedValue(client);
    mockEnrichAndApply.mockResolvedValue({ status: 'ok' });

    const res = await request(app).post('/api/admin/sourcing/candidates/c1/import-product');

    expect(res.status).toBe(200);
    const insertParams = client.calls.find((c) => /INSERT INTO products/.test(c.sql)).params;
    expect(insertParams).toContain('autre');  // komerce_category fallback
    expect(insertParams).toContain(0);        // purchase_price_kmf fallback
    expect(insertParams).toContain(null);     // description / weightKg fallback
    const updateCandParams = client.calls.find((c) => /UPDATE sourcing_candidates/.test(c.sql)).params;
    expect(updateCandParams).toContain(null); // updated_by fallback
  });

  it('POST /candidates/:id/reject : reason absente du body → rejected_reason=null, notes vide dans l\'event ; req.user sans id', async () => {
    currentUser = { role: 'admin' };
    mockQuery
      .mockResolvedValueOnce({ rows: [{ state: 'scanned' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app).post('/api/admin/sourcing/candidates/c1/reject').send({});

    expect(res.status).toBe(200);
    const updateParams = mockQuery.mock.calls[1][1];
    expect(updateParams[0]).toBeNull();  // reason || null
    expect(updateParams[1]).toBeNull();  // triggered_by fallback
  });

  it('POST /candidates/:id/watchlist : req.user sans id → updated_by/triggered_by=null', async () => {
    currentUser = { role: 'admin' };
    mockQuery
      .mockResolvedValueOnce({ rows: [{ state: 'scanned' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app).post('/api/admin/sourcing/candidates/c1/watchlist');

    expect(res.status).toBe(200);
    expect(mockQuery.mock.calls[1][1]).toContain(null);
  });
});

describe('sourcing-scanner — POST /candidates/:id/watchlist (erreur)', () => {
  it('erreur DB → next(err) → 500', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'));
    const res = await request(app).post('/api/admin/sourcing/candidates/c1/watchlist');
    expect(res.status).toBe(500);
  });
});
