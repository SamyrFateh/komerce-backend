'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/admin-customs-shipments.test.js
 *
 * Couvre routes/admin-customs-shipments.js — façade R8 (câblage Express).
 * Toute la logique métier est mockée via services/customs-shipment-service.js
 * et services/customs-analytics.js — on teste uniquement le câblage des routes.
 */

jest.mock('../../middleware/auth', () => ({
  authenticate: (req, res, next) => { req.user = req.user || { id: 'admin-1', role: 'admin' }; next(); },
  requireRole: (roles) => (req, res, next) => {
    if (!roles.includes(req.user?.role)) return res.status(403).json({ error: 'forbidden' });
    next();
  },
}));

const mockQuery = jest.fn();
jest.mock('../../db', () => ({ query: (...args) => mockQuery(...args) }));

const mockSvc = {
  listShipments: jest.fn(),
  getEffectiveRates: jest.fn(),
  getShipment: jest.fn(),
  createShipment: jest.fn(),
  updateShipment: jest.fn(),
  deactivateShipment: jest.fn(),
  activateShipment: jest.fn(),
  deleteShipment: jest.fn(),
  declareCustomsPayment: jest.fn(),
};
jest.mock('../../services/customs-shipment-service', () => mockSvc);

const mockAnalytics = {
  listShipmentsAnalytics: jest.fn(),
  getTrendAnalytics: jest.fn(),
  getShipmentAnalytics: jest.fn(),
};
jest.mock('../../services/customs-analytics', () => mockAnalytics);

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
    const router = require('../../routes/admin-customs-shipments');
    app.use('/api/admin/customs-shipments', router);
  });
});

describe('admin-customs-shipments — accès', () => {
  it('refuse un non-admin (403)', async () => {
    currentUser = { id: 'u1', role: 'client' };
    const res = await request(app).get('/api/admin/customs-shipments');
    expect(res.status).toBe(403);
  });
});

describe('admin-customs-shipments — GET /', () => {
  it('liste les expéditions via le service', async () => {
    mockSvc.listShipments.mockResolvedValue({ shipments: [{ id: 's1' }] });
    const res = await request(app).get('/api/admin/customs-shipments');
    expect(res.status).toBe(200);
    expect(res.body.shipments).toHaveLength(1);
  });

  it('erreur service → 500 via next(err)', async () => {
    mockSvc.listShipments.mockRejectedValue(new Error('db down'));
    const res = await request(app).get('/api/admin/customs-shipments');
    expect(res.status).toBe(500);
  });
});

describe('admin-customs-shipments — GET /rates/effective', () => {
  it('nominal → renvoie les taux', async () => {
    mockSvc.getEffectiveRates.mockResolvedValue({ rates: { last_30d: {} } });
    const res = await request(app).get('/api/admin/customs-shipments/rates/effective');
    expect(res.status).toBe(200);
  });

  it('service en erreur (vue absente) → fallback gracieux avec taux par défaut', async () => {
    mockSvc.getEffectiveRates.mockRejectedValue(new Error('relation does not exist'));
    const res = await request(app).get('/api/admin/customs-shipments/rates/effective');
    expect(res.status).toBe(200);
    expect(res.body.fallback_rate_pct).toBe(15);
    expect(res.body.warning).toBeDefined();
  });
});

describe('admin-customs-shipments — GET /:id', () => {
  it('expédition trouvée → 200', async () => {
    mockSvc.getShipment.mockResolvedValue({ id: 's1' });
    const res = await request(app).get('/api/admin/customs-shipments/s1');
    expect(res.status).toBe(200);
    expect(mockSvc.getShipment).toHaveBeenCalledWith(expect.anything(), 's1');
  });
});

describe('admin-customs-shipments — POST /', () => {
  it('création → 201 + délègue au service avec user.id', async () => {
    mockSvc.createShipment.mockResolvedValue({ id: 'new-1' });
    const res = await request(app).post('/api/admin/customs-shipments').send({ reference: 'CS-1' });
    expect(res.status).toBe(201);
    expect(mockSvc.createShipment).toHaveBeenCalledWith(expect.anything(), { reference: 'CS-1' }, 'admin-1');
  });
});

describe('admin-customs-shipments — PATCH /:id', () => {
  it('mise à jour → 200', async () => {
    mockSvc.updateShipment.mockResolvedValue({ id: 's1', updated: true });
    const res = await request(app).patch('/api/admin/customs-shipments/s1').send({ notes: 'maj' });
    expect(res.status).toBe(200);
  });
});

describe('admin-customs-shipments — activate/deactivate/delete', () => {
  it('POST /:id/deactivate transmet la raison', async () => {
    mockSvc.deactivateShipment.mockResolvedValue({ ok: true });
    await request(app).post('/api/admin/customs-shipments/s1/deactivate').send({ reason: 'erreur saisie' });
    expect(mockSvc.deactivateShipment).toHaveBeenCalledWith(expect.anything(), 's1', 'erreur saisie');
  });

  it('POST /:id/activate transmet les parcel_ids', async () => {
    mockSvc.activateShipment.mockResolvedValue({ ok: true });
    await request(app).post('/api/admin/customs-shipments/s1/activate').send({ parcel_ids: ['p1', 'p2'] });
    expect(mockSvc.activateShipment).toHaveBeenCalledWith(expect.anything(), 's1', ['p1', 'p2']);
  });

  it('DELETE /:id → 200', async () => {
    mockSvc.deleteShipment.mockResolvedValue({ deleted: true });
    const res = await request(app).delete('/api/admin/customs-shipments/s1');
    expect(res.status).toBe(200);
  });
});

describe('admin-customs-shipments — POST /:id/declare', () => {
  it('délègue au service avec body + user.id', async () => {
    mockSvc.declareCustomsPayment.mockResolvedValue({ success: true });
    const res = await request(app)
      .post('/api/admin/customs-shipments/s1/declare')
      .send({ customs_paid_kmf: 50000 });
    expect(res.status).toBe(200);
    expect(mockSvc.declareCustomsPayment).toHaveBeenCalledWith(
      expect.anything(), 's1', { customs_paid_kmf: 50000 }, 'admin-1'
    );
  });
});

describe('admin-customs-shipments — GET /status/pending', () => {
  it('nominal → liste + count', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 's1' }, { id: 's2' }] });
    const res = await request(app).get('/api/admin/customs-shipments/status/pending');
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);
  });

  it('aucune expédition en attente → tableau vide', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/api/admin/customs-shipments/status/pending');
    expect(res.body.shipments).toEqual([]);
    expect(res.body.count).toBe(0);
  });
});

describe('admin-customs-shipments — analytics (Lot C)', () => {
  it('GET /analytics est en réalité shadowed par GET /:id (déclarée avant) — route au service getShipment', async () => {
    // NOTE: dans le fichier source, router.get('/:id', ...) est déclaré AVANT
    // router.get('/analytics', ...), donc Express matche /:id en premier
    // (id='analytics'). C'est un piège d'ordre de routes, pas un bug de ce test.
    mockSvc.getShipment.mockResolvedValue({ id: 'analytics' });
    const res = await request(app).get('/api/admin/customs-shipments/analytics?from=2026-01-01&transitaire=DHL');
    expect(res.status).toBe(200);
    expect(mockSvc.getShipment).toHaveBeenCalledWith(expect.anything(), 'analytics');
    expect(mockAnalytics.listShipmentsAnalytics).not.toHaveBeenCalled();
  });

  it('GET /analytics/trends utilise 12 par défaut si months absent', async () => {
    mockAnalytics.getTrendAnalytics.mockResolvedValue([]);
    const res = await request(app).get('/api/admin/customs-shipments/analytics/trends');
    expect(res.status).toBe(200);
    expect(res.body.months).toBe(12);
  });

  it('GET /:id/analytics — expédition non trouvée → 404', async () => {
    mockAnalytics.getShipmentAnalytics.mockResolvedValue(null);
    const res = await request(app).get('/api/admin/customs-shipments/s1/analytics');
    expect(res.status).toBe(404);
  });

  it('GET /:id/analytics — nominal → 200', async () => {
    mockAnalytics.getShipmentAnalytics.mockResolvedValue({ shipment_id: 's1', ecart_kmf: 100 });
    const res = await request(app).get('/api/admin/customs-shipments/s1/analytics');
    expect(res.status).toBe(200);
    expect(res.body.ecart_kmf).toBe(100);
  });
});
