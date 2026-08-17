'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const mockQuery = jest.fn();
jest.mock('../../db', () => ({ query: (...args) => mockQuery(...args) }));

const management = require('../../services/webauthn-management-service');

describe('webauthn-management-service', () => {
  beforeEach(() => jest.clearAllMocks());

  it('liste uniquement des métadonnées sûres et jamais credential_id/public_key/sign_count', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{
      id: '11111111-1111-4111-8111-111111111111',
      device_label: 'Passkey iPhone',
      created_at: '2026-08-01T10:00:00Z',
      last_used_at: '2026-08-17T10:00:00Z',
      backup_eligible: true,
      backup_state: true,
    }] });

    const rows = await management.listCredentials('user-A');
    expect(rows).toEqual([expect.objectContaining({
      id: '11111111-1111-4111-8111-111111111111',
      device_label: 'Passkey iPhone',
      backup_state: true,
    })]);
    expect(Object.keys(rows[0])).not.toContain('credential_id');
    expect(Object.keys(rows[0])).not.toContain('public_key');
    expect(Object.keys(rows[0])).not.toContain('sign_count');
    expect(mockQuery.mock.calls[0][0]).not.toMatch(/credential_id|public_key|sign_count/i);
    expect(mockQuery.mock.calls[0][1]).toEqual(['user-A']);
  });

  it('révoque seulement la credential appartenant au user authentifié', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{
      id: '11111111-1111-4111-8111-111111111111',
      revoked_at: '2026-08-17T10:00:00Z',
    }] });

    const result = await management.revokeCredential({
      userId: 'user-A',
      credentialManagementId: '11111111-1111-4111-8111-111111111111',
    });
    expect(result.revoked).toBe(true);
    expect(mockQuery.mock.calls[0][0]).toMatch(/WHERE id = \$1\s+AND user_id = \$2/i);
    expect(mockQuery.mock.calls[0][1]).toEqual([
      '11111111-1111-4111-8111-111111111111',
      'user-A',
    ]);
  });

  it('ne révèle pas si un ID appartient à un autre compte', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const result = await management.revokeCredential({
      userId: 'user-A',
      credentialManagementId: '22222222-2222-4222-8222-222222222222',
    });
    expect(result).toEqual({ revoked: false, error: 'credential_not_found' });
  });
});

describe('routes AUTH-6', () => {
  const express = require('express');
  const request = require('supertest');
  let app;
  let currentUser;
  let mockManagement;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env.JWT_SECRET = 'test_secret_min_32_chars_aaaaaaaaaaaaaaaa';
    currentUser = null;
    mockManagement = {
      listCredentials: jest.fn(),
      revokeCredential: jest.fn(),
    };

    app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.user = currentUser; next(); });

    jest.isolateModules(() => {
      jest.doMock('../../middleware/auth', () => ({
        authenticate: (req, res, next) => req.user ? next() : res.status(401).json({ error: 'unauthorized' }),
      }));
      jest.doMock('../../services/webauthn-management-service', () => mockManagement);
      const router = require('../../routes/auth-passkey');
      app.use('/api/auth/passkey', router);
    });
  });

  it('GET credentials exige une session', async () => {
    const res = await request(app).get('/api/auth/passkey/credentials');
    expect(res.status).toBe(401);
    expect(mockManagement.listCredentials).not.toHaveBeenCalled();
  });

  it('GET credentials renvoie la liste sûre du compte courant', async () => {
    currentUser = { id: 'user-A', role: 'client' };
    mockManagement.listCredentials.mockResolvedValue([{ id: 'mgmt-1', device_label: 'Passkey iPhone' }]);
    const res = await request(app).get('/api/auth/passkey/credentials');
    expect(res.status).toBe(200);
    expect(res.body.credentials).toHaveLength(1);
    expect(mockManagement.listCredentials).toHaveBeenCalledWith('user-A');
  });

  it('DELETE rejette un ID de gestion malformé avant le service', async () => {
    currentUser = { id: 'user-A', role: 'client' };
    const res = await request(app).delete('/api/auth/passkey/credentials/not-a-uuid');
    expect(res.status).toBe(400);
    expect(mockManagement.revokeCredential).not.toHaveBeenCalled();
  });

  it('DELETE scelle la révocation au user authentifié', async () => {
    currentUser = { id: 'user-A', role: 'client' };
    const id = '11111111-1111-4111-8111-111111111111';
    mockManagement.revokeCredential.mockResolvedValue({ revoked: true, id });
    const res = await request(app).delete(`/api/auth/passkey/credentials/${id}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ revoked: true, id });
    expect(mockManagement.revokeCredential).toHaveBeenCalledWith({
      userId: 'user-A', credentialManagementId: id,
    });
  });

  it('DELETE répond 404 sans révéler un credential étranger', async () => {
    currentUser = { id: 'user-A', role: 'client' };
    const id = '22222222-2222-4222-8222-222222222222';
    mockManagement.revokeCredential.mockResolvedValue({ revoked: false, error: 'credential_not_found' });
    const res = await request(app).delete(`/api/auth/passkey/credentials/${id}`);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Passkey introuvable' });
  });
});
