/**
 * @komerce-arch
 * @role          auth-auth
 * @domain        auth
 * @layer         middleware
 * @criticality   high
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db, utils/logger.js, utils/user-cache.js, utils/auth-token-policy.js
 * @db-write      none
 * @db-read       revoked_tokens, users, operator_market_scopes, assignment_memberships, market_operating_assignments
 * @used-by       routes/admin-boutique-categories.js, routes/admin-cost-components.js, routes/admin-costing.js, routes/admin-customs-categories.js, routes/admin-customs-shipments.js, routes/admin-dashboard.js, routes/admin-finance-config.js, routes/admin-loyalty.js, routes/admin-pricing-components.js, routes/admin-pricing-matrices.js, routes/admin-radar.js, routes/admin-risk-provisions.js, routes/admin-rules.js, routes/admin/catalog-approval.js, routes/admin/customs.js, routes/admin/dashboard.js, routes/admin/documents.js, routes/admin/orders.js, routes/admin/partners.js, routes/admin/system.js, routes/admin/users.js, routes/alerts.js, routes/auth.js, routes/auto-distribute-api.js, routes/carriers.js, routes/cash.js, routes/client-auth.js, routes/client-tracking.js, routes/config.js, routes/dashboard.js, routes/economic.js, routes/finance.js, routes/health.js, routes/hub-dashboard.js, routes/hub-mark-ordered.js, routes/hub.js, routes/inventory-api.js, routes/invoices.js, routes/logistics.js, routes/loyalty.js, routes/modules.js, routes/notification-api.js, routes/ops-api.js, routes/order-api-v2.js, routes/orders/cancel.js, routes/orders/create.js, routes/orders/detail.js, routes/orders/list.js, routes/orders/parcels.js, routes/orders/qr.js, routes/orders/status.js, routes/parcel-api-v2/index.js, routes/parcel-label.js, routes/parcels.js, routes/payments-paypal.js, routes/payments.js, routes/pickup-pay-cash.js, routes/pickup-secret.js, routes/pricing-strategy.js, routes/pricing.js, routes/products.js, routes/purchasing.js, routes/relay-dashboard.js, routes/scans.js, routes/shared-cart-cash.js, routes/shared-cart-refund-admin.js, routes/shared-cart.js, routes/signals.js, routes/simulator.js, routes/sourcing-scanner.js, routes/sourcing.js, routes/transit-dashboard.js, routes/transitaire-api.js, routes/unsold.js, routes/wallet.js, server.js
 * @doctrine      canonical_session_claims_only, scoped_tokens_never_upgrade, delegated_market_role_is_runtime_projection_not_users_role
 * @impact-areas  auth, market-delegation
 * @version       2026-09
 */

'use strict';
/**
 * KOMERCE — Middleware d'authentification JWT.
 *
 * La source peut être le cookie httpOnly ou Bearer pour les clients API
 * explicites, mais la signature seule ne suffit jamais : le JWT doit porter
 * les claims d'une SESSION canonique AUTH-7/8. Un token scoped/API ne peut pas
 * être transformé en session en passant ici.
 */

const jwt = require('jsonwebtoken');
const db  = require('../db');
const log = require('../utils/logger').child({ module: 'auth' });
const userCache = require('../utils/user-cache');
const { sessionClaimsVerdict } = require('../utils/auth-token-policy');

const _JWT_SECRET = process.env.JWT_SECRET;

function getCachedUser(userId) { return userCache.get(userId); }
function setCachedUser(userId, user) { userCache.set(userId, user); }

const { readAuthToken } = require('../utils/auth-cookie');
function extractToken(req) { return readAuthToken(req); }

async function authenticate(req, res, next) {
  try {
    const token = extractToken(req);

    if (!token) {
      return res.status(401).json({ error: 'Token manquant — connectez-vous' });
    }

    const decoded = jwt.verify(token, _JWT_SECRET, {
      algorithms: ['HS256'],
    });

    const sessionVerdict = sessionClaimsVerdict(decoded);
    if (!sessionVerdict.ok) {
      log.warn({ reason: sessionVerdict.reason }, '[authenticate] JWT signé refusé : pas une session canonique');
      return res.status(401).json({ error: 'Jeton non autorisé pour une session' });
    }

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

    // Toujours cloner l'objet issu du cache : un rôle runtime dérivé plus tard
    // par requireRole ne doit jamais contaminer le cache de l'identité.
    req.user = { ...user };
    req.auth = {
      authTime: Number(decoded.auth_time),
      amr: decoded.amr.map(String),
      jti: decoded.jti,
      exp: decoded.exp,
      tokenUse: decoded.token_use || 'session-legacy-auth7',
      scoped: false,
    };

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

/**
 * Bridge de coexistence vers les routes historiques qui expriment encore leur
 * admission avec le rôle global `market_operator`.
 *
 * L'autorité ne vient PAS de users.role : elle doit être prouvée par une ligne
 * operator_market_scopes attribuée à une membership active, elle-même rattachée
 * à un Market Operating Assignment ACTIVE. La projection reste donc révocable
 * et bornée par le Market ID. Aucun UPDATE de users.role n'est effectué.
 */
async function hasActiveProjectedMarketDelegation(userId) {
  if (!userId) return false;
  const { rows } = await db.query(
    `SELECT 1
       FROM operator_market_scopes oms
       JOIN assignment_memberships am
         ON am.id = oms.projected_from_membership_id
        AND am.user_id = oms.user_id
        AND am.status = 'ACTIVE'
       JOIN market_operating_assignments assignment
         ON assignment.id = am.assignment_id
        AND assignment.market_id = oms.market_id
        AND assignment.status = 'ACTIVE'
      WHERE oms.user_id = $1::uuid
        AND oms.revoked_at IS NULL
        AND oms.projected_from_membership_id IS NOT NULL
      LIMIT 1`,
    [userId]
  );
  return Boolean(rows[0]);
}

function requireRole(roles) {
  const allowed = new Set(roles || []);
  return async (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Non authentifié' });
    if (allowed.has(req.user.role)) return next();

    // Une membership peut fournir le rôle de compatibilité market_operator
    // uniquement sur une route qui l'admet explicitement. Les routes admin,
    // finance, Hub terrain, etc. ne sont donc jamais élargies silencieusement.
    if (allowed.has('market_operator')) {
      try {
        const delegated = await hasActiveProjectedMarketDelegation(req.user.id);
        if (delegated) {
          const persistedRole = req.user.role;
          req.user = {
            ...req.user,
            persisted_role: persistedRole,
            role: 'market_operator',
            role_source: 'market_delegation_projection',
          };
          req.marketDelegationRole = {
            persisted_role: persistedRole,
            effective_role: 'market_operator',
            source: 'operator_market_scopes.projected_from_membership_id',
          };
          return next();
        }
      } catch (error) {
        return next(error);
      }
    }

    return res.status(403).json({
      error: `Accès refusé — rôle requis : ${[...allowed].join(' ou ')}`,
      your_role: req.user.role,
    });
  };
}

const requireAdmin = requireRole(['admin']);

function invalidateUserCache(userId) {
  userCache.invalidate(userId);
}

module.exports = {
  authenticate,
  requireRole,
  requireAdmin,
  invalidateUserCache,
  hasActiveProjectedMarketDelegation,
};
