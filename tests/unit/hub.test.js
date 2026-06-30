'use strict';

/**
 * tests/unit/hub.test.js
 *
 * Tests du router routes/hub.js (façade mince — REFACTO-R2)
 *
 * Doctrine : route = auth + validation + appel service + réponse.
 * Logique métier (transactions, FOR UPDATE) déjà couverte par
 * tests/unit/hub-operations.test.js — pas re-testée ici.
 *
 * Couverture :
 *   ✓ POST /scan, /pack, /seal, /batch-scan : délèguent à services/hub-operations
 *     et reflètent le {status, body} renvoyé par le service
 *   ✓ GET /search : filtres dynamiques q/status/island construits correctement
 *   ✓ GET /pending, /today, /stats/week : requêtes lecture seule, formatage de la réponse
 */

jest.mock('../../middleware/auth', () => ({
  authenticate: (req, res, next) => { req.user = req.user || { id: 'u-hub', role: 'agent_hub' }; next(); },
  requireRole: () => (req, res, next) => next(),
}));

jest.mock('../../middleware/validate', () => ({
  validate: () => (req, res, next) => next(),
}));

jest.mock('../../validators', () => ({ hub: { scan: {}, pack: {}, seal: {} } }));

const mockQuery = jest.fn();
jest.mock('../../db', () => ({ query: (...args) => mockQuery(...args) }));

const mockHubOps = {
  receiveParcel: jest.fn(),
  packParcel: jest.fn(),
  sealParcel: jest.fn(),
  batchScan: jest.fn(),
};
jest.mock('../../services/hub-operations', () => mockHubOps);

const express = require('express');
const request = require('supertest');

let app;

beforeEach(() => {
  jest.clearAllMocks();
  app = express();
  app.use(express.json());
  jest.isolateModules(() => {
    const router = require('../../routes/hub');
    app.use('/api/hub', router);
  });
});

describe('POST /api/hub/scan', () => {
  test('délègue à mockHubOps.receiveParcel et reflète status/body', async () => {
    mockHubOps.receiveParcel.mockResolvedValueOnce({ status: 200, body: { success: true } });

    const res = await request(app).post('/api/hub/scan').send({ parcel_ref: 'P1', notes: 'ok' });

    expect(mockHubOps.receiveParcel).toHaveBeenCalledWith('P1', 'u-hub', 'ok');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
  });

  test('propage le code d\'erreur renvoyé par le service (ex: 404)', async () => {
    mockHubOps.receiveParcel.mockResolvedValueOnce({ status: 404, body: { error: 'introuvable' } });
    const res = await request(app).post('/api/hub/scan').send({ parcel_ref: 'PX' });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'introuvable' });
  });
});

describe('POST /api/hub/pack', () => {
  test('délègue à mockHubOps.packParcel', async () => {
    mockHubOps.packParcel.mockResolvedValueOnce({ status: 200, body: { packed: true } });
    const res = await request(app).post('/api/hub/pack').send({ parcel_id: 'P1', box_label: 'B1', notes: 'n' });
    expect(mockHubOps.packParcel).toHaveBeenCalledWith('P1', 'u-hub', 'B1', 'n');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ packed: true });
  });
});

describe('POST /api/hub/seal', () => {
  test('délègue à mockHubOps.sealParcel', async () => {
    mockHubOps.sealParcel.mockResolvedValueOnce({ status: 200, body: { sealed: true } });
    const res = await request(app).post('/api/hub/seal').send({ parcel_id: 'P1', notes: 'n' });
    expect(mockHubOps.sealParcel).toHaveBeenCalledWith('P1', 'u-hub', 'n');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ sealed: true });
  });
});

describe('POST /api/hub/batch-scan', () => {
  test('délègue à mockHubOps.batchScan', async () => {
    mockHubOps.batchScan.mockResolvedValueOnce({ status: 200, body: { count: 2 } });
    const res = await request(app).post('/api/hub/batch-scan').send({ parcel_refs: ['P1', 'P2'], notes: 'n' });
    expect(mockHubOps.batchScan).toHaveBeenCalledWith(['P1', 'P2'], 'u-hub', 'n');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ count: 2 });
  });
});

describe('GET /api/hub/search', () => {
  test('sans filtre : where = 1=1, pas de params', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] });

    const res = await request(app).get('/api/hub/search');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: [], total: 0 });
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('WHERE 1=1');
    expect(params).toEqual([50, 0]);
  });

  test('avec q/status/island : construit les conditions ILIKE/égalité dans l\'ordre', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'P1' }] })
      .mockResolvedValueOnce({ rows: [{ count: '1' }] });

    const res = await request(app).get('/api/hub/search').query({ q: 'foo', status: 'shipped', island: 'Grande Comore', limit: 10, offset: 5 });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: [{ id: 'P1' }], total: 1 });

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('p.reference ILIKE $1');
    expect(sql).toContain('p.status = $2');
    expect(sql).toContain('o.destination_island = $3');
    expect(params).toEqual(['%foo%', 'shipped', 'Grande Comore', 10, 5]);
  });
});

describe('GET /api/hub/pending', () => {
  test('renvoie data + count', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'P1' }, { id: 'P2' }] });
    const res = await request(app).get('/api/hub/pending');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: [{ id: 'P1' }, { id: 'P2' }], count: 2 });
  });
});

describe('GET /api/hub/today', () => {
  test('renvoie directement la première ligne agrégée', async () => {
    const row = { scanned_today: 3, packed_today: 1, sealed_today: 0, pending_total: 5 };
    mockQuery.mockResolvedValueOnce({ rows: [row] });
    const res = await request(app).get('/api/hub/today');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(row);
  });
});

describe('GET /api/hub/stats/week', () => {
  test('formate daily + summary, avg_processing_hours arrondi à 1 décimale', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ day: '2026-06-29', scanned: '2', packed: '1', sealed: '1', total: '4' }] })
      .mockResolvedValueOnce({ rows: [{ pending: '5', shipped_today: '2', avg_processing_hours: '3.456' }] });

    const res = await request(app).get('/api/hub/stats/week');

    expect(res.status).toBe(200);
    expect(res.body.summary).toEqual({ pending: 5, shipped_today: 2, avg_processing_hours: 3.5 });
    expect(res.body.daily).toHaveLength(1);
  });

  test('avg_processing_hours null si aucune donnée', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ pending: '0', shipped_today: '0', avg_processing_hours: null }] });

    const res = await request(app).get('/api/hub/stats/week');

    expect(res.body.summary.avg_processing_hours).toBeNull();
  });
});

describe('erreurs', () => {
  test('erreur DB → 500 via next(err)', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'));
    const res = await request(app).get('/api/hub/pending');
    expect(res.status).toBe(500);
  });
});
