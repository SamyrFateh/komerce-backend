/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

/**
 * KOMERCE — Tests Unitaires : routes/admin/dashboard (Lot B4)
 *
 * Redirections rétro-compatibles pures (301 + payload informatif), aucune
 * logique métier. Couvre le guard de rôle (admin only) et les 3 routes.
 *
 * Run : npx jest tests/unit/admin-dashboard-route.test.js
 */

'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('../../utils/logger', () => ({
  child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

let mockUser = { id: 'admin-1', role: 'admin' };
jest.mock('../../middleware/auth', () => ({
  authenticate: (req, res, next) => {
    if (!mockUser) return res.status(401).json({ error: 'Token manquant' });
    req.user = mockUser;
    next();
  },
  requireRole: (roles) => (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Accès réservé' });
    }
    next();
  },
}));

const router = require('../../routes/admin/dashboard');

function buildApp() {
  const app = express();
  app.use('/api/admin', router);
  app.use((err, req, res, next) => res.status(500).json({ error: err.message }));
  return app;
}

describe('routes/admin/dashboard', () => {
  beforeEach(() => {
    mockUser = { id: 'admin-1', role: 'admin' };
  });

  test('refuse un rôle non admin', async () => {
    mockUser = { id: 'u1', role: 'agent_hub' };
    const res = await request(buildApp()).get('/api/admin/dashboard');
    expect(res.status).toBe(403);
  });

  test('refuse sans authentification', async () => {
    mockUser = null;
    const res = await request(buildApp()).get('/api/admin/dashboard');
    expect(res.status).toBe(401);
  });

  test('GET /dashboard redirige vers /api/dashboard/ops', async () => {
    const res = await request(buildApp()).get('/api/admin/dashboard');
    expect(res.status).toBe(301);
    expect(res.body.redirect).toBe('/api/dashboard/ops');
  });

  test('GET /margins redirige vers /api/dashboard/finance', async () => {
    const res = await request(buildApp()).get('/api/admin/margins');
    expect(res.status).toBe(301);
    expect(res.body.redirect).toBe('/api/dashboard/finance');
  });

  test('GET /alerts redirige vers /api/dashboard/ops', async () => {
    const res = await request(buildApp()).get('/api/admin/alerts');
    expect(res.status).toBe(301);
    expect(res.body.redirect).toBe('/api/dashboard/ops');
  });
});
