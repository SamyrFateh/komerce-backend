/**
 * @komerce-arch
 * @role          auth-auth
 * @domain        auth
 * @layer         middleware
 * @criticality   high
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       @unknown
 * @db-write      @unknown
 * @db-read      revoked_tokens, users
 * @used-by       @unknown
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  auth
 * @version       2026-06
 */

/**
 * KOMERCE — Middleware d'authentification JWT (sécurisé)
 *
 * authenticate       : vérifie le token (httpOnly cookie OU Bearer), injecte req.user
 * requireRole(roles) : vérifie que l'utilisateur a le bon rôle
 * requireAdmin       : raccourci pour requireRole(['admin'])
 */

const jwt = require('jsonwebtoken');
const db  = require('../db');
const log = require('../utils/logger').child({ module: 'auth' });
const userCache = require('../utils/user-cache');

const _JWT_SECRET = process.env.JWT_SECRET;

// Cache partagé via utils/user-cache.js (voir N2 FIX ci-dessus)
function getCachedUser(userId) { return userCache.get(userId); }
function setCachedUser(userId, user) { userCache.set(userId, user); }

function extractToken(req) {
  if (req.cookies && req.cookies.kmrc_jwt) return req.cookies.kmrc_jwt;
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) return header.split(' ')[1];
  return null;
}

async function authenticate(req, res, next) {
  try {
    const token = extractToken(req);

    if (!token) {
      return res.status(401).json({ error: 'Token manquant — connectez-vous' });
    }

    const decoded = jwt.verify(token, _JWT_SECRET, {
      algorithms: ['HS256'],
    });

    // N4 — vérifier que le jti n'est pas révoqué (logout explicite ou token compromis)
    if (decoded.jti) {
      const { rows: revoked } = await db.query(
        'SELECT 1 FROM revoked_tokens WHERE jti = $1 LIMIT 1',
        [decoded.jti]
      );
      if (revoked.length) {
        return res.status(401).json({ error: 'Session expirée — reconnectez-vous' });
      }
    }

    let user = getCachedUser(decoded.id);

    if (!user) {
      const { rows } = await db.query(
        `SELECT id, full_name, email, phone, role, currency_pref, relais_id
         FROM users WHERE id = $1`,
        [decoded.id]
      );

      if (!rows.length) {
        return res.status(401).json({ error: 'Utilisateur introuvable ou compte supprimé' });
      }

      user = rows[0];
      setCachedUser(decoded.id, user);
    }

    req.user = user;

    next();

  } catch (err) {
    if (err.name !== 'JsonWebTokenError' && err.name !== 'TokenExpiredError') {
      log.error('[authenticate] erreur inattendue:', err.name, err.message);
    }
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expiré — veuillez vous reconnecter' });
    }
    return res.status(401).json({ error: 'Token invalide' });
  }
}

function requireRole(roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Non authentifié' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        error: `Accès refusé — rôle requis : ${roles.join(' ou ')}`,
        your_role: req.user.role,
      });
    }
    next();
  };
}

const requireAdmin = requireRole(['admin']);

function invalidateUserCache(userId) {
  userCache.invalidate(userId);
}

module.exports = { authenticate, requireRole, requireAdmin, invalidateUserCache };
