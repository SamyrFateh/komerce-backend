'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/** Routes GET shadow de routes/admin-costing.js : admin, validation, marché, 404. */

jest.mock('../../middleware/auth', () => ({
  authenticate: (req, res, next) => { req.user = req.user || { id: 'admin-1', role: 'admin' }; next(); },
  requireAdmin: (req, res, next) => { if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Accès admin requis' }); next(); },
}));
jest.mock('../../utils/logger', () => ({ child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }) }));
jest.mock('../../db', () => ({ query: jest.fn() }));
jest.mock('../../services/cost-allocation', () => ({}));
jest.mock('../../services/dashboard-cache', () => ({}));

const mockCompute = jest.fn();
const mockList = jest.fn();
jest.mock('../../services/cost-allocation/real-margin-shadow', () => ({
  computeOrderRealMarginShadow: (...a) => mockCompute(...a),
  listRealMarginShadow: (...a) => mockList(...a),
}));

const express = require('express');
const request = require('supertest');

const OID = '33333333-3333-4333-8333-333333333333';
const MID = '11111111-1111-4111-8111-111111111111';
let app;
let user;

beforeEach(() => {
  jest.clearAllMocks();
  user = { id: 'admin-1', role: 'admin' };
  app = express();
  app.use((req, res, next) => { req.user = user; next(); });
  app.use('/api/admin/costing', require('../../routes/admin-costing'));
  app.use((err, req, res, next) => { res.status(500).json({ error: err.message }); }); // eslint-disable-line no-unused-vars
});

describe('admin-costing — GET real-margin-shadow', () => {
  it('detail : 200, market_id de query transmis (jamais le body)', async () => {
    mockCompute.mockResolvedValue({ order_id: OID, completeness: 'provisional' });
    const res = await request(app).get(`/api/admin/costing/orders/${OID}/real-margin-shadow?market_id=${MID}`);
    expect(res.status).toBe(200);
    expect(mockCompute).toHaveBeenCalledWith(OID, { marketId: MID });
  });

  it('detail : 404 si absente, 400 si id invalide, 403 hors admin', async () => {
    mockCompute.mockResolvedValue(null);
    expect((await request(app).get(`/api/admin/costing/orders/${OID}/real-margin-shadow`)).status).toBe(404);
    expect((await request(app).get('/api/admin/costing/orders/xx/real-margin-shadow')).status).toBe(400);
    user = { id: 'u', role: 'customer' };
    expect((await request(app).get(`/api/admin/costing/orders/${OID}/real-margin-shadow`)).status).toBe(403);
  });

  it('liste : market_id obligatoire (400) puis délégation au service', async () => {
    expect((await request(app).get('/api/admin/costing/real-margin-shadow')).status).toBe(400);
    mockList.mockResolvedValue({ items: [] });
    const res = await request(app).get(`/api/admin/costing/real-margin-shadow?market_id=${MID}&limit=10&offset=5&since_days=30`);
    expect(res.status).toBe(200);
    expect(mockList).toHaveBeenCalledWith({ marketId: MID, limit: '10', offset: '5', sinceDays: '30' });
  });
});
