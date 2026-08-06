'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/auth-middleware.test.js
 *
 * Tests du middleware middleware/auth.js — authenticate / requireRole / requireAdmin
 *
 * Structure proche de require-verified-identity.js (Lot C), mais avec un
 * cache utilisateur partagé (utils/user-cache) au lieu d'un cache local,
 * et une extraction de token cookie-first plutôt que header-only.
 *
 * Couverture :
 *   ✓ extractToken : priorité cookie kmrc_jwt > header Authorization Bearer
 *   ✓ authenticate : 401 token manquant si ni cookie ni header
 *   ✓ authenticate : 401 si jti révoqué (DB)
 *   ✓ authenticate : pas de vérification révocation si jti absent du payload
 *   ✓ authenticate : user en cache → pas de requête DB users
 *   ✓ authenticate : user absent du cache → requête DB → peuple le cache
 *   ✓ authenticate : 401 si user introuvable en DB malgré JWT valide
 *   ✓ authenticate : 401 TokenExpiredError (pas de log.error)
 *   ✓ authenticate : 401 JsonWebTokenError (pas de log.error)
 *   ✓ authenticate : erreur inattendue → log.error + 401 générique (jamais next(err))
 *   ✓ requireRole : 401 si req.user absent
 *   ✓ requireRole : 403 si le rôle ne correspond pas, avec your_role et liste des rôles
 *   ✓ requireRole : next() si le rôle correspond
 *   ✓ requireAdmin : raccourci équivalent à requireRole(['admin'])
 *   ✓ invalidateUserCache : délègue à userCache.invalidate
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

function validToken(payload = {}) {
  return jwt.sign({ id: 'user-1', jti: 'jti-1', ...payload }, process.env.JWT_SECRET, { algorithm: 'HS256' });
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('authenticate — extraction du token', () => {
  it('401 "Token manquant" si ni cookie ni header', async () => {
    const req = { headers: {} };
    const res = makeRes();
    const next = jest.fn();

    await authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Token manquant — connectez-vous' });
    expect(next).not.toHaveBeenCalled();
  });

  it('priorise le cookie kmrc_jwt même si un header Authorization est aussi présent', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockCacheGet.mockReturnValueOnce({ id: 'user-1', role: 'client' });

    const cookieToken = validToken({ id: 'from-cookie' });
    const req = {
      headers: { authorization: 'Bearer some-other-token' },
      cookies: { kmrc_jwt: cookieToken },
    };
    const res = makeRes();
    const next = jest.fn();

    await authenticate(req, res, next);

    // Le décodage a réussi (donc c'est bien le cookie qui a été utilisé, pas le header invalide)
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('utilise le header Authorization Bearer si pas de cookie', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockCacheGet.mockReturnValueOnce({ id: 'user-1', role: 'client' });

    const req = { headers: { authorization: `Bearer ${validToken()}` } };
    const res = makeRes();
    const next = jest.fn();

    await authenticate(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('ignore un header Authorization mal formé (sans "Bearer ")', async () => {
    const req = { headers: { authorization: 'Basic abc123' } };
    const res = makeRes();
    const next = jest.fn();

    await authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('gère req.cookies absent sans planter (passe au header)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockCacheGet.mockReturnValueOnce({ id: 'user-1', role: 'client' });

    const req = { headers: { authorization: `Bearer ${validToken()}` } }; // pas de req.cookies du tout
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

  it('ne vérifie pas la révocation si jti est absent du payload', async () => {
    const tokenWithoutJti = jwt.sign({ id: 'user-1' }, process.env.JWT_SECRET, { algorithm: 'HS256' });
    mockCacheGet.mockReturnValueOnce({ id: 'user-1', role: 'client' });

    const req = { headers: { authorization: `Bearer ${tokenWithoutJti}` } };
    const res = makeRes();
    const next = jest.fn();

    await authenticate(req, res, next);

    expect(mockQuery).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });
});

describe('authenticate — résolution utilisateur (cache partagé)', () => {
  it('utilise le cache si présent (pas de requête DB users)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockCacheGet.mockReturnValueOnce({ id: 'user-1', role: 'admin' });

    const req = { headers: { authorization: `Bearer ${validToken()}` } };
    const res = makeRes();
    const next = jest.fn();

    await authenticate(req, res, next);

    expect(mockQuery).toHaveBeenCalledTimes(1); // uniquement la requête de révocation
    expect(mockCacheSet).not.toHaveBeenCalled();
    expect(req.user).toEqual({ id: 'user-1', role: 'admin' });
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('charge depuis la DB et peuple le cache si absent', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // révocation
      .mockResolvedValueOnce({ rows: [{ id: 'user-1', full_name: 'Jean', role: 'client' }] }); // users
    mockCacheGet.mockReturnValueOnce(null);

    const req = { headers: { authorization: `Bearer ${validToken()}` } };
    const res = makeRes();
    const next = jest.fn();

    await authenticate(req, res, next);

    expect(mockCacheSet).toHaveBeenCalledWith('user-1', { id: 'user-1', full_name: 'Jean', role: 'client' });
    expect(req.user).toEqual({ id: 'user-1', full_name: 'Jean', role: 'client' });
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('401 "Utilisateur introuvable" si absent en DB malgré JWT valide', async () => {
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
    const expiredToken = jwt.sign({ id: 'user-1' }, process.env.JWT_SECRET, {
      algorithm: 'HS256', expiresIn: -10,
    });

    const req = { headers: { authorization: `Bearer ${expiredToken}` } };
    const res = makeRes();
    const next = jest.fn();

    await authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Token expiré — veuillez vous reconnecter' });
  });

  it('401 "Token invalide" pour JsonWebTokenError (signature incorrecte)', async () => {
    const badToken = jwt.sign({ id: 'user-1' }, 'wrong-secret', { algorithm: 'HS256' });

    const req = { headers: { authorization: `Bearer ${badToken}` } };
    const res = makeRes();
    const next = jest.fn();

    await authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Token invalide' });
  });

  it('401 générique pour une erreur inattendue (ex: DB down), jamais next(err)', async () => {
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
  it('401 "Non authentifié" si req.user est absent', () => {
    const req = {};
    const res = makeRes();
    const next = jest.fn();

    requireRole(['admin'])(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Non authentifié' });
    expect(next).not.toHaveBeenCalled();
  });

  it("403 avec la liste des rôles requis et your_role si le rôle ne correspond pas", () => {
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
    expect(res.status).not.toHaveBeenCalled();
  });
});

describe('requireAdmin', () => {
  it('est un raccourci équivalent à requireRole(["admin"])', () => {
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
