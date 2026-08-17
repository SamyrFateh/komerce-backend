/**
 * @komerce-arch
 * @role          auth-auth-guest
 * @domain        auth
 * @layer         middleware
 * @criticality   high
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db, utils/logger.js, utils/phone.js, utils/user-cache.js, utils/auth-token-policy.js
 * @db-read       revoked_tokens, users
 * @used-by       routes/orders/create.js, routes/payments-paypal.js, routes/shared-cart.js
 * @doctrine      canonical_session_claims_only, no_guest_checkout
 * @impact-areas  auth
 * @version       2026-08
 */

'use strict';

/**
 * KOMERCE — Middleware d'authentification (OTP-only, plus de guest checkout)
 *
 * La source de session peut être cookie ou Bearer pour compatibilité API, mais
 * AUTH-8e impose les claims de session canoniques avant tout chargement user.
 * Un JWT scoped/signé ne peut jamais devenir une identité checkout.
 */

const jwt  = require('jsonwebtoken');
const db   = require('../db');
const log = require('../utils/logger').child({ module: 'auth-guest' });
const userCache = require('../utils/user-cache');
const { normalizePhone } = require('../utils/phone');
const { sessionClaimsVerdict } = require('../utils/auth-token-policy');

const _JWT_SECRET  = process.env.JWT_SECRET;

function getCachedUser(userId) { return userCache.get(userId); }
function setCachedUser(userId, user) { userCache.set(userId, user); }

const { readAuthToken } = require('../utils/auth-cookie');
function extractToken(req) { return readAuthToken(req); }

async function isTokenRevoked(jti) {
  if (!jti) return false;
  const { rows } = await db.query(
    'SELECT 1 FROM revoked_tokens WHERE jti = $1 LIMIT 1',
    [jti]
  );
  return rows.length > 0;
}

async function authenticateOrCreateGuest(req, res, next) {
  try {
    const token = extractToken(req);
    if (token) {
      try {
        const decoded = jwt.verify(token, _JWT_SECRET, { algorithms: ['HS256'] });
        const sessionVerdict = sessionClaimsVerdict(decoded);
        if (!sessionVerdict.ok) {
          log.warn({ reason: sessionVerdict.reason }, '[auth-guest] JWT signé refusé : pas une session');
          return res.status(401).json({ error: 'Identité requise', code: 'identity_required' });
        }

        if (await isTokenRevoked(decoded.jti)) {
          return res.status(401).json({ error: 'Session expirée — reconnectez-vous' });
        }

        let user = getCachedUser(decoded.id);

        if (!user) {
          const { rows } = await db.query(
            `SELECT id, full_name, email, phone, phone_payer, role, currency_pref
               FROM users WHERE id = $1`,
            [decoded.id]
          );
          if (rows.length) {
            user = rows[0];
            setCachedUser(decoded.id, user);
          }
        }

        if (user) {
          req.user = user;
          return next();
        }
        return res.status(401).json({ error: 'Identité requise', code: 'identity_required' });
      } catch (err) {
        if (err.name !== 'JsonWebTokenError' && err.name !== 'TokenExpiredError') {
          log.warn({ err }, '[auth-guest] erreur verif token:');
        }
      }
    }

    return res.status(401).json({
      error: 'Vérification du numéro requise pour commander',
      code: 'identity_required',
    });

  } catch (err) {
    log.error('[auth-guest] erreur inattendue:', err);
    return res.status(500).json({ error: 'Erreur serveur lors de l\'authentification' });
  }
}

function invalidateUserCache(userId) {
  userCache.invalidate(userId);
}

module.exports = {
  authenticateOrCreateGuest,
  invalidateUserCache,
  normalizePhone,
};
