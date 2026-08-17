'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/auth-guest.test.js
 *
 * Tests du middleware middleware/auth-guest.js — authenticateOrCreateGuest
 *
 * Le comportement actuel refuse strictement toute commande sans session
 * vérifiée (RÈGLE SANS EXCEPTION — voir commentaire dans le fichier source) :
 * findOrCreateUser() n'est plus appelée par le middleware principal, la
 * création "guest" a été désactivée au profit du flux OTP-only.
 *
 * Couverture :
 *   ✓ token valide + jti révoqué → 401 "Session expirée"
 *   ✓ token valide + user en cache → req.user peuplé, next()
 *   ✓ token valide + user absent du cache → requête DB, peuple le cache
 *   ✓ token valide + user introuvable en DB → 401 identity_required
 *   ✓ token invalide/expiré → tombe vers le refus 401 identity_required (pas de log.error)
 *   ✓ pas de token → 401 identity_required
 *   ✓ erreur inattendue → 500 + log.error
 *   ✓ invalidateUserCache délègue à userCache.invalidate
 *   ✓ normalizePhone est bien réexportée
 */

process.env.JWT_SECRET = 'test-secret-auth-guest';

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

const {
  authenticateOrCreateGuest,
  invalidateUserCache,
  normalizePhone,
} = require('../../middleware/auth-guest');

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

describe('authenticateOrCreateGuest — pas de token', () => {
  it('401 identity_required si ni cookie ni header', async () => {
    const req = { headers: {}, body: {} };
    const res = makeRes();
    const next = jest.fn();

    await authenticateOrCreateGuest(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Vérification du numéro requise pour commander',
      code: 'identity_required',
    });
    expect(next).not.toHaveBeenCalled();
  });
});

describe('authenticateOrCreateGuest — révocation (jti)', () => {
  it('401 "Session expirée" si le jti est révoqué', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });

    const req = { headers: { authorization: `Bearer ${validToken()}` }, body: {} };
    const res = makeRes();
    const next = jest.fn();

    await authenticateOrCreateGuest(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Session expirée — reconnectez-vous' });
    expect(next).not.toHaveBeenCalled();
  });

  it('ne vérifie pas la révocation si jti est absent du payload (isTokenRevoked court-circuite)', async () => {
    const tokenWithoutJti = jwt.sign({ id: 'user-1' }, process.env.JWT_SECRET, { algorithm: 'HS256' });
    mockCacheGet.mockReturnValueOnce({ id: 'user-1', role: 'client' });

    const req = { headers: { authorization: `Bearer ${tokenWithoutJti}` }, body: {} };
    const res = makeRes();
    const next = jest.fn();

    await authenticateOrCreateGuest(req, res, next);

    expect(mockQuery).not.toHaveBeenCalled(); // pas de requête revoked_tokens
    expect(next).toHaveBeenCalledTimes(1);
  });
});

describe('authenticateOrCreateGuest — résolution utilisateur (cache partagé)', () => {
  it('utilise le cache si présent, req.user peuplé, next()', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // révocation
    mockCacheGet.mockReturnValueOnce({ id: 'user-1', role: 'client' });

    const req = { headers: { authorization: `Bearer ${validToken()}` }, body: {} };
    const res = makeRes();
    const next = jest.fn();

    await authenticateOrCreateGuest(req, res, next);

    expect(mockQuery).toHaveBeenCalledTimes(1); // uniquement révocation
    expect(req.user).toEqual({ id: 'user-1', role: 'client' });
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('charge depuis la DB et peuple le cache si absent', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // révocation
      .mockResolvedValueOnce({ rows: [{ id: 'user-1', full_name: 'Jean', role: 'client' }] }); // users
    mockCacheGet.mockReturnValueOnce(null);

    const req = { headers: { authorization: `Bearer ${validToken()}` }, body: {} };
    const res = makeRes();
    const next = jest.fn();

    await authenticateOrCreateGuest(req, res, next);

    expect(mockCacheSet).toHaveBeenCalledWith('user-1', expect.objectContaining({ id: 'user-1' }));
    expect(req.user).toEqual(expect.objectContaining({ id: 'user-1', full_name: 'Jean' }));
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('401 identity_required si user introuvable en DB malgré JWT valide', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // révocation
      .mockResolvedValueOnce({ rows: [] }); // users
    mockCacheGet.mockReturnValueOnce(null);

    const req = { headers: { authorization: `Bearer ${validToken()}` }, body: {} };
    const res = makeRes();
    const next = jest.fn();

    await authenticateOrCreateGuest(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Identité requise', code: 'identity_required' });
    expect(next).not.toHaveBeenCalled();
  });
});

describe('authenticateOrCreateGuest — token invalide/expiré', () => {
  it('401 identity_required pour un JWT invalide (signature incorrecte)', async () => {
    const badToken = jwt.sign({ id: 'user-1' }, 'wrong-secret', { algorithm: 'HS256' });

    const req = { headers: { authorization: `Bearer ${badToken}` }, body: {} };
    const res = makeRes();
    const next = jest.fn();

    await authenticateOrCreateGuest(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Vérification du numéro requise pour commander',
      code: 'identity_required',
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('401 identity_required pour un JWT expiré', async () => {
    const expiredToken = jwt.sign({ id: 'user-1' }, process.env.JWT_SECRET, {
      algorithm: 'HS256', expiresIn: -10,
    });

    const req = { headers: { authorization: `Bearer ${expiredToken}` }, body: {} };
    const res = makeRes();
    const next = jest.fn();

    await authenticateOrCreateGuest(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe('authenticateOrCreateGuest — extraction du token', () => {
  it('priorise le cookie kmrc_jwt même si un header Authorization est aussi présent', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockCacheGet.mockReturnValueOnce({ id: 'from-cookie', role: 'client' });

    const cookieToken = validToken({ id: 'from-cookie' });
    const req = {
      headers: { authorization: 'Bearer some-other-token' },
      cookies: { kmrc_jwt: cookieToken },
      body: {},
    };
    const res = makeRes();
    const next = jest.fn();

    await authenticateOrCreateGuest(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user.id).toBe('from-cookie');
  });

  it('gère req.cookies absent sans planter (passe au header)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockCacheGet.mockReturnValueOnce({ id: 'user-1', role: 'client' });

    const req = { headers: { authorization: `Bearer ${validToken()}` }, body: {} };
    const res = makeRes();
    const next = jest.fn();

    await authenticateOrCreateGuest(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });
});

describe('authenticateOrCreateGuest — erreur inattendue', () => {
  // Une erreur DB pendant la vérification du token (ex: isTokenRevoked) est
  // interceptée par le try/catch interne et retombe sur le refus 401
  // identity_required — elle n'atteint jamais le catch englobant.
  it('401 identity_required (pas 500) si la DB tombe pendant la vérification du token', async () => {
    mockQuery.mockRejectedValueOnce(new Error('connexion refusée'));

    const req = { headers: { authorization: `Bearer ${validToken()}` }, body: {} };
    const res = makeRes();
    const next = jest.fn();

    await authenticateOrCreateGuest(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Vérification du numéro requise pour commander',
      code: 'identity_required',
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('500 générique + log.error pour une erreur inattendue hors du bloc de vérification token (ex: req totalement absent)', async () => {
    // AUTH-8a a centralisé l'extraction du token dans utils/auth-cookie.js
    // (readAuthToken), qui est défensive : `req.headers && ...` ne plante
    // plus si req.headers est absent — un objet requête sans headers tombe
    // désormais proprement sur le refus 401 identity_required (CAS 2), ce
    // qui est le comportement voulu. Pour exercer le vrai filet de
    // sécurité "erreur inattendue → 500", il faut un cas encore plus
    // dégénéré : req lui-même absent (ce que readAuthToken ne peut pas
    // protéger, par construction — `req.cookies` sur undefined lève).
    const res = makeRes();
    const next = jest.fn();

    await authenticateOrCreateGuest(undefined, res, next);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Erreur serveur lors de l\'authentification' });
    expect(next).not.toHaveBeenCalled();
  });
});

describe('invalidateUserCache', () => {
  it('délègue à userCache.invalidate(userId)', () => {
    invalidateUserCache('user-42');
    expect(mockCacheInvalidate).toHaveBeenCalledWith('user-42');
  });
});

describe('normalizePhone (réexport)', () => {
  it('est bien réexportée depuis utils/phone', () => {
    expect(typeof normalizePhone).toBe('function');
    expect(normalizePhone('+33699272526')).toBe('+33699272526');
  });
});
