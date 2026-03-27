/**
 * KOMERCE — Middleware d'authentification JWT
 *
 * authenticate       : vérifie le token Bearer, injecte req.user
 * requireRole(roles) : vérifie que l'utilisateur a le bon rôle
 *
 * Utilisation :
 *   router.get('/admin', authenticate, requireRole(['admin']), handler)
 *   router.get('/hub',   authenticate, requireRole(['admin','agent_hub']), handler)
 */

const jwt = require('jsonwebtoken');
const db  = require('../db');

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
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const { rows } = await db.query(
      `SELECT id, full_name, email, phone, role, currency_pref
       FROM users WHERE id = $1`,
      [decoded.id]
    );

    if (!rows.length) {
      return res.status(401).json({ error: 'Utilisateur introuvable ou compte supprimé' });
    }

    req.user = rows[0];
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

module.exports = { authenticate, requireRole };
