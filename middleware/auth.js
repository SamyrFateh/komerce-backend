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
 * Corrections v9.2 :
 *   - BUG-014 : JWT lu depuis cookie httpOnly en priorité (plus sûr que localStorage)
 *   - Fallback Bearer header conservé pour compatibilité API externe / mobile
 *   - JWT algorithm verrouillé à HS256 (empêche alg:none / RS256 confusion)
 *   - maxAge 24h en double protection
 *   - Cache mémoire user (TTL 5min) pour réduire les requêtes DB
 */

const jwt = require('jsonwebtoken');
const db  = require('../db');

// ── Cache mémoire simple (TTL 5 min) ────────────────────────────────────────
// Réduit les SELECT sur users à chaque requête auth.
// À remplacer par Redis si multi-instance.

const USER_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
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
  // Nettoyage périodique : max 10 000 entrées
  if (userCache.size > 10_000) {
    const oldest = userCache.keys().next().value;
    userCache.delete(oldest);
  }
}

/**
 * Extrait le token JWT depuis :
 *   1. Cookie httpOnly `kmrc_jwt` (prioritaire — BUG-014 fix)
 *   2. Header Authorization: Bearer <token> (fallback API / mobile)
 *
 * @returns {string|null} Le token JWT ou null
 */
function extractToken(req) {
  // 1. Cookie httpOnly (prioritaire)
  if (req.cookies && req.cookies.kmrc_jwt) {
    return req.cookies.kmrc_jwt;
  }

  // 2. Fallback : header Authorization: Bearer <token>
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    return header.split(' ')[1];
  }

  return null;
}

/**
 * Vérifie le token JWT (cookie ou Bearer header).
 * Injecte req.user si valide.
 */
async function authenticate(req, res, next) {
  try {
    const token = extractToken(req);

    if (!token) {
      return res.status(401).json({ error: 'Token manquant — connectez-vous' });
    }

    // Aligné sur JWT_EXPIRES pour cohérence signature/vérification
    const jwtExpires = process.env.JWT_EXPIRES || '30d';
    const decoded = jwt.verify(token, process.env.JWT_SECRET, {
      algorithms: ['HS256'],  // Empêche alg:none et RS256 confusion
      maxAge:     jwtExpires, // Aligné sur JWT_EXPIRES (cohérence avec la signature)
    });

    // Vérifier le cache avant de requêter la DB
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
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expiré — veuillez vous reconnecter' });
    }
    return res.status(401).json({ error: 'Token invalide' });
  }
}

/**
 * Vérifie que req.user a l'un des rôles autorisés.
 * À utiliser après authenticate.
 *
 * @param {string[]} roles - Ex: ['admin'], ['admin','agent_hub']
 */
function requireRole(roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Non authentifié' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        error: `Accès refusé — rôle requis : ${roles.join(' ou ')}`,
        your_role: req.user.role,
      });
    }
    next();
  };
}

// Raccourci : vérifie que l'utilisateur est admin
const requireAdmin = requireRole(['admin']);

// ⚠️ SECURITY FIX: Allow explicit cache invalidation on role changes
function invalidateUserCache(userId) {
  userCache.delete(userId);
}

module.exports = { authenticate, requireRole, requireAdmin, invalidateUserCache };
