'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/auth.test.js
 *
 * middleware/auth.js (120L) — authenticate, requireRole, requireAdmin,
 * invalidateUserCache. Aucun test existant jusqu'ici malgré une criticité
 * "high" (auth JWT). Premier test écrit avec backendTestKit.js (makeReq/
 * makeRes/makeNext), servant de preuve que le socle backend fonctionne
 * avant de l'étendre aux 237 autres fichiers qui réimplémentent encore
 * leur propre makeReq/makeRes ad hoc.
 */

process.env.JWT_SECRET = 'test-secret';

const jwt = require('jsonwebtoken');

jest.mock('../../utils/logger', () => ({
  child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

const mockQuery = jest.fn();
jest.mock('../../db', () => ({ query: (...args) => mockQuery(...args) }));

const mockCacheGet = jest.fn();
const mockCacheSet = jest.fn();
const mockCacheInvalidate = jest.fn();
jest.mock('../../utils/user-cache', () => ({
  get: (...args) => mockCacheGet(...args),
  set: (...args) => mockCacheSet(...args),
  invalidate: (...args) => mockCacheInvalidate(...args),
}));

const { makeReq, makeRes, makeNext } = require('../helpers/backendTestKit');
const { authenticate, requireRole, requireAdmin, invalidateUserCache } = require('../../middleware/auth');

function validToken(payload = {}, options = {}) {
  return jwt.sign({
    id: 'user-1',
    jti: 'jti-1',
    auth_time: Math.floor(Date.now() / 1000),
    amr: ['otp'],
    token_use: 'session',
    ...payload,
  }, process.env.JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: options.expiresIn ?? '1h',
  });
}

describe('authenticate', () => {
  beforeEach(() => jest.clearAllMocks());

  it('401 si aucun token (ni cookie ni header)', async () => {
    const req = makeReq();
    const res = makeRes();
    const next = makeNext();

    await authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Token manquant — connectez-vous' });
    expect(next).not.toHaveBeenCalled();
  });

  it('token via cookie kmrc_jwt, jti non révoqué, user en cache → req.user peuplé, next() appelé', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // pas révoqué
    mockCacheGet.mockReturnValueOnce({ id: 'user-1', role: 'client' });

    const req = makeReq({ cookies: { kmrc_jwt: validToken() } });
    const res = makeRes();
    const next = makeNext();

    await authenticate(req, res, next);

    expect(req.user).toEqual({ id: 'user-1', role: 'client' });
    expect(next).toHaveBeenCalledTimes(1);
    expect(mockCacheSet).not.toHaveBeenCalled(); // déjà en cache, pas de re-set
  });

  it('token via header Authorization Bearer, user absent du cache → requête DB + mise en cache', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // pas révoqué
      .mockResolvedValueOnce({ rows: [{ id: 'user-1', role: 'admin' }] }); // lookup user
    mockCacheGet.mockReturnValueOnce(undefined);

    const req = makeReq({ headers: { authorization: `Bearer ${validToken()}` } });
    const res = makeRes();
    const next = makeNext();

    await authenticate(req, res, next);

    expect(req.user).toEqual({ id: 'user-1', role: 'admin' });
    expect(mockCacheSet).toHaveBeenCalledWith('user-1', { id: 'user-1', role: 'admin' });
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('401 si jti révoqué', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ 1: 1 }] }); // révoqué

    const req = makeReq({ cookies: { kmrc_jwt: validToken() } });
    const res = makeRes();
    const next = makeNext();

    await authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Session expirée — reconnectez-vous' });
    expect(next).not.toHaveBeenCalled();
  });

  it('401 si user introuvable en DB malgré JWT valide', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    mockCacheGet.mockReturnValueOnce(undefined);

    const req = makeReq({ cookies: { kmrc_jwt: validToken() } });
    const res = makeRes();
    const next = makeNext();

    await authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Utilisateur introuvable ou compte supprimé' });
  });

  it('401 TokenExpiredError', async () => {
    const expired = validToken({}, { expiresIn: -10 });
    const req = makeReq({ cookies: { kmrc_jwt: expired } });
    const res = makeRes();
    const next = makeNext();

    await authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Token expiré — veuillez vous reconnecter' });
  });

  it('401 JsonWebTokenError (token malformé)', async () => {
    const req = makeReq({ cookies: { kmrc_jwt: 'not-a-real-token' } });
    const res = makeRes();
    const next = makeNext();

    await authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Token invalide' });
  });

  it('erreur DB inattendue → 401 Token invalide (catch générique)', async () => {
    mockQuery.mockRejectedValueOnce(new Error('connection lost'));

    const req = makeReq({ cookies: { kmrc_jwt: validToken() } });
    const res = makeRes();
    const next = makeNext();

    await authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Token invalide' });
  });
});

describe('requireRole', () => {
  beforeEach(() => jest.clearAllMocks());

  it('401 si req.user absent', () => {
    const req = makeReq();
    const res = makeRes();
    const next = makeNext();

    requireRole(['admin'])(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Non authentifié' });
    expect(next).not.toHaveBeenCalled();
  });

  it('403 si rôle non autorisé', () => {
    const req = makeReq({ user: { role: 'client' } });
    const res = makeRes();
    const next = makeNext();

    requireRole(['admin', 'relais'])(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Accès refusé — rôle requis : admin ou relais',
      your_role: 'client',
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('rôle autorisé → next() appelé', () => {
    const req = makeReq({ user: { role: 'admin' } });
    const res = makeRes();
    const next = makeNext();

    requireRole(['admin'])(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });
});

describe('requireAdmin', () => {
  it('est un raccourci de requireRole([\'admin\'])', () => {
    const req = makeReq({ user: { role: 'admin' } });
    const res = makeRes();
    const next = makeNext();

    requireAdmin(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('refuse un rôle non-admin', () => {
    const req = makeReq({ user: { role: 'relais' } });
    const res = makeRes();
    const next = makeNext();

    requireAdmin(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
  });
});

describe('invalidateUserCache', () => {
  it('délègue à userCache.invalidate', () => {
    invalidateUserCache('user-1');
    expect(mockCacheInvalidate).toHaveBeenCalledWith('user-1');
  });
});
