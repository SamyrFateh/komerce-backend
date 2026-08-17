'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/auth-middleware.test.js
 *
 * AUTH-8e : cookie et Bearer restent deux transports possibles d'une même
 * SESSION canonique, mais aucun JWT scoped/incomplet ne peut passer la garde.
 */

process.env.JWT_SECRET = 'test-secret-auth';

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
  get: (...a) => mockCacheGet(...a),
  set: (...a) => mockCacheSet(...a),
  invalidate: (...a) => mockCacheInvalidate(...a),
}));

const { authenticate, requireRole, requireAdmin, invalidateUserCache } = require('../../middleware/auth');

function makeRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

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

beforeEach(() => {
  jest.clearAllMocks();
});

describe('authenticate — extraction et frontière de session', () => {
  it('401 "Token manquant" si ni cookie ni header', async () => {
    const req = { headers: {} };
    const res = makeRes();
    const next = jest.fn();

    await authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Token manquant — connectez-vous' });
    expect(next).not.toHaveBeenCalled();
  });

  it('priorise le cookie même si un Bearer est aussi présent', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockCacheGet.mockReturnValueOnce({ id: 'from-cookie', role: 'client' });

    const cookieToken = validToken({ id: 'from-cookie' });
    const req = {
      headers: { authorization: 'Bearer some-other-token' },
      cookies: { kmrc_jwt: cookieToken },
    };
    const res = makeRes();
    const next = jest.fn();

    await authenticate(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('accepte un Bearer seulement quand il est une session canonique', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockCacheGet.mockReturnValueOnce({ id: 'user-1', role: 'client' });

    const req = { headers: { authorization: `Bearer ${validToken()}` } };
    const res = makeRes();
    const next = jest.fn();

    await authenticate(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.auth.scoped).toBe(false);
  });

  it('refuse un JWT scoped signé au lieu de le transformer en session', async () => {
    const req = {
      headers: { authorization: `Bearer ${validToken({ scope: 'orders_read' })}` },
    };
    const res = makeRes();
    const next = jest.fn();

    await authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Jeton non autorisé pour une session' });
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockCacheGet).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it('refuse un JWT signé incomplet sans jti/auth_time/amr', async () => {
    const incomplete = jwt.sign({ id: 'user-1' }, process.env.JWT_SECRET, {
      algorithm: 'HS256', expiresIn: '1h',
    });
    const req = { headers: { authorization: `Bearer ${incomplete}` } };
    const res = makeRes();
    const next = jest.fn();

    await authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Jeton non autorisé pour une session' });
    expect(mockQuery).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it('ignore un header Authorization mal formé', async () => {
    const req = { headers: { authorization: 'Basic abc123' } };
    const res = makeRes();
    const next = jest.fn();
    await authenticate(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('gère req.cookies absent et utilise un Bearer canonique', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockCacheGet.mockReturnValueOnce({ id: 'user-1', role: 'client' });
    const req = { headers: { authorization: `Bearer ${validToken()}` } };
    const res = makeRes();
    const next = jest.fn();
    await authenticate(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });
});

describe('authenticate — révocation (jti)', () => {
  it('401 "Session expirée" si le jti est révoqué', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });
    const req = { headers: { authorization: `Bearer ${validToken()}` } };
    const res = makeRes();
    const next = jest.fn();
    await authenticate(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Session expirée — reconnectez-vous' });
    expect(next).not.toHaveBeenCalled();
  });
});

describe('authenticate — résolution utilisateur (cache partagé)', () => {
  it('utilise le cache si présent', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockCacheGet.mockReturnValueOnce({ id: 'user-1', role: 'admin' });
    const req = { headers: { authorization: `Bearer ${validToken()}` } };
    const res = makeRes();
    const next = jest.fn();
    await authenticate(req, res, next);
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockCacheSet).not.toHaveBeenCalled();
    expect(req.user).toEqual({ id: 'user-1', role: 'admin' });
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('charge depuis la DB et peuple le cache si absent', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'user-1', full_name: 'Jean', role: 'client' }] });
    mockCacheGet.mockReturnValueOnce(null);
    const req = { headers: { authorization: `Bearer ${validToken()}` } };
    const res = makeRes();
    const next = jest.fn();
    await authenticate(req, res, next);
    expect(mockCacheSet).toHaveBeenCalledWith('user-1', { id: 'user-1', full_name: 'Jean', role: 'client' });
    expect(req.user).toEqual({ id: 'user-1', full_name: 'Jean', role: 'client' });
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('401 si user absent en DB malgré session valide', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    mockCacheGet.mockReturnValueOnce(null);
    const req = { headers: { authorization: `Bearer ${validToken()}` } };
    const res = makeRes();
    const next = jest.fn();
    await authenticate(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Utilisateur introuvable ou compte supprimé' });
    expect(next).not.toHaveBeenCalled();
  });
});

describe('authenticate — erreurs JWT', () => {
  it('401 "Token expiré" pour TokenExpiredError', async () => {
    const expiredToken = validToken({}, { expiresIn: -10 });
    const req = { headers: { authorization: `Bearer ${expiredToken}` } };
    const res = makeRes();
    const next = jest.fn();
    await authenticate(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Token expiré — veuillez vous reconnecter' });
  });

  it('401 "Token invalide" pour signature incorrecte', async () => {
    const badToken = jwt.sign({
      id: 'user-1', jti: 'j', auth_time: 1700000000, amr: ['otp'], token_use: 'session',
    }, 'wrong-secret', { algorithm: 'HS256', expiresIn: '1h' });
    const req = { headers: { authorization: `Bearer ${badToken}` } };
    const res = makeRes();
    const next = jest.fn();
    await authenticate(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Token invalide' });
  });

  it('401 générique pour erreur DB inattendue, jamais next(err)', async () => {
    mockQuery.mockRejectedValueOnce(new Error('connexion refusée'));
    const req = { headers: { authorization: `Bearer ${validToken()}` } };
    const res = makeRes();
    const next = jest.fn();
    await authenticate(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Token invalide' });
  });
});

describe('requireRole', () => {
  it('401 si req.user est absent', () => {
    const req = {};
    const res = makeRes();
    const next = jest.fn();
    requireRole(['admin'])(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('403 si le rôle ne correspond pas', () => {
    const req = { user: { role: 'client' } };
    const res = makeRes();
    const next = jest.fn();
    requireRole(['admin', 'hub'])(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Accès refusé — rôle requis : admin ou hub',
      your_role: 'client',
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('next() si le rôle correspond', () => {
    const req = { user: { role: 'admin' } };
    const res = makeRes();
    const next = jest.fn();
    requireRole(['admin'])(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });
});

describe('requireAdmin', () => {
  it('est équivalent à requireRole(["admin"])', () => {
    const req = { user: { role: 'admin' } };
    const res = makeRes();
    const next = jest.fn();
    requireAdmin(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('403 pour un rôle non-admin', () => {
    const req = { user: { role: 'client' } };
    const res = makeRes();
    const next = jest.fn();
    requireAdmin(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
  });
});

describe('invalidateUserCache', () => {
  it('délègue à userCache.invalidate(userId)', () => {
    invalidateUserCache('user-42');
    expect(mockCacheInvalidate).toHaveBeenCalledWith('user-42');
  });
});
