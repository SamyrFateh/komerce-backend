'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 * @brief P04 — routes des autorisations directrice : grants réservés à l'Admin central, décisions ouvertes aux comptes Hub (le service exige le grant actif).
 */

jest.mock('../../middleware/auth', () => ({
  authenticate: (req, res, next) => (req.user ? next() : res.status(401).json({ error: 'Non authentifié' })),
  requireRole: (roles) => (req, res, next) => (roles.includes(req.user.role) ? next() : res.status(403).json({ error: 'Accès refusé' })),
}));
jest.mock('../../db', () => ({ query: jest.fn() }));
jest.mock('../../services/purchasing-trigger-service', () => ({ triggerPurchasing: jest.fn() }));
jest.mock('../../services/purchasing-admin-service', () => ({ deleteSupplier: jest.fn(), confirmPurchaseOrder: jest.fn(), cancelPurchaseOrder: jest.fn() }));
jest.mock('../../services/purchasing-grouped-service', () => ({}));
jest.mock('../../services/purchasing-order-detail', () => ({ getPurchaseOrderDetail: jest.fn() }));
jest.mock('../../services/purchasing-canonical-money', () => ({ resolveCanonicalMappingMoney: jest.fn() }));
jest.mock('../../services/purchasing-engagement-service', () => ({}));
const mockAuth = { grant: jest.fn(), revoke: jest.fn(), listGrants: jest.fn(), decide: jest.fn() };
jest.mock('../../services/hub-authorization-service', () => mockAuth);

const express = require('express');
const request = require('supertest');

let app; let user;
beforeEach(() => {
  jest.clearAllMocks();
  user = { id: 'u1', role: 'admin' };
  app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.user = user; next(); });
  jest.isolateModules(() => { app.use('/api/purchasing', require('../../routes/purchasing')); });
});

test('attribuer/révoquer/lister : Admin central uniquement', async () => {
  user = { id: 'h1', role: 'agent_hub' };
  expect((await request(app).post('/api/purchasing/authorizations/grants').send({})).status).toBe(403);
  expect((await request(app).post('/api/purchasing/authorizations/grants/x/revoke').send({})).status).toBe(403);
  expect((await request(app).get('/api/purchasing/authorizations/grants')).status).toBe(403);
  expect(mockAuth.grant).not.toHaveBeenCalled();
  user = { id: 'a1', role: 'admin' };
  mockAuth.grant.mockResolvedValue({ id: 'g1' });
  const res = await request(app).post('/api/purchasing/authorizations/grants').send({ user_id: 'u', authorization_type: 'supplier_payment' });
  expect(res.status).toBe(201);
  expect(mockAuth.grant).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u', authorizationType: 'supplier_payment', actor: user }));
});

test('décisions : un compte Hub appelle le service (grant exigé côté service) ; les erreurs métier sont relayées', async () => {
  user = { id: 'h1', role: 'agent_hub' };
  mockAuth.decide.mockRejectedValueOnce(Object.assign(new Error('no grant'), { status: 403, code: 'AUTHORIZATION_GRANT_REQUIRED' }));
  const refused = await request(app).post('/api/purchasing/po/p1/authorize-commitment').send({ proof_ref: 'X' });
  expect(refused.status).toBe(403);
  expect(refused.body.code).toBe('AUTHORIZATION_GRANT_REQUIRED');
  mockAuth.decide.mockResolvedValueOnce({ id: 'd1' });
  const ok = await request(app).post('/api/purchasing/po/p1/authorize-payment').send({ proof_ref: 'X', amount: 3, currency: 'EUR' });
  expect(ok.status).toBe(201);
  expect(mockAuth.decide).toHaveBeenLastCalledWith(expect.objectContaining({ purchaseOrderId: 'p1', authorizationType: 'supplier_payment' }));
  user = { id: 'c1', role: 'client' };
  expect((await request(app).post('/api/purchasing/po/p1/authorize-payment').send({})).status).toBe(403);
});
