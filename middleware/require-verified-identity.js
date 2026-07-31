/**
 * @komerce-arch
 * @role          auth-require-verified-identity
 * @domain        auth
 * @layer         middleware
 * @criticality   medium
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db, utils/logger.js, utils/user-cache.js
 * @db-write      none
 * @db-read      revoked_tokens, users
 * @used-by       none
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  auth
 * @version       2026-06
 */

'use strict';

/**
 * KOMERCE — Middleware requireVerifiedIdentityForCheckout
 *
 * Utilisé sur les endpoints "engageants" du checkout :
 *   - POST /api/orders          (commande cash ou Stripe)
 *   - POST /api/payments/stripe/intent
 *
 * Doctrine DOCTRINE_IDENTITE_LEGERE_KOMERCE §15 :
 *   "Les endpoints engageants doivent s'appuyer sur l'utilisateur courant
 *    au lieu de redemander nom / téléphone dans le payload."
 *
 * Règle :
 *   - JWT valide présent → charge req.user et continue.
 *   - JWT absent ou invalide → 401 { code: 'identity_required' }.
 *
 * Ce middleware NE crée PAS de guest automatiquement.
 * Il exige une identité déjà vérifiée par OTP (JWT httpOnly kmrc_jwt).
 *
 * Compatibilité :
 *   authenticateOrCreateGuest reste sur shared-cart et les routes non-engageantes.
 *   Ce middleware s'applique seulement aux endpoints listés ci-dessus.
 *   Ne pas modifier authenticateOrCreateGuest dans cette PR.
 *
 * TODO (Lot 4 post-PR) :
 *   Retirer authenticateOrCreateGuest de routes/orders/create.js une fois
 *   que tous les clients (web, mobile, éventuels appels directs) passent
 *   systématiquement par le flow OTP front.
 */

const jwt  = require('jsonwebtoken');
const db   = require('../db');
const log  = require('../utils/logger').child({ module: 'require-verified-identity' });
const userCache = require('../utils/user-cache');

const _JWT_SECRET = process.env.JWT_SECRET;

function extractToken(req) {
  if (req.cookies && req.cookies.kmrc_jwt) return req.cookies.kmrc_jwt;
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) return header.split(' ')[1];
  return null;
}

async function isTokenRevoked(jti) {
  if (!jti) return false;
  const { rows } = await db.query(
    'SELECT 1 FROM revoked_tokens WHERE jti = $1 LIMIT 1',
    [jti]
  );
  return rows.length > 0;
}
/**
 * requireVerifiedIdentityForCheckout
 *
 * Vérifie la présence d'un JWT valide. Si absent ou invalide, retourne :
 *   HTTP 401 { error: 'Identité non vérifiée', code: 'identity_required' }
 *
 * Le front (b-identity.js / requireIdentity) est en charge d'obtenir ce JWT
 * via le flow OTP avant d'appeler l'endpoint engageant.
 */
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

    // N4 — une identité vérifiée avec un JWT révoqué n'est plus valide.
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


