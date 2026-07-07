/**
 * @komerce-arch
 * @role          auth-request-id
 * @domain        infrastructure
 * @layer         middleware
 * @criticality   medium
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       @unknown
 * @db-write      none
 * @db-read      none
 * @used-by       @unknown
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  auth
 * @version       2026-06
 */

/**
 * KOMERCE — Request ID Middleware (V2.2)
 *
 * Attache un identifiant unique à chaque requête pour la corrélation des erreurs.
 *
 * ─ Comportement :
 *   1. Si le client envoie un header `x-request-id`, on le réutilise
 *   2. Sinon, on en génère un (format: `req_<timestamp>_<random>`)
 *   3. L'ID est attaché à req.requestId et renvoyé dans le header de réponse
 *   4. Les logs d'erreurs incluent automatiquement le request ID
 *
 * ─ Montage dans server.js (AVANT les routes) :
 *   const { requestIdMiddleware } = require('./middleware/request-id');
 *   app.use(requestIdMiddleware);
 */

'use strict';

const { randomBytes } = require('crypto');

function generateRequestId() {
  const ts = Date.now().toString(36);
  const rand = randomBytes(4).toString('hex');
  return `req_${ts}_${rand}`;
}

function requestIdMiddleware(req, res, next) {
  const requestId = req.headers['x-request-id'] || generateRequestId();

  // Attach to request
  req.requestId = requestId;

  // Send back in response
  res.setHeader('x-request-id', requestId);

  next();
}

module.exports = { requestIdMiddleware, generateRequestId };
