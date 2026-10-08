'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const express = require('express');
const request = require('supertest');

let mockUser = { id: 'u1', role: 'admin' };
jest.mock('../../middleware/auth', () => ({
  authenticate: (req, res, next) => {
    if (!mockUser) return res.status(401).json({ error: 'unauthorized' });
    req.user = mockUser;
    next();
  },
  requireRole: roles => (req, res, next) => roles.includes(req.user.role) ? next() : res.status(403).json({ error: 'forbidden' }),
}));

const router = require('../../routes/admin-providers-capabilities');

function app() {
  const a = express();
  a.use('/api/admin/providers', router);
  return a;
}

test('GET /capabilities : admin → projection read-only no-store', async () => {
  mockUser = { id: 'u1', role: 'admin' };
  const res = await request(app()).get('/api/admin/providers/capabilities');
  expect(res.status).toBe(200);
  expect(res.headers['cache-control']).toContain('no-store');
  expect(Array.isArray(res.body.providers)).toBe(true);
});

test('GET /capabilities : non-admin refusé, anonyme refusé', async () => {
  mockUser = { id: 'u2', role: 'finance' };
  expect((await request(app()).get('/api/admin/providers/capabilities')).status).toBe(403);
  mockUser = null;
  expect((await request(app()).get('/api/admin/providers/capabilities')).status).toBe(401);
});

test('aucune méthode mutante exposée', async () => {
  mockUser = { id: 'u1', role: 'admin' };
  for (const m of ['post', 'put', 'patch', 'delete']) {
    expect((await request(app())[m]('/api/admin/providers/capabilities')).status).toBe(404);
  }
});
