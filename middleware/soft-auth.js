/**
 * @komerce-arch
 * @role          auth-soft-auth
 * @domain        auth
 * @layer         middleware
 * @criticality   high
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db, utils/logger.js, utils/user-cache.js, utils/auth-token-policy.js
 * @db-write      none
 * @db-read       revoked_tokens, users
 * @used-by       routes/orders/detail.js
 * @doctrine      canonical_session_claims_only
 * @impact-areas  auth
 * @version       2026-08
 */

'use strict';

/**
 * KOMERCE — Middleware soft-auth.
 *
 * Tente de peupler req.user sans jamais bloquer la route publique. AUTH-8e :
 * un JWT signé mais non canonique (scoped/API/ancien token incomplet) est traité
 * exactement comme une absence de session et ne peut pas charger un user.
 */

const jwt       = require('jsonwebtoken');
const db        = require('../db');
const log       = require('../utils/logger').child({ module: 'soft-auth' });
const userCache = require('../utils/user-cache');
const { sessionClaimsVerdict } = require('../utils/auth-token-policy');

const _JWT_SECRET = process.env.JWT_SECRET;

const { readAuthToken } = require('../utils/auth-cookie');
function extractToken(req) { return readAuthToken(req); }

async function softAuthenticate(req, res, next) {
  req.user = undefined;

  try {
    const token = extractToken(req);
    if (!token) return next();

    let decoded;
    try {
      decoded = jwt.verify(token, _JWT_SECRET, { algorithms: ['HS256'] });
    } catch (jwtErr) {
      log.warn({ err: jwtErr.message }, '[SOFT-AUTH] Token invalide — accès public');
      return next();
    }

    const sessionVerdict = sessionClaimsVerdict(decoded);
    if (!sessionVerdict.ok) {
      log.warn({ reason: sessionVerdict.reason }, '[SOFT-AUTH] JWT non-session ignoré — accès public');
      return next();
    }

    const { rows: revoked } = await db.query(
      'SELECT 1 FROM revoked_tokens WHERE jti = $1 LIMIT 1',
      [decoded.jti]
    );
    if (revoked.length) {
      log.warn({ jti: decoded.jti }, '[SOFT-AUTH] Token révoqué — accès public');
      return next();
    }

    let user = userCache.get(decoded.id);

    if (!user) {
      const { rows } = await db.query(
        `SELECT id, full_name, email, phone, role, currency_pref, relais_id
         FROM users WHERE id = $1`,
        [decoded.id]
      );
      if (!rows.length) {
        log.warn({ userId: decoded.id }, '[SOFT-AUTH] Utilisateur introuvable — accès public');
        return next();
      }
      user = rows[0];
      userCache.set(decoded.id, user);
    }

    req.user = user;
    return next();

  } catch (err) {
    log.error({ err }, '[SOFT-AUTH] Erreur inattendue — accès public par sécurité');
    return next();
  }
}

module.exports = { softAuthenticate };
