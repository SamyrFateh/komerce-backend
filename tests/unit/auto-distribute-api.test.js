'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/auto-distribute-api.test.js
 *
 * Tests du router routes/auto-distribute-api.js
 *
 * Couverture :
 *   ✓ accès réservé admin / agent_hub (403 sinon)
 *   ✓ POST /auto-distribute : cleanup AVANT distribute (ordre garanti), agrège les résultats
 *   ✓ GET /auto-distribute : délègue à getDistribution()
 *   ✓ POST /auto-distribute/cleanup : délègue à cleanupGhostParcels() seul
 */

jest.mock('../../middleware/auth', () => ({
  authenticate: (req, res, next) => { req.user = req.user || { id: 'admin-1', role: 'admin' }; next(); },
  requireRole: (roles) => (req, res, next) => {
    if (!roles.includes(req.user?.role)) return res.status(403).json({ error: 'Accès refusé' });
    next();
  },
}));

jest.mock('../../utils/logger', () => ({ child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }) }));

const mockCleanupGhostParcels = jest.fn();
const mockDistributeAll = jest.fn();
const mockGetDistribution = jest.fn();
jest.mock('../../services/auto-parcel', () => ({
  cleanupGhostParcels: (...args) => mockCleanupGhostParcels(...args),
  distributeAll: (...args) => mockDistributeAll(...args),
  getDistribution: (...args) => mockGetDistribution(...args),
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
    const router = require('../../routes/auto-distribute-api');
    app.use('/api/hub', router);
  });
});

describe('auto-distribute-api — accès', () => {
  it('refuse un rôle non autorisé (ex: client)', async () => {
    currentUser = { id: 'u1', role: 'client' };
    const res = await request(app).get('/api/hub/auto-distribute');
    expect(res.status).toBe(403);
  });

  it('autorise agent_hub', async () => {
    currentUser = { id: 'hub-1', role: 'agent_hub' };
    mockGetDistribution.mockResolvedValueOnce({});
    const res = await request(app).get('/api/hub/auto-distribute');
    expect(res.status).toBe(200);
  });
});

describe('auto-distribute-api — POST /auto-distribute', () => {
  it('exécute le cleanup AVANT la distribution et agrège les résultats', async () => {
    const callOrder = [];
    mockCleanupGhostParcels.mockImplementation(async () => { callOrder.push('cleanup'); return { cancelled: 2 }; });
    mockDistributeAll.mockImplementation(async () => { callOrder.push('distribute'); return { distributed: 5, queued: 1 }; });

    const res = await request(app).post('/api/hub/auto-distribute');

    expect(res.status).toBe(200);
    expect(callOrder).toEqual(['cleanup', 'distribute']);
    expect(res.body).toMatchObject({ distributed: 5, queued: 1, cleanup: { cancelled: 2 } });
    expect(res.body.message).toMatch(/5 commande.*réparti/);
    expect(res.body.message).toMatch(/2 colis fantômes annulés/);
  });
});

describe('auto-distribute-api — GET /auto-distribute', () => {
  it('délègue à getDistribution() seul (pas de cleanup/distribute déclenché)', async () => {
    mockGetDistribution.mockResolvedValueOnce({ overview: 'ok' });

    const res = await request(app).get('/api/hub/auto-distribute');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ overview: 'ok' });
    expect(mockCleanupGhostParcels).not.toHaveBeenCalled();
    expect(mockDistributeAll).not.toHaveBeenCalled();
  });
});

describe('auto-distribute-api — POST /auto-distribute/cleanup', () => {
  it('délègue uniquement à cleanupGhostParcels (pas de distribution déclenchée)', async () => {
    mockCleanupGhostParcels.mockResolvedValueOnce({ cancelled: 3 });

    const res = await request(app).post('/api/hub/auto-distribute/cleanup');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ cancelled: 3 });
    expect(res.body.message).toMatch(/3 colis fantômes annulés/);
    expect(mockDistributeAll).not.toHaveBeenCalled();
  });
});
