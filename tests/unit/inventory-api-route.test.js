'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/inventory-api-route.test.js
 *
 * Tests du router routes/inventory-api.js (monté sur /api/hub/inventory).
 *
 * Couverture :
 *   ✓ Garde d'accès : authenticate + requireRole(['admin','agent_hub'])
 *   ✓ POST /receive            : succès + erreur métier → 400
 *   ✓ POST /scan-assign        : 400 si inventory_item_id/parcel_id manquant,
 *                                 succès sinon, erreur métier → 400
 *   ✓ POST /propose-all        : succès, erreur → délègue à next(e)
 *   ✓ GET  /proposals          : succès, erreur → next(e)
 *   ✓ GET  /open-parcels       : succès, erreur → next(e)
 *   ✓ GET  /buffer             : ne renvoie que les items status === 'buffered'
 *   ✓ GET  /stats              : succès
 *   ✓ GET  /order/:id/dispatch : succès + erreur métier → 400
 */

const mockState = { user: { id: 'u1', role: 'admin' } };
jest.mock('../../middleware/auth', () => ({
  authenticate: (req, _res, next) => { req.user = mockState.user; next(); },
  requireRole: (roles) => (req, res, next) => {
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'forbidden' });
    next();
  },
}));

const mockReceiveItem = jest.fn();
const mockScanIntoParcel = jest.fn();
const mockProposeAll = jest.fn();
const mockListProposals = jest.fn();
const mockListOpenParcels = jest.fn();
const mockGetStats = jest.fn();
const mockShouldDispatch = jest.fn();
jest.mock('../../services/inventory-service', () => ({
  receiveItem: (...args) => mockReceiveItem(...args),
  scanIntoParcel: (...args) => mockScanIntoParcel(...args),
  proposeAll: (...args) => mockProposeAll(...args),
  listProposals: (...args) => mockListProposals(...args),
  listOpenParcels: (...args) => mockListOpenParcels(...args),
  getStats: (...args) => mockGetStats(...args),
  shouldDispatch: (...args) => mockShouldDispatch(...args),
}));

const express = require('express');
const request = require('supertest');

let app;

beforeEach(() => {
  jest.clearAllMocks();
  mockState.user = { id: 'u1', role: 'admin' };

  app = express();
  app.use(express.json());

  jest.isolateModules(() => {
    const router = require('../../routes/inventory-api');
    app.use('/api/hub/inventory', router);
  });

  // Error middleware pour intercepter les next(e) des routes qui ne
  // catchent pas localement (propose-all, proposals, open-parcels, buffer, stats)
  app.use((err, req, res, _next) => {
    res.status(500).json({ error: err.message });
  });
});

describe('inventory-api — garde d\'accès', () => {
  it('403 si le rôle n\'est ni admin ni agent_hub', async () => {
    mockState.user = { id: 'u2', role: 'client' };
    const res = await request(app).get('/api/hub/inventory/stats');
    expect(res.status).toBe(403);
  });

  it('laisse passer agent_hub', async () => {
    mockState.user = { id: 'u3', role: 'agent_hub' };
    mockGetStats.mockResolvedValueOnce({ total: 10 });
    const res = await request(app).get('/api/hub/inventory/stats');
    expect(res.status).toBe(200);
  });
});

describe('inventory-api — POST /receive', () => {
  it('succès → ok:true + résultat fusionné', async () => {
    mockReceiveItem.mockResolvedValueOnce({ id: 'item-1' });
    const res = await request(app).post('/api/hub/inventory/receive').send({ sku: 'X' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, id: 'item-1' });
    expect(mockReceiveItem).toHaveBeenCalledWith({ sku: 'X' });
  });

  it('erreur métier → 400', async () => {
    mockReceiveItem.mockRejectedValueOnce(new Error('sku invalide'));
    const res = await request(app).post('/api/hub/inventory/receive').send({});
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'sku invalide' });
  });
});

describe('inventory-api — POST /scan-assign', () => {
  it('400 si inventory_item_id manquant', async () => {
    const res = await request(app).post('/api/hub/inventory/scan-assign').send({ parcel_id: 'p1' });
    expect(res.status).toBe(400);
    expect(mockScanIntoParcel).not.toHaveBeenCalled();
  });

  it('400 si parcel_id manquant', async () => {
    const res = await request(app).post('/api/hub/inventory/scan-assign').send({ inventory_item_id: 'i1' });
    expect(res.status).toBe(400);
    expect(mockScanIntoParcel).not.toHaveBeenCalled();
  });

  it('succès → délègue à scanIntoParcel(item, parcel)', async () => {
    mockScanIntoParcel.mockResolvedValueOnce({ assigned: true });
    const res = await request(app).post('/api/hub/inventory/scan-assign').send({ inventory_item_id: 'i1', parcel_id: 'p1' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, assigned: true });
    expect(mockScanIntoParcel).toHaveBeenCalledWith('i1', 'p1');
  });

  it('erreur métier → 400', async () => {
    mockScanIntoParcel.mockRejectedValueOnce(new Error('item déjà assigné'));
    const res = await request(app).post('/api/hub/inventory/scan-assign').send({ inventory_item_id: 'i1', parcel_id: 'p1' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'item déjà assigné' });
  });
});

describe('inventory-api — POST /propose-all', () => {
  it('succès → ok:true + résultat', async () => {
    mockProposeAll.mockResolvedValueOnce({ updated: 5 });
    const res = await request(app).post('/api/hub/inventory/propose-all');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, updated: 5 });
  });

  it('erreur → délègue à next(e), pas de catch local', async () => {
    mockProposeAll.mockRejectedValueOnce(new Error('boom'));
    const res = await request(app).post('/api/hub/inventory/propose-all');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'boom' });
  });
});

describe('inventory-api — GET /proposals', () => {
  it('succès → ok:true + items', async () => {
    mockListProposals.mockResolvedValueOnce([{ id: 1 }]);
    const res = await request(app).get('/api/hub/inventory/proposals');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, items: [{ id: 1 }] });
  });

  it('erreur → next(e)', async () => {
    mockListProposals.mockRejectedValueOnce(new Error('db down'));
    const res = await request(app).get('/api/hub/inventory/proposals');
    expect(res.status).toBe(500);
  });
});

describe('inventory-api — GET /open-parcels', () => {
  it('succès → ok:true + parcels', async () => {
    mockListOpenParcels.mockResolvedValueOnce([{ id: 'p1' }]);
    const res = await request(app).get('/api/hub/inventory/open-parcels');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, parcels: [{ id: 'p1' }] });
  });

  it('erreur → next(e)', async () => {
    mockListOpenParcels.mockRejectedValueOnce(new Error('db down'));
    const res = await request(app).get('/api/hub/inventory/open-parcels');
    expect(res.status).toBe(500);
  });
});

describe('inventory-api — GET /buffer', () => {
  it('ne renvoie que les items au statut "buffered"', async () => {
    mockListProposals.mockResolvedValueOnce([
      { id: 1, status: 'buffered' },
      { id: 2, status: 'proposed' },
      { id: 3, status: 'buffered' },
    ]);
    const res = await request(app).get('/api/hub/inventory/buffer');
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([
      { id: 1, status: 'buffered' },
      { id: 3, status: 'buffered' },
    ]);
  });

  it('erreur → next(e)', async () => {
    mockListProposals.mockRejectedValueOnce(new Error('db down'));
    const res = await request(app).get('/api/hub/inventory/buffer');
    expect(res.status).toBe(500);
  });
});

describe('inventory-api — GET /stats', () => {
  it('succès → ok:true + stats fusionnées', async () => {
    mockGetStats.mockResolvedValueOnce({ total: 42, buffered: 3 });
    const res = await request(app).get('/api/hub/inventory/stats');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, total: 42, buffered: 3 });
  });

  it('erreur → next(e)', async () => {
    mockGetStats.mockRejectedValueOnce(new Error('db down'));
    const res = await request(app).get('/api/hub/inventory/stats');
    expect(res.status).toBe(500);
  });
});

describe('inventory-api — GET /order/:id/dispatch', () => {
  it('succès → ok:true + décision', async () => {
    mockShouldDispatch.mockResolvedValueOnce({ dispatch: true });
    const res = await request(app).get('/api/hub/inventory/order/42/dispatch');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, dispatch: true });
    expect(mockShouldDispatch).toHaveBeenCalledWith('42');
  });

  it('erreur métier → 400 (catch local, pas next)', async () => {
    mockShouldDispatch.mockRejectedValueOnce(new Error('commande introuvable'));
    const res = await request(app).get('/api/hub/inventory/order/42/dispatch');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'commande introuvable' });
  });
});
