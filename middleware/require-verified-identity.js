/**
 * @komerce-arch
 * @role          auth-require-verified-identity
 * @domain        auth
 * @layer         middleware
 * @criticality   medium
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db, utils/logger.js, utils/user-cache.js, utils/auth-token-policy.js
 * @db-write      none
 * @db-read       revoked_tokens, users
 * @used-by       none
 * @doctrine      canonical_session_claims_only
 * @impact-areas  auth
 * @version       2026-08
 */

'use strict';

const jwt  = require('jsonwebtoken');
const db   = require('../db');
const log  = require('../utils/logger').child({ module: 'require-verified-identity' });
const userCache = require('../utils/user-cache');
const { sessionClaimsVerdict } = require('../utils/auth-token-policy');

const _JWT_SECRET = process.env.JWT_SECRET;

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

async function requireVerifiedIdentityForCheckout(req, res, next) {
  const token = extractToken(req);

  if (!token) {
    return res.status(401).json({
      error: 'Identité non vérifiée — confirmez votre WhatsApp pour continuer.',
      code: 'identity_required',
    });
  }

  try {
    const decoded = jwt.verify(token, _JWT_SECRET, { algorithms: ['HS256'] });
    const sessionVerdict = sessionClaimsVerdict(decoded);
    if (!sessionVerdict.ok) {
      log.warn({ reason: sessionVerdict.reason }, '[require-verified-identity] JWT signé refusé : pas une session');
      return res.status(401).json({
        error: 'Identité non vérifiée — confirmez votre WhatsApp pour continuer.',
        code: 'identity_required',
      });
    }

    if (await isTokenRevoked(decoded.jti)) {
      return res.status(401).json({
        error: 'Session expirée — confirmez à nouveau votre WhatsApp.',
        code: 'identity_required',
      });
    }

    let user = userCache.get(decoded.id);
    if (!user) {
      const { rows } = await db.query(
        `SELECT id, full_name, email, phone, phone_payer, role, currency_pref
           FROM users WHERE id = $1`,
        [decoded.id]
      );
      if (!rows.length) {
        log.warn('[require-verified-identity] JWT valide mais user introuvable:', decoded.id);
        return res.status(401).json({
          error: 'Session expirée — confirmez à nouveau votre WhatsApp.',
          code: 'identity_required',
        });
      }
      user = rows[0];
      userCache.set(decoded.id, user);
    }

    req.user = user;
    return next();

  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({
        error: 'Session expirée — confirmez à nouveau votre WhatsApp.',
        code: 'identity_required',
      });
    }
    if (err.name === 'JsonWebTokenError') {
      return res.status(401).json({
        error: 'Token invalide — confirmez votre WhatsApp.',
        code: 'identity_required',
      });
    }
    log.error({ err }, '[require-verified-identity] erreur inattendue:');
    return next(err);
  }
}

module.exports = { requireVerifiedIdentityForCheckout };
