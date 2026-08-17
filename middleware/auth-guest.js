/**
 * @komerce-arch
 * @role          auth-auth-guest
 * @domain        auth
 * @layer         middleware
 * @criticality   high
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db, utils/logger.js, utils/phone.js, utils/user-cache.js
 * @db-read      revoked_tokens, users
 * @used-by       routes/orders/create.js, routes/payments-paypal.js, routes/shared-cart.js
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  auth
 * @version       2026-06
 */

'use strict';

/**
 * KOMERCE — Middleware d'authentification (OTP-only, plus de guest checkout)
 *
 * authenticateOrCreateGuest :
 *   1. Si un token valide est présent (cookie kmrc_jwt ou Bearer) :
 *        - refuse (401 Session expirée) si le jti est révoqué
 *        - charge req.user depuis le cache, ou la DB si absent du cache
 *        - refuse (401 identity_required) si le user n'existe pas en DB
 *   2. Sinon (pas de token, token invalide/expiré) → refuse strictement
 *      (401 identity_required)
 *
 * RÈGLE SANS EXCEPTION : aucune commande sans identité vérifiée par OTP.
 * La création de compte se fait UNIQUEMENT via /api/auth/otp/verify (seul
 * endroit où la possession du numéro est prouvée). Le nom du middleware
 * ("...OrCreateGuest") est un historique conservé pour ne pas casser les
 * imports existants — il n'y a plus aucune création de guest ici.
 *
 * Utilisation :
 *   router.post('/', authenticateOrCreateGuest, validate(orders.create), handler)
 *
 * HOOK AGENT (tablette/comptoir, à câbler le jour venu) :
 *   un agent authentifié pourra créer une commande pour un tiers ici,
 *   borné à son relais — son identité (login) remplace l'OTP client.
 *   Pour l'instant : refus strict, aucune exception.
 */

const jwt  = require('jsonwebtoken');
const db   = require('../db');
const log = require('../utils/logger').child({ module: 'auth-guest' });
// N2 FIX: cache partagé avec auth.js (même Map, même TTL, même invalidation)
const userCache = require('../utils/user-cache');
// A-BE-04 FIX: normalisation téléphone centralisée (back-end conservateur, sans devinette pays)
const { normalizePhone } = require('../utils/phone');

const _JWT_SECRET  = process.env.JWT_SECRET;

// ── Cache utilisateur partagé via utils/user-cache.js (N2 FIX) ────────
function getCachedUser(userId) { return userCache.get(userId); }
function setCachedUser(userId, user) { userCache.set(userId, user); }

// AUTH-8a — lecture centralisée du cookie d'auth (utils/auth-cookie.js)
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

// ══════════════════════════════════════════════════════════════════════
// MIDDLEWARE PRINCIPAL
// ══════════════════════════════════════════════════════════════════════

async function authenticateOrCreateGuest(req, res, next) {
  try {
    // ── CAS 1 : Token valide présent ─────────────────────────────────
    const token = extractToken(req);
    if (token) {
      try {
        const decoded = jwt.verify(token, _JWT_SECRET, { algorithms: ['HS256'] });

        // N4 — refuser explicitement les JWT révoqués.
        // Ne pas fallthrough vers création guest : une session révoquée doit rester invalide.
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
        // Token valide mais user introuvable → identité requise (pas de création auto)
        return res.status(401).json({ error: 'Identité requise', code: 'identity_required' });
      } catch (err) {
        if (err.name !== 'JsonWebTokenError' && err.name !== 'TokenExpiredError') {
          log.warn({ err }, '[auth-guest] erreur verif token:');
        }
        // token invalide/expiré → tombe vers le refus ci-dessous
      }
    }

    // ── CAS 2 : Pas de session vérifiée ──────────────────────────────
    // RÈGLE SANS EXCEPTION : aucune commande sans identité vérifiée par OTP.
    // La création de compte se fait UNIQUEMENT via /api/auth/otp/verify
    // (seul endroit où la possession du numéro est prouvée).
    // Le front gère ce 401 en déclenchant requireIdentity() → flux OTP.
    //
    // HOOK AGENT (tablette/comptoir, à câbler le jour venu) :
    //   un agent authentifié pourra créer une commande pour un tiers ici,
    //   borné à son relais — son identité (login) remplace l'OTP client.
    //   Pour l'instant : refus strict, aucune exception.
    return res.status(401).json({
      error: 'Vérification du numéro requise pour commander',
      code: 'identity_required',
    });

  } catch (err) {
    log.error('[auth-guest] erreur inattendue:', err);
    return res.status(500).json({ error: 'Erreur serveur lors de l\'authentification' });
  }
}

// Invalidation de cache (partagée — invalide aussi le cache de auth.js)
function invalidateUserCache(userId) {
  userCache.invalidate(userId);
}

module.exports = {
  authenticateOrCreateGuest,
  invalidateUserCache,
  normalizePhone, // exporté au cas où d'autres modules en ont besoin
};





