/**
 * KOMERCE — Middleware d'authentification JWT (sécurisé)
 *
 * authenticate       : vérifie le token (httpOnly cookie OU Bearer), injecte req.user
 * requireRole(roles) : vérifie que l'utilisateur a le bon rôle
 * requireAdmin       : raccourci pour requireRole(['admin'])
 *
 * Utilisation :
 *   router.get('/admin', authenticate, requireAdmin, handler)
 *   router.get('/hub',   authenticate, requireRole(['admin','agent_hub']), handler)
 *
 * Corrections v9.4 :
 *   - BUG-016 : retrait de relais_id de la query SELECT authenticate
 *     → si la colonne n'existe pas en DB, la query lancçait une erreur
 *       catchée silencieusement → "Token invalide" pour toutes les routes protégées
 *     → relais_id est fetché séparément par les routes qui en ont besoin (hub, etc.)
 *   - BUG-015 : JWT_SECRET fallback aligné sur routes/auth.js
 *   - BUG-014 : JWT lu depuis cookie httpOnly en priorité
 *   - Fallback Bearer header conservé pour compatibilité API externe / mobile
 *   - JWT algorithm verrouillé à HS256
 *   - Cache mémoire user (TTL 5min)
 *   - Logging d'erreur amélioré pour faciliter le debug
 */

const jwt = require('jsonwebtoken');
const db  = require('../db');

// ── Secret JWT ──────────────────────────────────────────────────────────────────────
const _JWT_SECRET = process.env.JWT_SECRET || 'komerce_secret_dev_UNSAFE';

if (!process.env.JWT_SECRET) {
  console.warn('[auth middleware] ⚠️  JWT_SECRET non défini — fallback dev utilisé.');
}

// ── Cache mémoire simple (TTL 5 min) ───────────────────────────────────────────────────
const USER_CACHE_TTL = 5 * 60 * 1000;
const userCache = new Map();

function getCachedUser(userId) {
  const entry = userCache.get(userId);
  if (!entry) return null;
  if (Date.now() - entry.ts > USER_CACHE_TTL) {
    userCache.delete(userId);
    return null;
  }
  return entry.user;
}

function setCachedUser(userId, user) {
  userCache.set(userId, { user, ts: Date.now() });
  if (userCache.size > 10_000) {
    const oldest = userCache.keys().next().value;
    userCache.delete(oldest);
  }
}

/**
 * Extrait le token JWT depuis :
 *   1. Cookie httpOnly `kmrc_jwt` (prioritaire)
 *   2. Header Authorization: Bearer <token> (fallback)
 */
function extractToken(req) {
  if (req.cookies && req.cookies.kmrc_jwt) return req.cookies.kmrc_jwt;
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) return header.split(' ')[1];
  return null;
}

/**
 * Vérifie le token JWT et injecte req.user.
 *
 * BUG-016 : la query SELECT ne demande PAS relais_id — si la colonne est absente
 * de la table users, la query échouait silencieusement → "Token invalide".
 * Les routes qui ont besoin de relais_id (hub.js, etc.) le fetcht séparément.
 */
async function authenticate(req, res, next) {
  try {
    const token = extractToken(req);

    if (!token) {
      return res.status(401).json({ error: 'Token manquant — connectez-vous' });
    }

    const decoded = jwt.verify(token, _JWT_SECRET, {
      algorithms: ['HS256'],
    });

    let user = getCachedUser(decoded.id);

    if (!user) {
      const { rows } = await db.query(
        // BUG-016 : relais_id retiré — colonne potentiellement absente sur users
        `SELECT id, full_name, email, phone, role, currency_pref
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
    // Log l'erreur réelle pour faciliter le debug Railway
    if (err.name !== 'JsonWebTokenError' && err.name !== 'TokenExpiredError') {
      console.error('[authenticate] erreur inattendue:', err.name, err.message);
    }
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expiré — veuillez vous reconnecter' });
    }
    return res.status(401).json({ error: 'Token invalide' });
  }
}

/**
 * Vérifie que req.user a l'un des rôles autorisés.
 */
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
  userCache.delete(userId);
}

module.exports = { authenticate, requireRole, requireAdmin, invalidateUserCache };
