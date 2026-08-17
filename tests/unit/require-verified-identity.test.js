'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/require-verified-identity.test.js
 *
 * Tests du middleware middleware/require-verified-identity.js
 *
 * Couverture :
 *   ✓ 401 identity_required si aucun token (cookie ni Bearer)
 *   ✓ extraction du token via cookie kmrc_jwt
 *   ✓ extraction du token via header Authorization Bearer
 *   ✓ 401 si jti révoqué (DB)
 *   ✓ user trouvé en cache → pas de requête DB
 *   ✓ user absent du cache → requête DB → req.user peuplé + mise en cache
 *   ✓ 401 si user introuvable en DB malgré JWT valide
 *   ✓ 401 TokenExpiredError
 *   ✓ 401 JsonWebTokenError
 *   ✓ erreur inattendue → next(err)
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
jest.mock('../../utils/user-cache', () => ({
  get: (...args) => mockCacheGet(...args),
  set: (...args) => mockCacheSet(...args),
}));

const { requireVerifiedIdentityForCheckout } = require('../../middleware/require-verified-identity');

function makeRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

function validToken(payload = {}) {
  return jwt.sign({
    id: 'user-1', jti: 'jti-1', auth_time: 1700000000, amr: ['otp'], token_use: 'session', ...payload,
  }, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '1h' });
}

describe('requireVerifiedIdentityForCheckout — extraction du token', () => {
  it('401 identity_required si aucun token', async () => {
    const req = { headers: {} };
    const res = makeRes();
    const next = jest.fn();

    await requireVerifiedIdentityForCheckout(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'identity_required' })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('extrait le token depuis le cookie kmrc_jwt', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // pas révoqué
    mockCacheGet.mockReturnValueOnce({ id: 'user-1', role: 'client' });

    const req = { headers: {}, cookies: { kmrc_jwt: validToken() } };
    const res = makeRes();
    const next = jest.fn();

    await requireVerifiedIdentityForCheckout(req, res, next);

    expect(req.user).toEqual({ id: 'user-1', role: 'client' });
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('extrait le token depuis le header Authorization Bearer', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockCacheGet.mockReturnValueOnce({ id: 'user-1', role: 'client' });

    const req = { headers: { authorization: `Bearer ${validToken()}` } };
    const res = makeRes();
    const next = jest.fn();

    await requireVerifiedIdentityForCheckout(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user.id).toBe('user-1');
  });

  it('ignore un header Authorization mal formé (sans Bearer)', async () => {
    const req = { headers: { authorization: 'Basic abc123' } };
    const res = makeRes();
    const next = jest.fn();

    await requireVerifiedIdentityForCheckout(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
  });
});

describe('requireVerifiedIdentityForCheckout — révocation', () => {
  it('401 identity_required si le jti est révoqué', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }); // révoqué

    const req = { headers: { authorization: `Bearer ${validToken()}` } };
    const res = makeRes();
    const next = jest.fn();

    await requireVerifiedIdentityForCheckout(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'identity_required' })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('refuse un JWT signé incomplet avant tout accès DB', async () => {
    const tokenWithoutJti = jwt.sign({ id: 'user-1' }, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '1h' });
    const req = { headers: { authorization: `Bearer ${tokenWithoutJti}` } };
    const res = makeRes();
    const next = jest.fn();

    await requireVerifiedIdentityForCheckout(req, res, next);

    expect(mockQuery).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});

describe('requireVerifiedIdentityForCheckout — résolution utilisateur', () => {
  it('utilise le cache si disponible (pas de requête DB users)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // révocation check
    mockCacheGet.mockReturnValueOnce({ id: 'user-1', role: 'client' });

    const req = { headers: { authorization: `Bearer ${validToken()}` } };
    const res = makeRes();
    const next = jest.fn();

    await requireVerifiedIdentityForCheckout(req, res, next);

    expect(mockQuery).toHaveBeenCalledTimes(1); // seulement la requête de révocation
    expect(mockCacheSet).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('charge depuis la DB et peuple le cache si absent du cache', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // révocation
      .mockResolvedValueOnce({ rows: [{ id: 'user-1', full_name: 'Jean' }] }); // users
    mockCacheGet.mockReturnValueOnce(null);

    const req = { headers: { authorization: `Bearer ${validToken()}` } };
    const res = makeRes();
    const next = jest.fn();

    await requireVerifiedIdentityForCheckout(req, res, next);

    expect(mockCacheSet).toHaveBeenCalledWith('user-1', { id: 'user-1', full_name: 'Jean' });
    expect(req.user).toEqual({ id: 'user-1', full_name: 'Jean' });
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('401 identity_required si user introuvable en DB malgré JWT valide', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // révocation
      .mockResolvedValueOnce({ rows: [] }); // users — vide
    mockCacheGet.mockReturnValueOnce(null);

    const req = { headers: { authorization: `Bearer ${validToken()}` } };
    const res = makeRes();
    const next = jest.fn();

    await requireVerifiedIdentityForCheckout(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'identity_required' })
    );
    expect(next).not.toHaveBeenCalled();
  });
});

describe('requireVerifiedIdentityForCheckout — erreurs JWT', () => {
  it('401 si le token est expiré', async () => {
    const expiredToken = jwt.sign({ id: 'user-1' }, process.env.JWT_SECRET, {
      algorithm: 'HS256',
      expiresIn: -10,
    });

    const req = { headers: { authorization: `Bearer ${expiredToken}` } };
    const res = makeRes();
    const next = jest.fn();

    await requireVerifiedIdentityForCheckout(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'identity_required' })
    );
  });

  it('401 si le token est invalide (signature incorrecte)', async () => {
    const badToken = jwt.sign({ id: 'user-1' }, 'wrong-secret', { algorithm: 'HS256' });

    const req = { headers: { authorization: `Bearer ${badToken}` } };
    const res = makeRes();
    const next = jest.fn();

    await requireVerifiedIdentityForCheckout(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'identity_required', error: expect.stringContaining('Token invalide') })
    );
  });

  it('propage à next(err) toute erreur inattendue (ex: DB down)', async () => {
    const dbError = new Error('connection refused');
    mockQuery.mockRejectedValueOnce(dbError);

    const req = { headers: { authorization: `Bearer ${validToken()}` } };
    const res = makeRes();
    const next = jest.fn();

    await requireVerifiedIdentityForCheckout(req, res, next);

    expect(next).toHaveBeenCalledWith(dbError);
    expect(res.status).not.toHaveBeenCalled();
  });
});
