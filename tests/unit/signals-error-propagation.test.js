'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const express = require('express');
const request = require('supertest');

const mockQuery = jest.fn();
jest.mock('../../db', () => ({ query: (...args) => mockQuery(...args) }));

jest.mock('../../middleware/auth', () => ({
  authenticate: (req, res, next) => { req.user = { id: 'admin-1', role: 'admin' }; next(); },
  requireAdmin: (req, res, next) => next(),
}));

jest.mock('../../services/signal-service', () => ({ generateSignals: jest.fn() }));

const router = require('../../routes/signals');

function app() {
  const instance = express();
  instance.use(express.json());
  instance.use('/api/admin/signals', router);
  instance.use((err, req, res, next) => res.status(500).json({ error: err.message }));
  return instance;
}

beforeEach(() => jest.clearAllMocks());

test('Legacy GET DB failure reaches error middleware instead of hanging on undefined next', async () => {
  mockQuery.mockRejectedValueOnce(new Error('db down'));
  const res = await request(app()).get('/api/admin/signals');
  expect(res.status).toBe(500);
  expect(res.body).toEqual({ error: 'db down' });
});

test('Legacy lifecycle DB failure also reaches error middleware', async () => {
  mockQuery.mockRejectedValueOnce(new Error('write down'));
  const res = await request(app()).post('/api/admin/signals/s1/acknowledge');
  expect(res.status).toBe(500);
  expect(res.body).toEqual({ error: 'write down' });
});
