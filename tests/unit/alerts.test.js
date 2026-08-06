'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/alerts.test.js
 *
 * Tests du router routes/alerts.js (Lot C, AUDIT_TEST_COVERAGE_GLOBAL_2026-07-03.md).
 *
 * routes/alerts.js était à 0 % — aucun test. Router mince : auth admin,
 * délégation à services/alert-engine (mocké), mapping status/body.
 *
 * Couverture :
 *   ✓ guard requireRole(['admin']) appliqué à toutes les routes
 *   ✓ GET /            : transmet type/severity en query, renvoie {alerts, total}
 *   ✓ POST /run        : runAll() puis getActiveAlerts(), message formaté avec le compte
 *   ✓ POST /:id/ack    : acknowledgeAlert(id, full_name ou 'admin'), 404 si rien retourné
 *   ✓ erreurs service → next(err) → 500 sur chacune des 3 routes
 */

const mockAuthState = { user: { id: 'u-admin', role: 'admin', full_name: 'Fatima Admin' } };

jest.mock('../../middleware/auth', () => ({
  authenticate: (req, res, next) => { req.user = mockAuthState.user; next(); },
  requireRole: (roles) => (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Non authentifié' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: `Accès refusé — rôle requis : ${roles.join(' ou ')}` });
    }
    next();
  },
}));

const mockAlertEngine = {
  getActiveAlerts: jest.fn(),
  runAll: jest.fn(),
  acknowledgeAlert: jest.fn(),
};
jest.mock('../../services/alert-engine', () => mockAlertEngine);

const express = require('express');
const request = require('supertest');

let app;

beforeEach(() => {
  jest.clearAllMocks();
  mockAuthState.user = { id: 'u-admin', role: 'admin', full_name: 'Fatima Admin' };
  app = express();
  app.use(express.json());
  jest.isolateModules(() => {
    const router = require('../../routes/alerts');
    app.use('/api/v2/alerts', router);
  });
});

describe('alerts — accès', () => {
  it('401 si req.user absent', async () => {
    mockAuthState.user = null;
    const res = await request(app).get('/api/v2/alerts');
    expect(res.status).toBe(401);
    expect(mockAlertEngine.getActiveAlerts).not.toHaveBeenCalled();
  });

  it('403 si rôle non-admin', async () => {
    mockAuthState.user = { id: 'u1', role: 'agent_hub' };
    const res = await request(app).get('/api/v2/alerts');
    expect(res.status).toBe(403);
  });
});

describe('GET /api/v2/alerts', () => {
  it('sans filtre : transmet {type: undefined, severity: undefined}', async () => {
    mockAlertEngine.getActiveAlerts.mockResolvedValueOnce([]);
    const res = await request(app).get('/api/v2/alerts');
    expect(res.status).toBe(200);
    expect(mockAlertEngine.getActiveAlerts).toHaveBeenCalledWith({ type: undefined, severity: undefined });
    expect(res.body).toEqual({ alerts: [], total: 0 });
  });

  it('avec filtres type + severity en query', async () => {
    const alerts = [{ id: 'inc1' }, { id: 'inc2' }];
    mockAlertEngine.getActiveAlerts.mockResolvedValueOnce(alerts);
    const res = await request(app).get('/api/v2/alerts').query({ type: 'stuck_parcel', severity: 'high' });
    expect(res.status).toBe(200);
    expect(mockAlertEngine.getActiveAlerts).toHaveBeenCalledWith({ type: 'stuck_parcel', severity: 'high' });
    expect(res.body).toEqual({ alerts, total: 2 });
  });

  it('erreur service → next(err) → 500', async () => {
    mockAlertEngine.getActiveAlerts.mockRejectedValueOnce(new Error('db down'));
    const res = await request(app).get('/api/v2/alerts');
    expect(res.status).toBe(500);
  });
});

describe('POST /api/v2/alerts/run', () => {
  it('lance runAll() puis renvoie le total actif recalculé', async () => {
    mockAlertEngine.runAll.mockResolvedValueOnce([{ id: 'new1' }, { id: 'new2' }]);
    mockAlertEngine.getActiveAlerts.mockResolvedValueOnce([{ id: 'new1' }, { id: 'new2' }, { id: 'old1' }]);

    const res = await request(app).post('/api/v2/alerts/run');

    expect(res.status).toBe(200);
    expect(mockAlertEngine.runAll).toHaveBeenCalled();
    expect(mockAlertEngine.getActiveAlerts).toHaveBeenCalledWith();
    expect(res.body).toEqual({
      message: 'Détection terminée — 2 nouvelle(s) alerte(s)',
      new_alerts: 2,
      total_active: 3,
      alerts: [{ id: 'new1' }, { id: 'new2' }, { id: 'old1' }],
    });
  });

  it('0 nouvelle alerte : message formaté avec 0', async () => {
    mockAlertEngine.runAll.mockResolvedValueOnce([]);
    mockAlertEngine.getActiveAlerts.mockResolvedValueOnce([]);
    const res = await request(app).post('/api/v2/alerts/run');
    expect(res.body.message).toBe('Détection terminée — 0 nouvelle(s) alerte(s)');
    expect(res.body.new_alerts).toBe(0);
  });

  it('erreur runAll → next(err) → 500', async () => {
    mockAlertEngine.runAll.mockRejectedValueOnce(new Error('db down'));
    const res = await request(app).post('/api/v2/alerts/run');
    expect(res.status).toBe(500);
  });

  it('erreur getActiveAlerts (après runAll ok) → next(err) → 500', async () => {
    mockAlertEngine.runAll.mockResolvedValueOnce([]);
    mockAlertEngine.getActiveAlerts.mockRejectedValueOnce(new Error('db down'));
    const res = await request(app).post('/api/v2/alerts/run');
    expect(res.status).toBe(500);
  });
});

describe('POST /api/v2/alerts/:id/ack', () => {
  it('délègue à acknowledgeAlert avec full_name de req.user', async () => {
    mockAlertEngine.acknowledgeAlert.mockResolvedValueOnce({ id: 'inc1', status: 'investigating' });
    const res = await request(app).post('/api/v2/alerts/inc1/ack');
    expect(mockAlertEngine.acknowledgeAlert).toHaveBeenCalledWith('inc1', 'Fatima Admin');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: 'Alerte acquittée', alert: { id: 'inc1', status: 'investigating' } });
  });

  it("fallback 'admin' si req.user.full_name absent", async () => {
    mockAuthState.user = { id: 'u-admin', role: 'admin' }; // pas de full_name
    mockAlertEngine.acknowledgeAlert.mockResolvedValueOnce({ id: 'inc1' });
    await request(app).post('/api/v2/alerts/inc1/ack');
    expect(mockAlertEngine.acknowledgeAlert).toHaveBeenCalledWith('inc1', 'admin');
  });

  it('404 si aucune alerte mise à jour (déjà traitée ou introuvable)', async () => {
    mockAlertEngine.acknowledgeAlert.mockResolvedValueOnce(undefined);
    const res = await request(app).post('/api/v2/alerts/inc-nope/ack');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Alerte non trouvée ou déjà traitée' });
  });

  it('erreur service → next(err) → 500', async () => {
    mockAlertEngine.acknowledgeAlert.mockRejectedValueOnce(new Error('db down'));
    const res = await request(app).post('/api/v2/alerts/inc1/ack');
    expect(res.status).toBe(500);
  });
});
