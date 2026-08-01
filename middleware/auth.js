/**
 * @komerce-arch
 * @role          auth-auth
 * @domain        auth
 * @layer         middleware
 * @criticality   high
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db, utils/logger.js, utils/user-cache.js
 * @db-write      none
 * @db-read      revoked_tokens, users
 * @used-by       routes/admin-boutique-categories.js, routes/admin-cost-components.js, routes/admin-costing.js, routes/admin-customs-categories.js, routes/admin-customs-shipments.js, routes/admin-dashboard.js, routes/admin-finance-config.js, routes/admin-loyalty.js, routes/admin-pricing-components.js, routes/admin-pricing-matrices.js, routes/admin-radar.js, routes/admin-risk-provisions.js, routes/admin-rules.js, routes/admin/catalog-approval.js, routes/admin/customs.js, routes/admin/dashboard.js, routes/admin/documents.js, routes/admin/orders.js, routes/admin/partners.js, routes/admin/system.js, routes/admin/users.js, routes/alerts.js, routes/auth.js, routes/auto-distribute-api.js, routes/carriers.js, routes/cash.js, routes/client-auth.js, routes/client-tracking.js, routes/config.js, routes/dashboard.js, routes/economic.js, routes/finance.js, routes/health.js, routes/hub-dashboard.js, routes/hub-mark-ordered.js, routes/hub.js, routes/inventory-api.js, routes/invoices.js, routes/logistics.js, routes/loyalty.js, routes/modules.js, routes/notification-api.js, routes/ops-api.js, routes/order-api-v2.js, routes/orders/cancel.js, routes/orders/create.js, routes/orders/detail.js, routes/orders/list.js, routes/orders/parcels.js, routes/orders/qr.js, routes/orders/status.js, routes/parcel-api-v2/index.js, routes/parcel-label.js, routes/parcels.js, routes/payments-paypal.js, routes/payments.js, routes/pickup-pay-cash.js, routes/pickup-secret.js, routes/pricing-strategy.js, routes/pricing.js, routes/products.js, routes/purchasing.js, routes/relay-dashboard.js, routes/scans.js, routes/shared-cart-cash.js, routes/shared-cart-refund-admin.js, routes/shared-cart.js, routes/signals.js, routes/simulator.js, routes/sourcing-scanner.js, routes/sourcing.js, routes/transit-dashboard.js, routes/transitaire-api.js, routes/unsold.js, routes/wallet.js, server.js
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  auth
 * @version       2026-06
 */


'use strict';
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
