/**
 * KOMERCE — Middleware d'authentification JWT (sécurisé)
 *
 * authenticate       : vérifie le token (httpOnly cookie OU Bearer), injecte req.user
 * requireRole(roles) : vérifie que l'utilisateur a le bon rôle
 * requireAdmin       : raccourci pour requireRole(['admin'])
 */

const jwt = require('jsonwebtoken');
const db  = require('../db');

const _JWT_SECRET = process.env.JWT_SECRET;

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

function extractToken(req) {
  if (req.cookies && req.cookies.kmrc_jwt) return req.cookies.kmrc_jwt;
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) return header.split(' ')[1];
  return null;
}

function isPickupPayCashRequest(req) {
  const path = (req.originalUrl || req.url || '').split('?')[0];
  return req.method === 'POST' && /^\/api\/pickup\/pay-cash\/[^/]+$/.test(path);
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

    if (isPickupPayCashRequest(req)) {
      return handleSafePickupCash(req, res, next);
    }

    next();

  } catch (err) {
    if (err.name !== 'JsonWebTokenError' && err.name !== 'TokenExpiredError') {
      console.error('[authenticate] erreur inattendue:', err.name, err.message);
    }
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expiré — veuillez vous reconnecter' });
    }
    return res.status(401).json({ error: 'Token invalide' });
  }
}

async function handleSafePickupCash(req, res, next) {
  const role = req.user && req.user.role;
  if (role !== 'admin' && role !== 'agent_relais') {
    return res.status(403).json({ error: 'Accès réservé agents relais et admin' });
  }

  try {
    const { confirmPickupCashPayment } = require('../services/confirm-pickup-cash-payment');
    const { generateAndStoreSecret } = require('../routes/pickup-secret');
    const path = (req.originalUrl || req.url || '').split('?')[0];
    const orderId = path.split('/').pop();

    const result = await confirmPickupCashPayment({
      orderId,
      user: req.user,
      payload: req.body,
      generateAndStoreSecret,
    });

    return res.status(result.status).json(result.body);
  } catch (err) {
    return next(err);
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
  userCache.delete(userId);
}

module.exports = { authenticate, requireRole, requireAdmin, invalidateUserCache };
