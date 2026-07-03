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

const mockQuery = jest.fn();
jest.mock('../../db', () => ({ query: (...args) => mockQuery(...args) }));

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
  it('404 si le candidat est introuvable', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).post('/api/admin/sourcing/candidates/c-404/import-product');
    expect(res.status).toBe(404);
  });

  it('409 si déjà importé avec un product_id', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ state: 'imported_to_catalog', product_id: 'p1' }] });
    const res = await request(app).post('/api/admin/sourcing/candidates/c1/import-product');
    expect(res.status).toBe(409);
    expect(res.body.product_id).toBe('p1');
  });

  it('400 si aucun prix calculable', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ state: 'scanned', scan_result: {} }] });
    const res = await request(app).post('/api/admin/sourcing/candidates/c1/import-product');
    expect(res.status).toBe(400);
  });

  it('crée le produit toujours en is_active=FALSE même avec un prix fourni explicitement', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ state: 'scanned', scan_result: {}, product_name: 'X', description: 'desc EN', komerce_category: 'mode', purchase_price_kmf: 1000 }] })
      .mockResolvedValueOnce({ rows: [{ id: 'prod-1' }] }) // INSERT products
      .mockResolvedValueOnce({ rows: [] })                  // UPDATE candidate
      .mockResolvedValueOnce({ rows: [] });                 // INSERT event
    mockEnrichAndApply.mockResolvedValue({ status: 'ok', confidence: 0.9 });

    const res = await request(app)
      .post('/api/admin/sourcing/candidates/c1/import-product')
      .send({ price_kmf: 5000 });

    expect(res.status).toBe(200);
    expect(res.body.product_id).toBe('prod-1');
    const insertSql = mockQuery.mock.calls[1][0];
    expect(insertSql).toMatch(/FALSE, 'candidate'/);
  });

  it('persiste la donnée source à l\'import (DOCTRINE_CATALOGUE §7) et câble l\'étage ⑤', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ state: 'scanned', scan_result: {}, product_name: 'Power Bank EN', description: 'desc EN', komerce_category: 'tech', purchase_price_kmf: 1000 }] })
      .mockResolvedValueOnce({ rows: [{ id: 'prod-2' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    mockEnrichAndApply.mockResolvedValue({ status: 'low_confidence', confidence: 0.6, needsReview: true });

    const res = await request(app)
      .post('/api/admin/sourcing/candidates/c1/import-product')
      .send({ price_kmf: 5000 });

    expect(res.status).toBe(200);
    const [insertSql, insertParams] = mockQuery.mock.calls[1];
    expect(insertSql).toContain('name_source');
    expect(insertSql).toContain("'connector_raw'");
    expect(insertParams).toEqual(expect.arrayContaining(['Power Bank EN', 'desc EN', 'en']));
    // câblage étage ⑤ : appelé avec le produit créé, résultat exposé au client
    expect(mockEnrichAndApply).toHaveBeenCalledWith('prod-2');
    expect(res.body.enrichment).toEqual(expect.objectContaining({ status: 'low_confidence' }));
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
