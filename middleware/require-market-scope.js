/**
 * @komerce-arch
 * @role          market-scope-authorization-guard
 * @domain        market
 * @layer         middleware
 * @criticality   high
 * @inputs        req.user.id, operator_market_scopes (DB)
 * @outputs       req.authorizedMarkets (Set<uuid>), req.authorizedMarketScopes (Map<uuid,role>), next_or_403
 * @depends       db.js, operator_market_scopes (M1), markets (M0)
 * @used-by       routes admin scoping un market_id
 * @db-read       operator_market_scopes
 * @db-write      none
 * @db-txn        none
 * @doctrine      KOMERCE_MARKET_LAYER_FREEZE.md §3 — authorization scope,
 *                résolu SERVEUR, jamais depuis un market_id fourni par le client
 * @impact-areas  market, admin-authorization
 * @version       2026-09
 *
 * DOCTRINE (freeze §3, tableau) :
 *   | Authorization scope | opérateur | serveur (operator_market_scopes) | enferme | oui |
 *   | Navigation/transaction context | acheteur | client (MarketContext) | oriente | NON |
 *
 * Ce module est le SEUL point d'entrée d'autorisation par marché. Il ne lit
 * jamais un market_id envoyé par le client comme preuve d'accès — il résout
 * toujours les marchés autorisés depuis operator_market_scopes, filtré sur
 * revoked_at IS NULL, pour l'utilisateur authentifié (req.user.id).
 */
'use strict';

const db = require('../db');

const VALID_SCOPE_ROLES = new Set(['viewer', 'manager']);

/**
 * Résout les grants actifs d'un utilisateur, rôle inclus.
 * Le rôle est une propriété du grant (user, market), pas du compte utilisateur.
 *
 * @param {string} userId
 * @returns {Promise<Map<string, 'viewer'|'manager'>>}
 */
async function resolveAuthorizedMarketScopes(userId) {
  if (!userId) return new Map();

  const { rows } = await db.query(
    `SELECT market_id, role FROM operator_market_scopes
     WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId]
  );

  const scopes = new Map();
  for (const row of rows) {
    if (row && row.market_id && VALID_SCOPE_ROLES.has(row.role)) {
      scopes.set(row.market_id, row.role);
    }
  }
  return scopes;
}

/**
 * Compatibilité historique : retourne uniquement l'ensemble des market_id.
 */
async function resolveAuthorizedMarkets(userId) {
  const scopes = await resolveAuthorizedMarketScopes(userId);
  return new Set(scopes.keys());
}

/**
 * Middleware : peuple les deux projections depuis UNE seule lecture DB.
 * - authorizedMarkets : compatibilité avec les guards existants ;
 * - authorizedMarketScopes : autorité rôle-aware pour viewer/manager.
 */
async function attachAuthorizedMarkets(req, res, next) {
  try {
    req.authorizedMarketScopes = await resolveAuthorizedMarketScopes(req.user?.id);
    req.authorizedMarkets = new Set(req.authorizedMarketScopes.keys());
    next();
  } catch (err) {
    next(err);
  }
}

async function ensureAuthorizedMarketScopes(req) {
  if (!req.authorizedMarketScopes) {
    req.authorizedMarketScopes = await resolveAuthorizedMarketScopes(req.user?.id);
  }
  if (!req.authorizedMarkets) {
    req.authorizedMarkets = new Set(req.authorizedMarketScopes.keys());
  }
  return req.authorizedMarketScopes;
}

function targetMarketIdOr400(req, res, getTargetMarketId) {
  const targetMarketId = getTargetMarketId(req);
  if (!targetMarketId) {
    res.status(400).json({ error: 'Marché cible introuvable pour cette ressource' });
    return null;
  }
  return targetMarketId;
}

/**
 * Exige uniquement un grant actif sur le marché, quel que soit son rôle.
 */
function requireMarketScope(getTargetMarketId) {
  return async (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Non authentifié' });

    try {
      const scopes = await ensureAuthorizedMarketScopes(req);
      const targetMarketId = targetMarketIdOr400(req, res, getTargetMarketId);
      if (!targetMarketId) return undefined;

      if (!scopes.has(targetMarketId)) {
        return res.status(403).json({
          error: 'Accès refusé — aucun scope actif sur ce marché',
          code: 'market_scope_denied',
        });
      }

      req.marketScopeRole = scopes.get(targetMarketId);
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

/**
 * Exige un grant actif dont le rôle fait partie de allowedRoles.
 * Typiquement : viewer+manager pour la lecture, manager seul pour une mutation.
 */
function requireMarketScopeRole(getTargetMarketId, allowedRoles) {
  const allowed = new Set(Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles]);
  for (const role of allowed) {
    if (!VALID_SCOPE_ROLES.has(role)) {
      throw new TypeError(`Rôle de scope marché invalide: ${role}`);
    }
  }

  return async (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Non authentifié' });

    try {
      const scopes = await ensureAuthorizedMarketScopes(req);
      const targetMarketId = targetMarketIdOr400(req, res, getTargetMarketId);
      if (!targetMarketId) return undefined;

      const scopeRole = scopes.get(targetMarketId);
      if (!scopeRole) {
        return res.status(403).json({
          error: 'Accès refusé — aucun scope actif sur ce marché',
          code: 'market_scope_denied',
        });
      }
      if (!allowed.has(scopeRole)) {
        return res.status(403).json({
          error: `Accès refusé — rôle marché requis : ${[...allowed].join(' ou ')}`,
          code: 'market_scope_role_denied',
          market_role: scopeRole,
        });
      }

      req.marketScopeRole = scopeRole;
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

module.exports = {
  VALID_SCOPE_ROLES,
  resolveAuthorizedMarketScopes,
  resolveAuthorizedMarkets,
  attachAuthorizedMarkets,
  requireMarketScope,
  requireMarketScopeRole,
};
