'use strict';

/** @test-kind unit @test-runner jest @test-requires none */
let mockUser = { id: 'admin-1', email: 'admin@test', role: 'admin' };

jest.mock('../../middleware/auth', () => ({
  authenticate: (req, res, next) => {
    if (!mockUser) return res.status(401).json({ error: 'Non authentifié' });
    req.user = mockUser;
    return next();
  },
  requireRole: roles => (req, res, next) => roles.includes(req.user.role)
    ? next()
    : res.status(403).json({ code: 'role_forbidden' }),
}));

jest.mock('../../db', () => ({ query: jest.fn(), withTransaction: jest.fn() }));
const mockAccess = {
  listOperators: jest.fn(async () => [{ user_id: 'u1', role: 'market_operator', scopes: [{ market_code: 'CM', role: 'manager' }] }]),
  grantScope: jest.fn(async () => ({ changed: true, market: { code: 'CM' }, role: 'manager' })),
  revokeScope: jest.fn(async () => ({ revoked: true, market: { code: 'CM' }, previous_role: 'manager' })),
};
jest.mock('../../services/market-operator-access-service', () => mockAccess);

const express = require('express');
const request = require('supertest');
const router = require('../../routes/admin-market-operators');
function app() { const a = express(); a.use(express.json()); a.use('/api/admin/market-operators', router); return a; }

beforeEach(() => {
  jest.clearAllMocks();
  mockUser = { id: 'admin-1', email: 'admin@test', role: 'admin' };
});

test('GET refuse une session non admin', async () => {
  mockUser = { id: 'partner-1', role: 'market_operator' };
  const res = await request(app()).get('/api/admin/market-operators');
  expect(res.status).toBe(403);
  expect(mockAccess.listOperators).not.toHaveBeenCalled();
});

test('GET liste les opérateurs et leurs scopes', async () => {
  const res = await request(app()).get('/api/admin/market-operators');
  expect(res.status).toBe(200);
  expect(res.body.operators[0].scopes[0]).toEqual(expect.objectContaining({ market_code: 'CM', role: 'manager' }));
});

test('PUT attribue un rôle manager sur CM avec acteur serveur', async () => {
  const res = await request(app())
    .put('/api/admin/market-operators/u1/markets/CM')
    .send({ role: 'manager' });
  expect(res.status).toBe(200);
  expect(mockAccess.grantScope).toHaveBeenCalledWith(expect.anything(), {
    userId: 'u1', marketCode: 'CM', role: 'manager', actorId: 'admin-1',
  });
});

test('DELETE révoque le scope sans suppression historique', async () => {
  const res = await request(app()).delete('/api/admin/market-operators/u1/markets/CM');
  expect(res.status).toBe(200);
  expect(mockAccess.revokeScope).toHaveBeenCalledWith(expect.anything(), {
    userId: 'u1', marketCode: 'CM', actorId: 'admin-1',
  });
});
