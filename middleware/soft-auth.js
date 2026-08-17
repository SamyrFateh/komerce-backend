/**
 * @komerce-arch
 * @role          auth-soft-auth
 * @domain        auth
 * @layer         middleware
 * @criticality   high
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db, utils/logger.js, utils/user-cache.js
 * @db-write      none
 * @db-read      revoked_tokens, users
 * @used-by       routes/orders/detail.js
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  auth
 * @version       2026-06
 */

'use strict';

/**
 * KOMERCE — Middleware soft-auth (F3 / LOT-387)
 *
 * Tente de peupler req.user à partir du token JWT (cookie kmrc_jwt ou Bearer)
 * sans jamais bloquer la requête si le token est absent, invalide ou révoqué.
 *
 * Comportement :
 *   · Token valide, utilisateur trouvé → req.user peuplé, next()
 *   · Token absent                     → req.user = undefined, next()
 *   · Token invalide / expiré          → req.user = undefined, next() + warn log
 *   · Token révoqué (jti)              → req.user = undefined, next() + warn log
 *   · Utilisateur introuvable en DB    → req.user = undefined, next() + warn log
 *
 * Usage :
 *   router.get('/:ref', softAuthenticate, handler)
 *
 * Ne jamais utiliser softAuthenticate comme gardien de sécurité.
 * Pour les routes protégées, utiliser `authenticate` de middleware/auth.js.
 */

const jwt       = require('jsonwebtoken');
const db        = require('../db');
const log       = require('../utils/logger').child({ module: 'soft-auth' });
const userCache = require('../utils/user-cache');

const _JWT_SECRET = process.env.JWT_SECRET;

// AUTH-8a — lecture centralisée du cookie d'auth (utils/auth-cookie.js)
const { readAuthToken } = require('../utils/auth-cookie');
function extractToken(req) { return readAuthToken(req); }

async function softAuthenticate(req, res, next) {
  req.user = undefined; // garantie explicite — jamais de req.user fantôme

  try {
    const token = extractToken(req);
    if (!token) return next(); // pas de token → accès public, on continue

    let decoded;
    try {
      decoded = jwt.verify(token, _JWT_SECRET, { algorithms: ['HS256'] });
    } catch (jwtErr) {
      // Token malformé, expiré ou signature invalide → accès public silencieux
      log.warn({ err: jwtErr.message }, '[SOFT-AUTH] Token invalide — accès public');
      return next();
    }

    // N4 — vérifier la révocation (même logique que authenticate)
    if (decoded.jti) {
      const { rows: revoked } = await db.query(
        'SELECT 1 FROM revoked_tokens WHERE jti = $1 LIMIT 1',
        [decoded.jti]
      );
      if (revoked.length) {
        log.warn({ jti: decoded.jti }, '[SOFT-AUTH] Token révoqué — accès public');
        return next();
      }
    }

    // Cache partagé avec authenticate (utils/user-cache.js — N2)
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
    // Erreur DB inattendue — ne jamais bloquer la route publique
    log.error({ err }, '[SOFT-AUTH] Erreur inattendue — accès public par sécurité');
    return next();
  }
}

module.exports = { softAuthenticate };
