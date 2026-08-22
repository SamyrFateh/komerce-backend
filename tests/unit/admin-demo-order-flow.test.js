'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const state = { user: { id: 'admin-1', role: 'admin' } };
jest.mock('../../middleware/auth', () => ({
  authenticate: (req, _res, next) => { req.user = state.user; next(); },
  requireRole: roles => (req, res, next) => roles.includes(req.user?.role)
    ? next()
    : res.status(403).json({ error: 'forbidden' }),
}));

const mockQuery = jest.fn();
jest.mock('../../db', () => ({ query: (...args) => mockQuery(...args) }));

const mockReconcile = jest.fn();
jest.mock('../../services/client-notification-service', () => ({
  reconcileOrderMilestonesForUser: (...args) => mockReconcile(...args),
}));

const express = require('express');
const request = require('supertest');

const ORDER_ID = '11111111-1111-4111-8111-111111111111';
let app;

beforeEach(() => {
  jest.clearAllMocks();
  state.user = { id: 'admin-1', role: 'admin' };
  app = express();
  jest.isolateModules(() => app.use('/api/admin', require('../../routes/admin/demo-order-flow')));
  app.use((err, _req, res, _next) => res.status(500).json({ error: err.message }));
});

test('refuse un rôle non admin', async () => {
  state.user = { id: 'hub-1', role: 'agent_hub' };
  const response = await request(app).get(`/api/admin/demo/orders/${ORDER_ID}/timeline`);
  expect(response.status).toBe(403);
  expect(mockQuery).not.toHaveBeenCalled();
});

test('valide strictement l’UUID serveur', async () => {
  const response = await request(app).get('/api/admin/demo/orders/not-an-id/timeline');
  expect(response.status).toBe(400);
  expect(response.body.error).toContain('UUID');
});

test('retourne 404 quand la commande est absente', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [] });
  const response = await request(app).get(`/api/admin/demo/orders/${ORDER_ID}/timeline`);
  expect(response.status).toBe(404);
  expect(mockReconcile).not.toHaveBeenCalled();
});

test('renvoie la trace métier complète et réconcilie les notifications', async () => {
  const order = { id: ORDER_ID, reference: 'CMD-42', user_id: 'client-1', status: 'shipped' };
  mockQuery
    .mockResolvedValueOnce({ rows: [order] })
    .mockResolvedValueOnce({ rows: [{ id: 'h1', status: 'shipped' }] })
    .mockResolvedValueOnce({ rows: [{ id: 'n1', title: 'Expédiée' }] })
    .mockResolvedValueOnce({ rows: [{ id: 'i1', invoice_number: 'FAC-1' }] })
    .mockResolvedValueOnce({ rows: [{ id: 'd1', document_type: 'purchase_order' }] });
  mockReconcile.mockResolvedValueOnce(undefined);

  const response = await request(app).get(`/api/admin/demo/orders/${ORDER_ID}/timeline`);

  expect(response.status).toBe(200);
  expect(mockReconcile).toHaveBeenCalledWith('client-1');
  expect(response.body).toEqual({
    order,
    history: [{ id: 'h1', status: 'shipped' }],
    notifications: [{ id: 'n1', title: 'Expédiée' }],
    invoices: [{ id: 'i1', invoice_number: 'FAC-1' }],
    documents: [{ id: 'd1', document_type: 'purchase_order' }],
  });
  expect(mockQuery).toHaveBeenCalledTimes(5);
});

test('accepte une commande sans utilisateur sans réconciliation', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [{ id: ORDER_ID, reference: 'CMD-43', user_id: null }] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [] });

  const response = await request(app).get(`/api/admin/demo/orders/${ORDER_ID}/timeline`);
  expect(response.status).toBe(200);
  expect(mockReconcile).not.toHaveBeenCalled();
});

test('transmet une erreur DB au middleware d’erreur', async () => {
  mockQuery.mockRejectedValueOnce(new Error('db down'));
  const response = await request(app).get(`/api/admin/demo/orders/${ORDER_ID}/timeline`);
  expect(response.status).toBe(500);
  expect(response.body).toEqual({ error: 'db down' });
});
