'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/soft-auth.test.js
 *
 * Couvre F3 (LOT-387) — middleware softAuthenticate :
 *
 *   ✅ pas de token          → next() sans req.user
 *   ✅ token valide          → req.user peuplé, next()
 *   ✅ token valide (cache)  → req.user peuplé sans appel DB, next()
 *   ✅ token expiré          → next() sans req.user (pas de 401)
 *   ✅ token révoqué (jti)   → next() sans req.user
 *   ✅ utilisateur introuvable → next() sans req.user
 *   ✅ erreur DB inattendue  → next() sans throw (fail-open)
 */

const jwt = require('jsonwebtoken');

jest.mock('../../db', () => ({ query: jest.fn() }));
jest.mock('../../utils/logger', () => ({
  child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));
jest.mock('../../utils/user-cache', () => {
  const store = new Map();
  return { get: (k) => store.get(k), set: (k, v) => store.set(k, v), clear: () => store.clear() };
});

// middleware/soft-auth.js capture JWT_SECRET au chargement du module (même
// convention que middleware/auth.js — évite un process.env.lookup par requête) :
// il faut donc fixer process.env.JWT_SECRET AVANT de le require, sinon il capture
// la valeur d'environnement ambiante (ex. JWT_SECRET=dummy passé en CLI) et tous
// les tokens signés avec SECRET ci-dessous échouent silencieusement la vérification.
const SECRET = 'test-secret';
process.env.JWT_SECRET = SECRET;

const db        = require('../../db');
const userCache = require('../../utils/user-cache');
const { softAuthenticate } = require('../../middleware/soft-auth');

const USER = { id: 'user-001', full_name: 'Alice', role: 'customer', email: 'a@a.com', phone: '+269600001', currency_pref: 'KMF', relais_id: null };

function makeReq(token) {
  return {
    cookies: token ? { kmrc_jwt: token } : {},
    headers: {},
    user: undefined,
  };
}

function makeRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn() };
}

function makeToken(payload = {}, options = {}) {
  return jwt.sign({ id: 'user-001', ...payload }, SECRET, { algorithm: 'HS256', expiresIn: '1h', ...options });
}

beforeEach(() => {
  // resetAllMocks (pas clearAllMocks) : clearAllMocks ne vide PAS la file des
  // mockResolvedValueOnce() en attente, ce qui a permis à des valeurs mockées
  // non consommées de fuiter d'un test au suivant (cause du bug ci-dessus).
  jest.resetAllMocks();
  userCache.clear();
});

// ─────────────────────────────────────────────────────────────────────────────

test('pas de token → next() sans req.user', async () => {
  const req  = makeReq(null);
  const next = jest.fn();

  await softAuthenticate(req, makeRes(), next);

  expect(next).toHaveBeenCalledTimes(1);
  expect(req.user).toBeUndefined();
  expect(db.query).not.toHaveBeenCalled();
});

test('token valide, utilisateur en DB → req.user peuplé, next()', async () => {
  const token = makeToken({ jti: 'jti-001' }); // jti requis pour déclencher le check revoked_tokens (2 appels DB attendus ci-dessous)
  const req   = makeReq(token);
  const next  = jest.fn();

  db.query
    .mockResolvedValueOnce({ rows: [] })          // revoked_tokens check
    .mockResolvedValueOnce({ rows: [USER] });     // SELECT users

  await softAuthenticate(req, makeRes(), next);

  expect(next).toHaveBeenCalledTimes(1);
  expect(req.user).toEqual(USER);
});

test('token valide, utilisateur en cache → pas d\'appel DB SELECT users', async () => {
  userCache.set('user-001', USER);
  const token = makeToken({ jti: undefined }); // pas de jti → pas de check révocation
  const req   = makeReq(token);
  const next  = jest.fn();

  // Aucun mock DB — si db.query est appelé le test lèvera "no mock"
  db.query.mockResolvedValue({ rows: [] }); // revoked_tokens seulment si jti présent

  await softAuthenticate(req, makeRes(), next);

  expect(next).toHaveBeenCalledTimes(1);
  expect(req.user).toEqual(USER);
});

test('token expiré → next() sans req.user, sans 401', async () => {
  const token = makeToken({}, { expiresIn: '-1s' }); // déjà expiré
  const req   = makeReq(token);
  const next  = jest.fn();

  await softAuthenticate(req, makeRes(), next);

  expect(next).toHaveBeenCalledTimes(1);
  expect(req.user).toBeUndefined();
  expect(db.query).not.toHaveBeenCalled();
});

test('token révoqué (jti présent) → next() sans req.user', async () => {
  const token = makeToken({ jti: 'jti-revoked' });
  const req   = makeReq(token);
  const next  = jest.fn();

  db.query.mockResolvedValueOnce({ rows: [{ 1: 1 }] }); // jti trouvé dans revoked_tokens

  await softAuthenticate(req, makeRes(), next);

  expect(next).toHaveBeenCalledTimes(1);
  expect(req.user).toBeUndefined();
});

test('utilisateur introuvable en DB → next() sans req.user', async () => {
  const token = makeToken({ jti: 'jti-002' }); // jti requis pour déclencher le check revoked_tokens (2 appels DB attendus ci-dessous)
  const req   = makeReq(token);
  const next  = jest.fn();

  db.query
    .mockResolvedValueOnce({ rows: [] })  // revoked_tokens : pas révoqué
    .mockResolvedValueOnce({ rows: [] }); // SELECT users : introuvable

  await softAuthenticate(req, makeRes(), next);

  expect(next).toHaveBeenCalledTimes(1);
  expect(req.user).toBeUndefined();
});

test('erreur DB inattendue → next() sans throw (fail-open)', async () => {
  const token = makeToken();
  const req   = makeReq(token);
  const next  = jest.fn();

  db.query.mockRejectedValue(new Error('DB down'));

  await softAuthenticate(req, makeRes(), next);

  expect(next).toHaveBeenCalledTimes(1);
  expect(req.user).toBeUndefined();
});
