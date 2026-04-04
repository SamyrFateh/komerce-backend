/**
 * KOMERCE — Middleware d'authentification JWT (sécurisé)
 *
 * authenticate       : vérifie le token Bearer, injecte req.user
 * requireRole(roles) : vérifie que l'utilisateur a le bon rôle
 * requireAdmin       : raccourci pour requireRole(['admin'])
 *
 * Utilisation :
 *   router.get('/admin', authenticate, requireAdmin, handler)
 *   router.get('/hub',   authenticate, requireRole(['admin','agent_hub']), handler)
 *
 * Corrections v8.1 :
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
 * Vérifie le token JWT dans le header Authorization: Bearer <token>
 * Injecte req.user si valide.
 */
async function authenticate(req, res, next) {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Token manquant — Authorization: Bearer <token>' });
    }

    const token   = header.split(' ')[1];

    // ← P0 FIX : verrouiller l'algorithme + maxAge
    const decoded = jwt.verify(token, process.env.JWT_SECRET, {
      algorithms: ['HS256'],   // Empêche alg:none et RS256 confusion
      maxAge:     '24h',       // Double protection expiration
    });

    // Vérifier le cache avant de requêter la DB
    let user = getCachedUser(decoded.id);

    if (!user) {
      const { rows } = await db.query(
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

module.exports = { authenticate, requireRole, requireAdmin };
