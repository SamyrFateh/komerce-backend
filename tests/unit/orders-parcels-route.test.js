'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/orders-parcels-route.test.js
 *
 * Tests du router routes/orders/parcels.js (monté sous /api/orders).
 *
 * Couverture :
 *   ✓ POST /:id/mark-availability : garde de rôle, délégation à markAvailability,
 *                                    status/body renvoyés tels quels, erreur → next(err)
 *   ✓ POST /:id/partial-ship      : idem avec partialShip
 *   ✓ GET  /:id/sub-orders        : redirect 307 → /api/orders/:id/parcels
 *   ✓ GET  /:id/parcels           : 404 si commande introuvable, 403 si non
 *                                    privilégié et pas propriétaire, accès OK pour
 *                                    rôles privilégiés et pour le propriétaire,
 *                                    enrichissement items + total_kmf calculé,
 *                                    erreur DB → next(err)
 *   ✓ PATCH /parcels/:parcelId/status : garde de rôle, délégation à updateParcelStatus
 *   ✓ PATCH /sub-orders/:subId/status : comportement réel observé — le "redirect"
 *                                    interne (mutation de req.url + next()) ne
 *                                    rebascule PAS vers la route /parcels/:id/status
 *                                    au sein du même router (next() avance dans la
 *                                    pile, il ne la rejoue pas) → 404. Test figé
 *                                    pour documenter ce comportement existant, pas
 *                                    pour le cautionner.
 *   ✓ POST /:id/cancel-backorder  : délégation à cancelBackorder, erreur → next(err)
 */

const mockState = { user: { id: 'u1', role: 'admin' } };
jest.mock('../../middleware/auth', () => ({
  authenticate: (req, _res, next) => { req.user = mockState.user; next(); },
  requireRole: (roles) => (req, res, next) => {
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'forbidden' });
    next();
  },
}));

jest.mock('../../middleware/validate', () => ({
  validate: () => (req, res, next) => next(),
}));

const mockQuery = jest.fn();
jest.mock('../../db', () => ({ query: (...args) => mockQuery(...args) }));

const mockMarkAvailability = jest.fn();
const mockPartialShip = jest.fn();
const mockUpdateParcelStatus = jest.fn();
const mockCancelBackorder = jest.fn();
jest.mock('../../services/parcel-operations', () => ({
  markAvailability: (...args) => mockMarkAvailability(...args),
  partialShip: (...args) => mockPartialShip(...args),
  updateParcelStatus: (...args) => mockUpdateParcelStatus(...args),
  cancelBackorder: (...args) => mockCancelBackorder(...args),
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
    const router = require('../../routes/orders/parcels');
    app.use('/api/orders', router);
  });

  app.use((err, req, res, _next) => {
    res.status(500).json({ error: err.message });
  });
});

describe('parcels — POST /:id/mark-availability', () => {
  it('403 si rôle non autorisé', async () => {
    mockState.user = { id: 'u2', role: 'client' };
    const res = await request(app).post('/api/orders/o1/mark-availability').send({ items: [] });
    expect(res.status).toBe(403);
    expect(mockMarkAvailability).not.toHaveBeenCalled();
  });

  it('délègue à markAvailability et renvoie status/body tels quels', async () => {
    mockMarkAvailability.mockResolvedValueOnce({ status: 200, body: { ok: true } });
    const res = await request(app).post('/api/orders/o1/mark-availability').send({ items: [{ id: 'i1' }] });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(mockMarkAvailability).toHaveBeenCalledWith('o1', [{ id: 'i1' }], mockState.user);
  });

  it('erreur → next(err) → 500', async () => {
    mockMarkAvailability.mockRejectedValueOnce(new Error('boom'));
    const res = await request(app).post('/api/orders/o1/mark-availability').send({ items: [] });
    expect(res.status).toBe(500);
  });
});

describe('parcels — POST /:id/partial-ship', () => {
  it('403 si rôle non autorisé', async () => {
    mockState.user = { id: 'u2', role: 'client' };
    const res = await request(app).post('/api/orders/o1/partial-ship').send({});
    expect(res.status).toBe(403);
  });

  it('délègue à partialShip et renvoie status/body tels quels', async () => {
    mockPartialShip.mockResolvedValueOnce({ status: 201, body: { parcelId: 'p1' } });
    const res = await request(app).post('/api/orders/o1/partial-ship').send({ items: ['i1'] });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ parcelId: 'p1' });
    expect(mockPartialShip).toHaveBeenCalledWith('o1', { items: ['i1'] }, mockState.user);
  });

  it('erreur → next(err) → 500', async () => {
    mockPartialShip.mockRejectedValueOnce(new Error('boom'));
    const res = await request(app).post('/api/orders/o1/partial-ship').send({});
    expect(res.status).toBe(500);
  });
});

describe('parcels — GET /:id/sub-orders (backward compat)', () => {
  it('redirige (307) vers /api/orders/:id/parcels', async () => {
    const res = await request(app).get('/api/orders/o1/sub-orders').redirects(0);
    expect(res.status).toBe(307);
    expect(res.headers.location).toBe('/api/orders/o1/parcels');
  });
});

describe('parcels — GET /:id/parcels', () => {
  it('404 si commande introuvable', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/api/orders/o1/parcels');
    expect(res.status).toBe(404);
  });

  it('403 si non privilégié et pas propriétaire', async () => {
    mockState.user = { id: 'other-user', role: 'client' };
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'o1', reference: 'CMD-1', user_id: 'owner-1', status: 'shipped' }] });
    const res = await request(app).get('/api/orders/o1/parcels');
    expect(res.status).toBe(403);
  });

  it('autorise le propriétaire (client)', async () => {
    mockState.user = { id: 'owner-1', role: 'client' };
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'o1', reference: 'CMD-1', user_id: 'owner-1', status: 'shipped' }] })
      .mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/api/orders/o1/parcels');
    expect(res.status).toBe(200);
  });

  it.each(['admin', 'agent_hub', 'agent_relais'])('autorise le rôle privilégié %s même si pas propriétaire', async (role) => {
    mockState.user = { id: 'someone-else', role };
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'o1', reference: 'CMD-1', user_id: 'owner-1', status: 'shipped' }] })
      .mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/api/orders/o1/parcels');
    expect(res.status).toBe(200);
  });

  it('enrichit chaque colis avec ses items et calcule total_kmf', async () => {
    mockState.user = { id: 'owner-1', role: 'client' };
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'o1', reference: 'CMD-1', user_id: 'owner-1', status: 'shipped' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'p1' }, { id: 'p2' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'pi1', price_kmf: '1000', quantity: 2 }, { id: 'pi2', price_kmf: '500', quantity: 1 }] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app).get('/api/orders/o1/parcels');

    expect(res.status).toBe(200);
    expect(res.body.order_reference).toBe('CMD-1');
    expect(res.body.order_status).toBe('shipped');
    expect(res.body.parcels).toHaveLength(2);
    expect(res.body.parcels[0].total_kmf).toBe(2500); // 1000*2 + 500*1
    expect(res.body.parcels[1].total_kmf).toBe(0);
  });

  it('erreur DB → next(err) → 500', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'));
    const res = await request(app).get('/api/orders/o1/parcels');
    expect(res.status).toBe(500);
  });
});

describe('parcels — PATCH /parcels/:parcelId/status', () => {
  it('403 si rôle non autorisé', async () => {
    mockState.user = { id: 'u2', role: 'client' };
    const res = await request(app).patch('/api/orders/parcels/p1/status').send({ status: 'shipped' });
    expect(res.status).toBe(403);
  });

  it('délègue à updateParcelStatus et renvoie status/body tels quels', async () => {
    mockUpdateParcelStatus.mockResolvedValueOnce({ status: 200, body: { updated: true } });
    const res = await request(app).patch('/api/orders/parcels/p1/status').send({ status: 'available' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ updated: true });
    expect(mockUpdateParcelStatus).toHaveBeenCalledWith('p1', { status: 'available' }, mockState.user);
  });

  it('erreur → next(err) → 500', async () => {
    mockUpdateParcelStatus.mockRejectedValueOnce(new Error('boom'));
    const res = await request(app).patch('/api/orders/parcels/p1/status').send({});
    expect(res.status).toBe(500);
  });
});

describe('parcels — PATCH /sub-orders/:subId/status (backward compat, comportement réel)', () => {
  it('renvoie 404 — la mutation de req.url + next() n\'atteint pas la route /parcels/:id/status', async () => {
    const res = await request(app).patch('/api/orders/sub-orders/old-sub-1/status').send({ status: 'shipped' });
    expect(res.status).toBe(404);
    expect(mockUpdateParcelStatus).not.toHaveBeenCalled();
  });

  it('403 si rôle non autorisé (la garde de rôle s\'applique avant la tentative de redirection)', async () => {
    mockState.user = { id: 'u2', role: 'client' };
    const res = await request(app).patch('/api/orders/sub-orders/old-sub-1/status').send({});
    expect(res.status).toBe(403);
  });
});

describe('parcels — POST /:id/cancel-backorder', () => {
  it('délègue à cancelBackorder et renvoie status/body tels quels', async () => {
    mockCancelBackorder.mockResolvedValueOnce({ status: 200, body: { cancelled: true } });
    const res = await request(app).post('/api/orders/o1/cancel-backorder').send({ reason: 'rupture' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ cancelled: true });
    expect(mockCancelBackorder).toHaveBeenCalledWith('o1', { reason: 'rupture' }, mockState.user);
  });

  it('erreur → next(err) → 500', async () => {
    mockCancelBackorder.mockRejectedValueOnce(new Error('boom'));
    const res = await request(app).post('/api/orders/o1/cancel-backorder').send({});
    expect(res.status).toBe(500);
  });
});
