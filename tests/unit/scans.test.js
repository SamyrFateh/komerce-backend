'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/scans.test.js
 *
 * Tests du router routes/scans.js (façade mince — REFACTO-R3)
 *
 * Doctrine : route = auth + validation + appel service + réponse.
 * Ces tests vérifient que la façade délègue correctement et respecte
 * son contrat HTTP, SANS retester la logique métier de scan-operations.js
 * (déjà couverte par tests/unit/scan-operations.test.js).
 *
 * Couverture :
 *   ✓ POST / : délègue à scanOps.recordScan avec le device-id header
 *   ✓ POST /collect : réservé admin/agent_relais, délègue à scanOps.collectParcel
 *   ✓ POST /hub/receive : résout qr_code → po_id, 404 si QR inconnu, 400 si ni po_id ni qr_code
 *   ✓ GET /hub/pending : reste accessible AVANT la route générique /:order_id
 *   ✓ POST /verify-qr : délègue à scanOps.verifyQr
 *   ✓ GET /:order_id : 400 si order_id n'est pas un UUID valide (garde-fou avant requête SQL)
 *   ✓ GET /:order_id : réservé admin uniquement (pas agent_relais)
 *   ✓ triggerScan3 est bien ré-exporté pour purchasing.js
 */

jest.mock('../../middleware/auth', () => ({
  authenticate: (req, res, next) => { req.user = req.user || { id: 'admin-1', role: 'admin' }; next(); },
  requireRole: (roles) => (req, res, next) => {
    if (!roles.includes(req.user?.role)) return res.status(403).json({ error: 'Accès refusé' });
    next();
  },
}));

// Validation Joi non testée ici (façade mince) — bypass pour isoler le routage
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

const express = require('express');
const request = require('supertest');

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

describe('scans — POST / (façade recordScan)', () => {
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
  it('400 si ni po_id ni qr_code fourni', async () => {
    const res = await request(app).post('/api/scans/hub/receive').send({});
    expect(res.status).toBe(400);
  });

  it('404 si le qr_code ne correspond à aucun purchase_order actif', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).post('/api/scans/hub/receive').send({ qr_code: 'QR-UNKNOWN' });
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/QR-UNKNOWN/);
  });

  it('résout qr_code → po_id puis renvoie 501 vers /api/purchasing/:po_id/receive', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'po-1' }] });
    const res = await request(app).post('/api/scans/hub/receive').send({ qr_code: 'QR-OK' });
    expect(res.status).toBe(501);
    expect(res.body.po_id).toBe('po-1');
  });

  it('utilise po_id directement si fourni (pas de lookup qr_code)', async () => {
    const res = await request(app).post('/api/scans/hub/receive').send({ po_id: 'po-direct' });
    expect(res.status).toBe(501);
    expect(res.body.po_id).toBe('po-direct');
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe('scans — GET /hub/pending (doit primer sur /:order_id)', () => {
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

describe('scans — GET /:order_id (route générique, en dernier)', () => {
  it('400 si order_id n\'est pas un UUID valide', async () => {
    const res = await request(app).get('/api/scans/not-a-uuid');
    expect(res.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('réservé admin (403 pour agent_relais)', async () => {
    currentUser = { id: 'u1', role: 'agent_relais' };
    const res = await request(app).get('/api/scans/123e4567-e89b-12d3-a456-426614174000');
    expect(res.status).toBe(403);
  });

  it('renvoie les scans pour un UUID valide', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 's1', step: 'sourcing' }] });
    const res = await request(app).get('/api/scans/123e4567-e89b-12d3-a456-426614174000');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: 's1', step: 'sourcing' }]);
  });
});

describe('scans — exports', () => {
  it('ré-exporte triggerScan3 pour purchasing.js, qui délègue au service', async () => {
    let router;
    jest.isolateModules(() => { router = require('../../routes/scans'); });
    expect(typeof router.triggerScan3).toBe('function');
    await router.triggerScan3('order-1', 'user-1');
    expect(mockTriggerScan3).toHaveBeenCalledWith('order-1', 'user-1');
  });
});
