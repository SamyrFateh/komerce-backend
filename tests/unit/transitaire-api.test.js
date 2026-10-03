'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/transitaire-api.test.js
 *
 * Tests du router routes/transitaire-api.js (endpoints agent transitaire)
 *
 * Couverture (invariants critiques, pas de vraie DB/transaction) :
 *   ✓ GET /parcels : liste les colis "shipped" + nb_items par colis
 *   ✓ POST /ship : 400 si parcel_id manquant
 *   ✓ POST /ship : 404 si colis introuvable
 *   ✓ POST /ship : 400 si le colis n'est pas en statut "shipped"
 *   ✓ POST /ship : transaction BEGIN/transitionOrderStatus/syncScanToParcels/COMMIT,
 *     ROLLBACK si la state machine order refuse (409), notif fire-and-forget après COMMIT
 *   ✓ GET /stats : renvoie les KPIs agrégés tels quels
 *   ✓ GET /history : renvoie les events de transit confirmés (status='applied')
 */

jest.mock('../../utils/logger', () => ({
  child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

jest.mock('../../middleware/auth', () => ({
  authenticate: (req, res, next) => {
    req.user = req.user || { id: 'u-transitaire', role: 'agent_transitaire' };
    next();
  },
  requireRole: () => (req, res, next) => next(),
}));

let mockDelegatedMarketId = 'market-cm-id';
let mockGrantedCapabilities = new Set(['logistics.read', 'execution.transit.confirm']);
jest.mock('../../middleware/require-market-delegated-capability', () => ({
  requireSingleMarketDelegatedCapability: capability => (req, res, next) => {
    if (!mockGrantedCapabilities.has(capability)) {
      return res.status(403).json({ code: 'MARKET_CAPABILITY_REQUIRED', error: 'capability required' });
    }
    req.marketDelegatedCapability = {
      capability,
      market_id: mockDelegatedMarketId,
      market_code: 'CM',
      assignment_id: 'assignment-cm',
      membership_id: 'membership-cm',
    };
    return next();
  },
}));

const mockQuery = jest.fn();
const mockClientQuery = jest.fn();
const mockClient = { query: mockClientQuery, release: jest.fn() };
jest.mock('../../db', () => ({
  query: (...args) => mockQuery(...args),
  getClient: jest.fn(() => Promise.resolve(mockClient)),
}));

const mockTransitionOrderStatus = jest.fn();
jest.mock('../../services/order-status-machine', () => ({
  transitionOrderStatus: (...args) => mockTransitionOrderStatus(...args),
}));

const mockSyncScanToParcels = jest.fn();
jest.mock('../../utils/parcelSync', () => ({
  syncScanToParcels: (...args) => mockSyncScanToParcels(...args),
}));

const mockNotifyParcelScan = jest.fn().mockResolvedValue({});
jest.mock('../../services/notification-service', () => ({
  notifyParcelScan: (...args) => mockNotifyParcelScan(...args),
}));

const express = require('express');
const request = require('supertest');

let app;

beforeEach(() => {
  jest.clearAllMocks();
  mockNotifyParcelScan.mockResolvedValue({});
  mockClient.query.mockResolvedValue({ rows: [] });
  mockDelegatedMarketId = 'market-cm-id';
  mockGrantedCapabilities = new Set(['logistics.read', 'execution.transit.confirm']);

  app = express();
  app.use(express.json());
  jest.isolateModules(() => {
    const router = require('../../routes/transitaire-api');
    app.use('/api/transitaire', router);
  });
});

describe('GET /api/transitaire/parcels', () => {
  test('liste les colis shipped avec nb_items calculé', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'P1', reference: 'REF1', status: 'shipped' }] })
      .mockResolvedValueOnce({ rows: [{ nb: 3 }] });

    const res = await request(app).get('/api/transitaire/parcels');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      parcels: [{ id: 'P1', reference: 'REF1', status: 'shipped', nb_items: 3 }],
      count: 1,
    });
  });
});

describe('POST /api/transitaire/ship', () => {
  test('400 si parcel_id manquant', async () => {
    const res = await request(app).post('/api/transitaire/ship').send({});
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'parcel_id requis' });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('404 si le colis est introuvable', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).post('/api/transitaire/ship').send({ parcel_id: 'PX' });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Colis introuvable' });
  });

  test('400 si le colis n\'est pas en statut "shipped"', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'P1', reference: 'REF1', status: 'preparation', order_id: 'O1', market_id: 'market-cm-id' }] });
    const res = await request(app).post('/api/transitaire/ship').send({ parcel_id: 'P1' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('doit être "shipped"');
    expect(mockClient.query).not.toHaveBeenCalled();
  });

  test('succès : BEGIN -> transitionOrderStatus -> syncScanToParcels -> COMMIT, notif après coup', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'P1', reference: 'REF1', status: 'shipped', order_id: 'O1', market_id: 'market-cm-id' }] });
    mockTransitionOrderStatus.mockResolvedValueOnce({ success: true });
    mockSyncScanToParcels.mockResolvedValueOnce({});

    const res = await request(app).post('/api/transitaire/ship').send({ parcel_id: 'P1', notes: 'ok' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.parcel.status).toBe('in_transit');

    const calls = mockClient.query.mock.calls.map(c => c[0]);
    expect(calls[0]).toBe('BEGIN');
    expect(calls[calls.length - 1]).toBe('COMMIT');
    expect(mockTransitionOrderStatus).toHaveBeenCalledWith(expect.objectContaining({
      orderId: 'O1', newStatus: 'in_transit', source: 'transitaire_ship',
    }));
    expect(mockSyncScanToParcels).toHaveBeenCalled();
    expect(mockNotifyParcelScan).toHaveBeenCalledWith('P1', 'REF1', 'in_transit');
    expect(mockClient.release).toHaveBeenCalled();
  });

  test('409 + ROLLBACK si transitionOrderStatus refuse la transition order', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'P1', reference: 'REF1', status: 'shipped', order_id: 'O1' }] });
    mockTransitionOrderStatus.mockResolvedValueOnce({ success: false, noop: false, error: 'invalid transition', previousStatus: 'draft' });

    const res = await request(app).post('/api/transitaire/ship').send({ parcel_id: 'P1' });

    expect(res.status).toBe(409);
    expect(res.body.current_status).toBe('draft');
    const calls = mockClient.query.mock.calls.map(c => c[0]);
    expect(calls).toContain('ROLLBACK');
    expect(mockSyncScanToParcels).not.toHaveBeenCalled();
    expect(mockNotifyParcelScan).not.toHaveBeenCalled();
    expect(mockClient.release).toHaveBeenCalled();
  });

  test('500 + ROLLBACK si syncScanToParcels échoue', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'P1', reference: 'REF1', status: 'shipped', order_id: 'O1' }] });
    mockTransitionOrderStatus.mockResolvedValueOnce({ success: true });
    mockSyncScanToParcels.mockRejectedValueOnce(new Error('sync crash'));

    const res = await request(app).post('/api/transitaire/ship').send({ parcel_id: 'P1' });

    expect(res.status).toBe(500);
    const calls = mockClient.query.mock.calls.map(c => c[0]);
    expect(calls).toContain('ROLLBACK');
    expect(mockClient.release).toHaveBeenCalled();
  });
});

describe('market isolation', () => {
  test('lecture exige logistics.read', async () => {
    mockGrantedCapabilities.delete('logistics.read');
    const res = await request(app).get('/api/transitaire/parcels');
    expect(res.status).toBe(403);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('confirmation transit exige execution.transit.confirm', async () => {
    mockGrantedCapabilities.delete('execution.transit.confirm');
    const res = await request(app).post('/api/transitaire/ship').send({ parcel_id: 'P1' });
    expect(res.status).toBe(403);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('transitaire CM ne peut pas confirmer un colis CG', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{
      id: 'P-CG', reference: 'REF-CG', status: 'shipped', order_id: 'O-CG', market_id: 'market-cg-id',
    }] });
    const res = await request(app).post('/api/transitaire/ship').send({ parcel_id: 'P-CG' });
    expect(res.status).toBe(404);
    expect(mockClient.query).not.toHaveBeenCalled();
  });

  test('les lectures SQL sont bornées au market_id délégué', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/api/transitaire/parcels');
    expect(res.status).toBe(200);
    expect(mockQuery.mock.calls[0][0]).toMatch(/o\.market_id = \$1::uuid/);
    expect(mockQuery.mock.calls[0][1]).toEqual(['market-cm-id']);
  });
});

describe('GET /api/transitaire/stats', () => {
  test('renvoie les KPIs agrégés tels quels', async () => {
    const stats = { ready_to_ship: 5, in_transit: 2, total_active: 7, total_weight_shipped: '12.50', avg_wait_hours: '3.2', overdue_shipments: 1 };
    mockQuery.mockResolvedValueOnce({ rows: [stats] });

    const res = await request(app).get('/api/transitaire/stats');

    expect(res.status).toBe(200);
    expect(res.body).toEqual(stats);
  });
});

describe('GET /api/transitaire/history', () => {
  test('renvoie les events transit_confirmed récents', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'E1', event_type: 'transit_confirmed', parcel_ref: 'REF1' }] });

    const res = await request(app).get('/api/transitaire/history');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ events: [{ id: 'E1', event_type: 'transit_confirmed', parcel_ref: 'REF1' }] });
  });
});
