'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const express = require('express');
const request = require('supertest');
const mockList = jest.fn();
const mockAck = jest.fn();
jest.mock('../../middleware/auth', () => ({
  authenticate: (req, _res, next) => { req.user = { id: 'user-1', role: 'client' }; next(); },
}));
jest.mock('../../services/client-notification-service', () => ({
  listOpenForUser: (...args) => mockList(...args),
  acknowledgeForUser: (...args) => mockAck(...args),
}));
const router = require('../../routes/client-notifications');
const ID = '3f1a9b2c-1234-4abc-89ab-1234567890ab';

function app() {
  const instance = express();
  instance.use('/api/auth/me/notifications', router);
  instance.use((err, _req, res, _next) => res.status(500).json({ error: err.message }));
  return instance;
}

beforeEach(() => jest.clearAllMocks());

test('liste seulement le flux du compte authentifié sans cache public', async () => {
  mockList.mockResolvedValueOnce([{ id: ID, title: 'Votre colis est disponible' }]);
  const res = await request(app()).get('/api/auth/me/notifications');
  expect(res.status).toBe(200);
  expect(mockList).toHaveBeenCalledWith('user-1');
  expect(res.headers['cache-control']).toBe('private, no-store');
});

test('acquitte avec le user_id et masque les notifications étrangères en 404', async () => {
  mockAck.mockResolvedValueOnce(null);
  const res = await request(app()).post(`/api/auth/me/notifications/${ID}/ack`);
  expect(res.status).toBe(404);
  expect(mockAck).toHaveBeenCalledWith('user-1', ID);
});

test('rejette un identifiant invalide avant le service', async () => {
  expect((await request(app()).post('/api/auth/me/notifications/not-an-id/ack')).status).toBe(404);
  expect(mockAck).not.toHaveBeenCalled();
});

test('retourne la notification acquittée', async () => {
  mockAck.mockResolvedValueOnce({ id: ID, status: 'acknowledged' });
  const res = await request(app()).post(`/api/auth/me/notifications/${ID}/ack`);
  expect(res.status).toBe(200);
  expect(res.body.notification.status).toBe('acknowledged');
});

test('transmet les erreurs de lecture et d acquittement au handler', async () => {
  mockList.mockRejectedValueOnce(new Error('list failed'));
  expect((await request(app()).get('/api/auth/me/notifications')).status).toBe(500);
  mockAck.mockRejectedValueOnce(new Error('ack failed'));
  expect((await request(app()).post(`/api/auth/me/notifications/${ID}/ack`)).status).toBe(500);
});
