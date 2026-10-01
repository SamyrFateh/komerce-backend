'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

let mockRole = 'admin';

jest.mock('../../middleware/auth', () => ({
  authenticate: (req, res, next) => { req.user = { id: 'u-1', role: mockRole }; next(); },
  requireRole: (roles) => (req, res, next) => (roles.includes(req.user.role) ? next() : res.status(403).json({ code: 'role_forbidden' })),
}));
jest.mock('../../middleware/require-sourcing-global-authority', () => ({
  requireSourcingGlobalAuthority: (req, res, next) => next(),
}));

const mockWs = {
  credentialStatus: jest.fn(),
  configureCredentials: jest.fn(),
  rotateCredentials: jest.fn(),
  revokeCredentials: jest.fn(),
  testSourceConnection: jest.fn(),
};
jest.mock('../../services/sourcing-workspace', () => ({
  SourcingWorkspaceError: class SourcingWorkspaceError extends Error {},
  credentialStatus: (...a) => mockWs.credentialStatus(...a),
  configureCredentials: (...a) => mockWs.configureCredentials(...a),
  rotateCredentials: (...a) => mockWs.rotateCredentials(...a),
  revokeCredentials: (...a) => mockWs.revokeCredentials(...a),
  testSourceConnection: (...a) => mockWs.testSourceConnection(...a),
}));
jest.mock('../../services/sourcing-catalog-change-observation', () => ({}));
jest.mock('../../services/sourcing-integrity-service', () => ({}));

const express = require('express');
const request = require('supertest');
const router = require('../../routes/admin-sourcing-workspace');

const SECRET = 'sk-live-never-echo-0123456789';
const BASE = '/api/admin/workspaces/sourcing/sources/api:cj/credentials';
const app = () => {
  const a = express();
  a.use(express.json());
  a.use('/api/admin/workspaces/sourcing', router);
  return a;
};
const STATUS = { source_ref: 'api:cj', auth_type: 'api_key', configured: true, connected: false, credential_status: 'untested',
  last_tested_at: null, last_test_status: null, expires_at: null, rotation_required: false, provider_account_label: null };

beforeEach(() => {
  jest.clearAllMocks();
  mockRole = 'admin';
  mockWs.credentialStatus.mockResolvedValue(STATUS);
  mockWs.configureCredentials.mockResolvedValue({ ...STATUS, source: { source_ref: 'api:cj' } });
  mockWs.rotateCredentials.mockResolvedValue({ ok: true, rotated: true });
  mockWs.revokeCredentials.mockResolvedValue(STATUS);
  mockWs.testSourceConnection.mockResolvedValue({ ok: true, code: 'connection_ok' });
});

test('enregistrement : le secret transite vers le service, jamais dans la réponse, no-store', async () => {
  const res = await request(app()).post(BASE).send({ credentials: { api_key: SECRET } });
  expect(res.status).toBe(201);
  expect(res.headers['cache-control']).toContain('no-store');
  expect(mockWs.configureCredentials).toHaveBeenCalledWith('api:cj', { api_key: SECRET }, expect.objectContaining({ id: 'u-1' }));
  expect(JSON.stringify(res.body)).not.toContain(SECRET);
});

test('statut : uniquement l’état, aucun champ secret', async () => {
  const res = await request(app()).get(`${BASE}/status`);
  expect(res.status).toBe(200);
  expect(res.headers['cache-control']).toContain('no-store');
  expect(Object.keys(res.body.result).sort()).toEqual(Object.keys(STATUS).sort());
  expect(JSON.stringify(res.body)).not.toMatch(/ciphertext|"iv"|"tag"|secret|token|"api_key":/i);
});

test.each([
  ['post', BASE],
  ['post', `${BASE}/rotate`],
  ['post', `${BASE}/revoke`],
])('rôle non admin refusé en écriture : %s %s', async (method, url) => {
  mockRole = 'sourcing';
  const res = await request(app())[method](url).send({ credentials: { api_key: SECRET } });
  expect(res.status).toBe(403);
  expect(mockWs.configureCredentials).not.toHaveBeenCalled();
  expect(mockWs.rotateCredentials).not.toHaveBeenCalled();
  expect(mockWs.revokeCredentials).not.toHaveBeenCalled();
});

test('rôle étranger au sourcing refusé partout, y compris le statut', async () => {
  mockRole = 'customer';
  expect((await request(app()).get(`${BASE}/status`)).status).toBe(403);
  expect((await request(app()).post(`${BASE}/test`)).status).toBe(403);
});

test('corps sans objet credentials : transmis vide, le service refuse', async () => {
  mockWs.configureCredentials.mockRejectedValue(Object.assign(new Error('Clé API est obligatoire.'), { status: 400, code: 'credentials_field_required' }));
  const res = await request(app()).post(BASE).send({ credentials: 'oops' });
  expect(mockWs.configureCredentials).toHaveBeenCalledWith('api:cj', {}, expect.any(Object));
  expect(res.status).toBe(400);
  expect(res.body).toEqual({ error: 'Clé API est obligatoire.', code: 'credentials_field_required' });
});

test('rotation et révocation : réponses sans secret', async () => {
  const rot = await request(app()).post(`${BASE}/rotate`).send({ credentials: { api_key: SECRET } });
  expect(rot.status).toBe(200);
  expect(JSON.stringify(rot.body)).not.toContain(SECRET);
  const rev = await request(app()).post(`${BASE}/revoke`);
  expect(rev.status).toBe(200);
});

test('test de connexion : résultat métier court', async () => {
  const res = await request(app()).post(`${BASE}/test`);
  expect(res.status).toBe(200);
  expect(res.body.result).toEqual({ ok: true, code: 'connection_ok' });
});
