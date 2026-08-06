/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

/**
 * KOMERCE — Tests Unitaires : routes/admin/customs (Lot B4)
 *
 * Stub statique (customs_history non implémenté). Couvre le guard de rôle
 * et la forme de la réponse.
 *
 * Run : npx jest tests/unit/admin-customs-route.test.js
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

const router = require('../../routes/admin/customs');

function buildApp() {
  const app = express();
  app.use('/api/admin', router);
  app.use((err, req, res, next) => res.status(500).json({ error: err.message }));
  return app;
}

describe('routes/admin/customs', () => {
  beforeEach(() => {
    mockUser = { id: 'admin-1', role: 'admin' };
  });

  test('refuse un rôle non admin', async () => {
    mockUser = { id: 'u1', role: 'agent_hub' };
    const res = await request(buildApp()).get('/api/admin/customs');
    expect(res.status).toBe(403);
  });

  test('refuse sans authentification', async () => {
    mockUser = null;
    const res = await request(buildApp()).get('/api/admin/customs');
    expect(res.status).toBe(401);
  });

  test('GET /customs renvoie le stub vide', async () => {
    const res = await request(buildApp()).get('/api/admin/customs');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      history: [], by_category: [], anomalies: [], period_days: 90,
      note: 'customs_history non implémenté',
    });
  });
});
