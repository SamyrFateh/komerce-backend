'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/verify-authkey-webhook.test.js
 *
 * Tests du middleware middleware/verify-authkey-webhook.js (Lot B1).
 *
 * Le module capture AUTHKEY_WEBHOOK_SECRET au chargement → chaque scénario
 * d'env différent passe par jest.isolateModules + process.env avant le
 * require, comme pour les autres middlewares qui figent un secret au load.
 *
 * Couverture :
 *   Pas de secret configuré : fail-open en dev (next), fail-closed en prod (503)
 *   Secret configuré : token absent → 403, token invalide → 403, token valide
 *     (query) → next, token valide (header x-authkey-token) → next
 *   safeCompare : longueurs différentes → 403 sans throw
 */

jest.mock('../../utils/logger', () => ({
  child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

// NODE_ENV est relu à chaque appel de verifyAuthkeyWebhook (pas figé au load),
// donc il doit rester en place pendant l'invocation — restauré uniquement
// dans afterEach, pas immédiatement après le require.
function loadMiddleware({ secret, nodeEnv } = {}) {
  let mod;
  if (secret === undefined) delete process.env.AUTHKEY_WEBHOOK_SECRET;
  else process.env.AUTHKEY_WEBHOOK_SECRET = secret;
  process.env.NODE_ENV = nodeEnv || 'test';

  jest.isolateModules(() => {
    mod = require('../../middleware/verify-authkey-webhook');
  });

  return mod;
}

afterEach(() => {
  delete process.env.AUTHKEY_WEBHOOK_SECRET;
  process.env.NODE_ENV = 'test';
});

function fakeReqRes({ query = {}, headers = {} } = {}) {
  const req = { query, headers, ip: '1.2.3.4' };
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  const next = jest.fn();
  return { req, res, next };
}

describe('verifyAuthkeyWebhook — pas de secret configuré', () => {
  it('dev/test → fail-open, appelle next()', () => {
    const { verifyAuthkeyWebhook } = loadMiddleware({ secret: undefined, nodeEnv: 'development' });
    const { req, res, next } = fakeReqRes();
    verifyAuthkeyWebhook(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('production → fail-closed, 503', () => {
    const { verifyAuthkeyWebhook } = loadMiddleware({ secret: undefined, nodeEnv: 'production' });
    const { req, res, next } = fakeReqRes();
    verifyAuthkeyWebhook(req, res, next);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(next).not.toHaveBeenCalled();
  });
});

describe('verifyAuthkeyWebhook — secret configuré', () => {
  const SECRET = 'a-very-secret-shared-token-value';

  it('token absent → 403', () => {
    const { verifyAuthkeyWebhook } = loadMiddleware({ secret: SECRET });
    const { req, res, next } = fakeReqRes();
    verifyAuthkeyWebhook(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'Token manquant' });
    expect(next).not.toHaveBeenCalled();
  });

  it('token invalide (query) → 403', () => {
    const { verifyAuthkeyWebhook } = loadMiddleware({ secret: SECRET });
    const { req, res, next } = fakeReqRes({ query: { token: 'wrong-token' } });
    verifyAuthkeyWebhook(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'Token invalide' });
  });

  it('token invalide de longueur différente → 403 sans throw', () => {
    const { verifyAuthkeyWebhook } = loadMiddleware({ secret: SECRET });
    const { req, res, next } = fakeReqRes({ query: { token: 'short' } });
    expect(() => verifyAuthkeyWebhook(req, res, next)).not.toThrow();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('token valide via query → next()', () => {
    const { verifyAuthkeyWebhook } = loadMiddleware({ secret: SECRET });
    const { req, res, next } = fakeReqRes({ query: { token: SECRET } });
    verifyAuthkeyWebhook(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('token valide via header x-authkey-token → next()', () => {
    const { verifyAuthkeyWebhook } = loadMiddleware({ secret: SECRET });
    const { req, res, next } = fakeReqRes({ headers: { 'x-authkey-token': SECRET } });
    verifyAuthkeyWebhook(req, res, next);
    expect(next).toHaveBeenCalled();
  });
});
