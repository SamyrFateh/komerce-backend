'use strict';

/** @test-kind unit @test-runner jest @test-requires none */
/**
 * Router routes/scans.js — façade mince.
 * HUB-002 : /api/scans/hub/receive délègue désormais à la boundary opérateur
 * qui ouvre une transaction et appelle HUB-001 receiveSupplierPackage().
 */

jest.mock('../../middleware/auth', () => ({
  authenticate: (req, res, next) => { req.user = req.user || { id: 'admin-1', role: 'admin' }; next(); },
  requireRole: (roles) => (req, res, next) => {
    if (!roles.includes(req.user?.role)) return res.status(403).json({ error: 'Accès refusé' });
    next();
  },
}));

jest.mock('../../middleware/validate', () => ({
  validate: () => (req, res, next) => next(),
}));
jest.mock('../../validators', () => ({
  scans: { create: {}, collect: {}, hubReceive: {}, verifyQr: {} },
}));

const mockQuery = jest.fn();
jest.mock('../../db', () => ({ query: (...args) => mockQuery(...args) }));

const mockRecordScan = jest.fn();
const mockCollectParcel = jest.fn();
const mockVerifyQr = jest.fn();
const mockTriggerScan3 = jest.fn();
jest.mock('../../services/scan-operations', () => ({
  recordScan: (...args) => mockRecordScan(...args),
  collectParcel: (...args) => mockCollectParcel(...args),
  verifyQr: (...args) => mockVerifyQr(...args),
  triggerScan3: (...args) => mockTriggerScan3(...args),
}));

const mockReceiveSupplierPackageCommand = jest.fn();
jest.mock('../../services/hub-operations', () => ({
  receiveSupplierPackageCommand: (...args) => mockReceiveSupplierPackageCommand(...args),
}));

const express = require('express');
const request = require('supertest');
const VALID_ORDER_ID = '00000000-0000-0000-0000-000000000001';

let app;
let currentUser;

beforeEach(() => {
  jest.clearAllMocks();
  currentUser = { id: 'admin-1', role: 'admin' };

  app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.user = currentUser; next(); });

  jest.isolateModules(() => {
    const router = require('../../routes/scans');
    app.use('/api/scans', router);
  });
});

describe('scans — POST /', () => {
  it('délègue à recordScan avec le device-id header', async () => {
    mockRecordScan.mockResolvedValueOnce({ status: 200, body: { ok: true } });
    const res = await request(app)
      .post('/api/scans')
      .set('x-device-id', 'device-123')
      .send({ order_id: 'o1', step: 'sourcing' });

    expect(res.status).toBe(200);
    expect(mockRecordScan).toHaveBeenCalledWith(
      expect.objectContaining({ order_id: 'o1' }),
      currentUser,
      'device-123'
    );
  });
});

describe('scans — POST /collect', () => {
  it('refuse un rôle non autorisé', async () => {
    currentUser = { id: 'u1', role: 'client' };
    const res = await request(app).post('/api/scans/collect').send({});
    expect(res.status).toBe(403);
    expect(mockCollectParcel).not.toHaveBeenCalled();
  });

  it('délègue à collectParcel avec ip/user-agent', async () => {
    mockCollectParcel.mockResolvedValueOnce({ status: 200, body: { collected: true } });
    const res = await request(app)
      .post('/api/scans/collect')
      .set('User-Agent', 'TestAgent/1.0')
      .send({ order_id: 'o1' });

    expect(res.status).toBe(200);
    expect(mockCollectParcel).toHaveBeenCalledWith(
      expect.objectContaining({ order_id: 'o1' }),
      currentUser,
      expect.any(String),
      'TestAgent/1.0'
    );
  });
});

describe('scans — POST /hub/receive', () => {
  it('délègue le manifeste exact à HUB-002 sans résoudre market/SOI côté route', async () => {
    const payload = {
      reference: 'SUP-MIX-001',
      location_ref: 'HUB-DXB-A1',
      contents: [
        { purchase_order_id: '00000000-0000-0000-0000-000000000301', quantity: 1 },
        { purchase_order_id: '00000000-0000-0000-0000-000000000302', quantity: 2 },
      ],
    };
    mockReceiveSupplierPackageCommand.mockResolvedValueOnce({ status: 201, body: { quarantined: false, unit: { id: 'u1' } } });

    const res = await request(app).post('/api/scans/hub/receive').send(payload);

    expect(res.status).toBe(201);
    expect(mockReceiveSupplierPackageCommand).toHaveBeenCalledWith(payload, 'admin-1');
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('propage une quarantaine gouvernée en 202 sans la transformer en succès nominal', async () => {
    mockReceiveSupplierPackageCommand.mockResolvedValueOnce({
      status: 202,
      body: { quarantined: true, incident: { id: 'inc1' } },
    });
    const res = await request(app).post('/api/scans/hub/receive').send({ reference: 'SUP-BAD', contents: [{}] });
    expect(res.status).toBe(202);
    expect(res.body.quarantined).toBe(true);
  });

  it('refuse un rôle non Hub avant toute exécution', async () => {
    currentUser = { id: 'u1', role: 'client' };
    const res = await request(app).post('/api/scans/hub/receive').send({ reference: 'SUP-1', contents: [] });
    expect(res.status).toBe(403);
    expect(mockReceiveSupplierPackageCommand).not.toHaveBeenCalled();
  });
});

describe('scans — GET /hub/pending', () => {
  it('reste accessible et ne tombe pas dans la route générique', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ order_id: 'o1', reference: 'CMD-1' }] });
    const res = await request(app).get('/api/scans/hub/pending');
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
  });
});

describe('scans — POST /verify-qr', () => {
  it('délègue à verifyQr', async () => {
    mockVerifyQr.mockResolvedValueOnce({ status: 200, body: { valid: true } });
    const res = await request(app).post('/api/scans/verify-qr').send({ qr: 'abc' });
    expect(res.status).toBe(200);
    expect(mockVerifyQr).toHaveBeenCalledWith(expect.objectContaining({ qr: 'abc' }), currentUser);
  });
});

describe('scans — GET /:order_id', () => {
  it('400 si order_id n\'est pas un UUID valide', async () => {
    const res = await request(app).get('/api/scans/not-a-uuid');
    expect(res.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('réservé admin', async () => {
    currentUser = { id: 'u1', role: 'agent_relais' };
    const res = await request(app).get(`/api/scans/${VALID_ORDER_ID}`);
    expect(res.status).toBe(403);
  });

  it('renvoie les scans pour un UUID valide', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 's1', step: 'sourcing' }] });
    const res = await request(app).get(`/api/scans/${VALID_ORDER_ID}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: 's1', step: 'sourcing' }]);
  });
});

describe('scans — exports', () => {
  it('ré-exporte triggerScan3 pour purchasing.js', async () => {
    let router;
    jest.isolateModules(() => { router = require('../../routes/scans'); });
    expect(typeof router.triggerScan3).toBe('function');
    await router.triggerScan3('order-1', 'user-1');
    expect(mockTriggerScan3).toHaveBeenCalledWith('order-1', 'user-1');
  });
});
