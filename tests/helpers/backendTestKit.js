'use strict';

/**
 * tests/helpers/backendTestKit.js
 *
 * Socle de test partagé côté backend (routes, middlewares, services).
 * Point d'entrée unique : les 238 fichiers qui réimplémentaient jusqu'ici
 * leur propre makeReq/makeRes (variantes quasi identiques dans
 * error-handler.test.js, require-verified-identity.test.js, monitoring.test.js,
 * rate-limit.test.js, request-id.test.js…) doivent importer d'ici plutôt que
 * redéfinir localement.
 *
 * Le mock de client DB transactionnel (makeClient / expectTransactionCommitted
 * / expectTransactionRolledBack) existait déjà et est réutilisé par 56
 * fichiers via tests/integration/test-harness/mock-db.js — ce kit le
 * ré-exporte pour n'avoir qu'un seul chemin d'import côté tests/unit.
 */

const {
  makeClient,
  expectTransactionCommitted,
  expectTransactionRolledBack,
} = require('../integration/test-harness/mock-db');

/**
 * Réponse Express mockée, chainable comme la vraie (res.status(x).json(y)).
 * @param {object} [overrides] - méthodes additionnelles à fusionner (ex: res.redirect)
 */
function makeRes(overrides = {}) {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.send = jest.fn().mockReturnValue(res);
  res.end = jest.fn().mockReturnValue(res);
  res.setHeader = jest.fn().mockReturnValue(res);
  res.cookie = jest.fn().mockReturnValue(res);
  res.clearCookie = jest.fn().mockReturnValue(res);
  Object.assign(res, overrides);
  return res;
}

/**
 * Requête Express mockée avec la forme minimale attendue par la plupart
 * des routes/middlewares (headers/params/query/body/cookies/user vides).
 * @param {object} [overrides]
 */
function makeReq(overrides = {}) {
  return {
    method: 'GET',
    originalUrl: '/api/test',
    headers: {},
    params: {},
    query: {},
    body: {},
    cookies: {},
    user: null,
    ...overrides,
  };
}

/** jest.fn() nommé, pour lisibilité des assertions (next).toHaveBeenCalled() */
function makeNext() {
  return jest.fn();
}

/**
 * Invoque un handler Express (route ou middleware) avec req/res/next mockés
 * et attend sa résolution — utile pour les handlers async sans avoir à
 * réécrire le trio req/res/next à chaque test.
 * @param {Function} handler - (req, res, next) => Promise|void
 * @param {object} [reqOverrides]
 * @param {object} [resOverrides]
 * @returns {Promise<{req, res, next}>}
 */
async function invokeHandler(handler, reqOverrides = {}, resOverrides = {}) {
  const req = makeReq(reqOverrides);
  const res = makeRes(resOverrides);
  const next = makeNext();
  await handler(req, res, next);
  return { req, res, next };
}

module.exports = {
  makeReq,
  makeRes,
  makeNext,
  invokeHandler,
  // ré-export du kit DB existant (usage historique, un seul point d'import)
  makeClient,
  expectTransactionCommitted,
  expectTransactionRolledBack,
};
