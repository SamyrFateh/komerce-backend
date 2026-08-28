'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

let mockGlobalAllowed = false;
let mockAllowedMarkets = new Set(['market-km-id']);

jest.mock('../../middleware/auth', () => ({
  authenticate: (req, res, next) => { req.user = { id: 'admin-1', role: 'admin' }; next(); },
  requireAdmin: (req, res, next) => next(),
}));

jest.mock('../../middleware/require-market-scope', () => ({
  attachAuthorizedMarkets: (req, res, next) => { req.authorizedMarkets = new Set(mockAllowedMarkets); next(); },
  requireMarketScope: resolver => (req, res, next) => {
    const id = resolver(req);
    return req.authorizedMarkets && req.authorizedMarkets.has(id)
      ? next()
      : res.status(403).json({ code: 'market_scope_forbidden' });
  },
}));

jest.mock('../../middleware/require-dashboard-global-authority', () => ({
  hasDashboardGlobalAuthority: jest.fn(async () => mockGlobalAllowed),
  requireDashboardGlobalAuthority: (req, res, next) => mockGlobalAllowed
    ? next()
    : res.status(403).json({ code: 'dashboard_global_authority_required' }),
}));

jest.mock('../../db', () => ({ query: jest.fn() }));
jest.mock('../../services/client-index', () => ({ listClients: jest.fn() }));
jest.mock('../../utils/logger', () => ({
  child: () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() }),
}));

const express = require('express');
const request = require('supertest');
const db = require('../../db');
const clientIndex = require('../../services/client-index');
const router = require('../../routes/admin-client-index');

function app() {
  const instance = express();
  instance.use('/api/admin/entities', router);
  instance.use((err, req, res, next) => res.status(500).json({ error: err.message }));
  return instance;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGlobalAllowed = false;
  mockAllowedMarkets = new Set(['market-km-id']);
  db.query.mockResolvedValue({ rows: [{ id: 'market-km-id', code: 'KM', name: 'Comores', currency: 'KMF' }] });
  clientIndex.listClients.mockResolvedValue({ clients: [], pagination: { page: 1, total: 0 } });
});

test('route marché résout KM côté serveur puis transmet uniquement son UUID interne au service', async () => {
  const res = await request(app()).get('/api/admin/entities/clients/market/km?search=Amina&sort=ltv&page=2&page_size=10');
  expect(res.status).toBe(200);
  expect(db.query).toHaveBeenCalledWith(expect.stringContaining('FROM markets'), ['KM']);
  expect(clientIndex.listClients).toHaveBeenCalledWith(
    { search: 'Amina', sort: 'ltv', page: '2', page_size: '10' },
    { marketIds: ['market-km-id'], market: expect.objectContaining({ code: 'KM' }) }
  );
  expect(res.headers['cache-control']).toContain('no-store');
});

test('opérateur sans MarketScope ne peut pas lister un autre marché', async () => {
  mockAllowedMarkets = new Set();
  const res = await request(app()).get('/api/admin/entities/clients/market/KM');
  expect(res.status).toBe(403);
  expect(clientIndex.listClients).not.toHaveBeenCalled();
});

test('autorité globale explicite peut sélectionner un marché sans scope local', async () => {
  mockAllowedMarkets = new Set();
  mockGlobalAllowed = true;
  const res = await request(app()).get('/api/admin/entities/clients/market/KM');
  expect(res.status).toBe(200);
  expect(clientIndex.listClients).toHaveBeenCalled();
});

test('index global exige le grant global explicite', async () => {
  let res = await request(app()).get('/api/admin/entities/clients');
  expect(res.status).toBe(403);
  expect(clientIndex.listClients).not.toHaveBeenCalled();

  mockGlobalAllowed = true;
  res = await request(app()).get('/api/admin/entities/clients?search=269');
  expect(res.status).toBe(200);
  expect(clientIndex.listClients).toHaveBeenCalledWith(
    { search: '269', sort: 'recent', page: '1', page_size: '25' },
    { marketIds: null }
  );
});

test('market_id navigateur, code invalide et marché inconnu sont refusés avant la lecture clients', async () => {
  let res = await request(app()).get('/api/admin/entities/clients/market/KM?market_id=forged');
  expect(res.status).toBe(400);
  expect(res.body.code).toBe('client_market_identity_forbidden');

  res = await request(app()).get('/api/admin/entities/clients/market/KMF');
  expect(res.status).toBe(400);
  expect(res.body.code).toBe('invalid_market_code');

  db.query.mockResolvedValueOnce({ rows: [] });
  res = await request(app()).get('/api/admin/entities/clients/market/CG');
  expect(res.status).toBe(404);
  expect(res.body.code).toBe('market_not_found');
  expect(clientIndex.listClients).not.toHaveBeenCalled();
});

test('erreurs DB/service passent au middleware erreur sans fuite de données', async () => {
  db.query.mockRejectedValueOnce(new Error('market db down'));
  let res = await request(app()).get('/api/admin/entities/clients/market/KM');
  expect(res.status).toBe(500);
  expect(res.body.error).toBe('market db down');

  mockGlobalAllowed = true;
  clientIndex.listClients.mockRejectedValueOnce(new Error('index down'));
  res = await request(app()).get('/api/admin/entities/clients');
  expect(res.status).toBe(500);
  expect(res.body.error).toBe('index down');
});
