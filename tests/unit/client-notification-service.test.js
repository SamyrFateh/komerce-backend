'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const mockQuery = jest.fn();
jest.mock('../../db', () => ({ query: (...args) => mockQuery(...args) }));
const service = require('../../services/client-notification-service');

beforeEach(() => jest.clearAllMocks());

test('émet une notification retrait idempotente et sans canal externe', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{ id: 'notif-1' }] });
  await expect(service.emitPickupReady({
    userId: 'user-1', orderId: 'order-1', orderReference: 'K7A78R6', relaisName: 'Moroni',
  })).resolves.toEqual({ id: 'notif-1' });
  expect(mockQuery.mock.calls[0][0]).toContain('ON CONFLICT');
  expect(mockQuery.mock.calls[0][0]).not.toMatch(/whatsapp|sms|email/i);
  expect(mockQuery.mock.calls[0][1]).toContain('Commande K7A78R6 à retirer au relais Moroni.');
});

test('ignore un événement incomplet et accepte un relais inconnu sans doublon', async () => {
  await expect(service.emitPickupReady({ orderId: 'order-1', orderReference: 'K1' })).resolves.toBeNull();
  await expect(service.emitPickupReady({ userId: 'user-1', orderReference: 'K1' })).resolves.toBeNull();
  await expect(service.emitPickupReady({ userId: 'user-1', orderId: 'order-1' })).resolves.toBeNull();
  const client = { query: jest.fn().mockResolvedValue({ rows: [] }) };
  await expect(service.emitPickupReady({
    dbClient: client, userId: 'user-1', orderId: 'order-1', orderReference: 'K1',
  })).resolves.toBeNull();
  expect(client.query.mock.calls[0][1]).toContain('Commande K1 prête à être retirée au relais.');
});

test('réconcilie les commandes disponibles avant de lister les messages ouverts', async () => {
  mockQuery
    .mockResolvedValueOnce({ rowCount: 0, rows: [] })
    .mockResolvedValueOnce({ rowCount: 1, rows: [] })
    .mockResolvedValueOnce({ rows: [{ id: 'notif-1', severity: 'urgent' }] });
  const rows = await service.listOpenForUser('user-1');
  expect(rows).toEqual([{ id: 'notif-1', severity: 'urgent' }]);
  expect(mockQuery.mock.calls[0][0]).toContain("o.status <> 'available'");
  expect(mockQuery.mock.calls[1][0]).toContain("o.status = 'available'");
  expect(mockQuery.mock.calls[2][1]).toEqual(['user-1']);
});

test('acquitte seulement une notification ouverte appartenant au compte', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{ id: 'notif-1', status: 'acknowledged' }] });
  await service.acknowledgeForUser('user-1', 'notif-1');
  expect(mockQuery.mock.calls[0][0]).toContain('id = $1 AND user_id = $2');
  expect(mockQuery.mock.calls[0][1]).toEqual(['notif-1', 'user-1']);
});

test('retourne null pour un acquittement absent avec le client fourni', async () => {
  const client = { query: jest.fn().mockResolvedValue({ rows: [] }) };
  await expect(service.acknowledgeForUser('user-1', 'notif-x', { dbClient: client })).resolves.toBeNull();
});

test('résout un bandeau retrait devenu obsolète', async () => {
  mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [] });
  await expect(service.resolvePickupForOrder('order-1')).resolves.toBe(1);
  expect(mockQuery.mock.calls[0][0]).toContain("status = 'resolved'");
});

test('réconcilie et résout avec un client SQL fourni', async () => {
  const client = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) };
  await service.reconcilePickupReadyForUser('user-1', { dbClient: client });
  await service.resolvePickupForOrder('order-1', { dbClient: client });
  expect(client.query).toHaveBeenCalledTimes(3);
});

test('réconcilie directement avec la connexion par défaut', async () => {
  mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  await service.reconcilePickupReadyForUser('user-1');
  expect(mockQuery).toHaveBeenCalledTimes(2);
});
