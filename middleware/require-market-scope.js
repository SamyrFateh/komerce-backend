/**
 * @komerce-arch
 * @role          market-scope-authorization-guard
 * @domain        market
 * @layer         middleware
 * @criticality   high
 * @inputs        req.user.id, operator_market_scopes (DB)
 * @outputs       req.authorizedMarkets (Set<uuid>), next_or_403
 * @depends       db.js, operator_market_scopes (M1), markets (M0)
 * @used-by       routes admin scoping un market_id (branchement futur, hors M2)
 * @db-read       operator_market_scopes
 * @db-write      none
 * @db-txn        none
 * @doctrine      KOMERCE_MARKET_LAYER_FREEZE.md §3 — authorization scope,
 *                résolu SERVEUR, jamais depuis un market_id fourni par le client
 * @impact-areas  market, admin-authorization
 * @version       2026-08
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

/**
 * Résout l'ensemble des market_id sur lesquels l'utilisateur a un grant actif.
 * Pure lecture — ne modifie rien, ne fait aucune hypothèse sur le rôle.
 *
 * @param {string} userId
 * @returns {Promise<Set<string>>} market_id actifs (revoked_at IS NULL)
 */
async function resolveAuthorizedMarkets(userId) {
  if (!userId) return new Set();

  const { rows } = await db.query(
    `SELECT market_id FROM operator_market_scopes
     WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId]
  );

  return new Set(rows.map(r => r.market_id));
}

/**
 * Middleware : peuple req.authorizedMarkets depuis la DB. Ne bloque rien —
 * un ensemble vide est un état légitime (l'utilisateur n'opère aucun marché).
 * Le blocage effectif est la responsabilité de requireMarketScope() ou du
 * filtrage applicatif WHERE market_id = ANY(authorizedMarkets).
 */
async function attachAuthorizedMarkets(req, res, next) {
  try {
    req.authorizedMarkets = await resolveAuthorizedMarkets(req.user?.id);
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Factory : exige que req.authorizedMarkets contienne le market_id ciblé.
 * Le market_id ciblé vient TOUJOURS d'une source serveur (params de route
 * déjà résolus, ressource chargée en DB) — jamais d'un champ de body/query
 * non vérifié, qui serait un contexte client, pas une autorisation.
 *
 * @param {(req) => string} getTargetMarketId — extrait le market_id à
 *   vérifier depuis la requête déjà authentifiée/chargée. L'appelant est
 *   responsable de ne jamais y faire passer un input client non résolu.
 */
function requireMarketScope(getTargetMarketId) {
  return async (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Non authentifié' });

    try {
      if (!req.authorizedMarkets) {
        req.authorizedMarkets = await resolveAuthorizedMarkets(req.user.id);
      }

      const targetMarketId = getTargetMarketId(req);
      if (!targetMarketId) {
        return res.status(400).json({ error: 'Marché cible introuvable pour cette ressource' });
      }

      if (!req.authorizedMarkets.has(targetMarketId)) {
        return res.status(403).json({
          error: 'Accès refusé — aucun scope actif sur ce marché',
          code: 'market_scope_denied',
        });
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}

module.exports = {
  resolveAuthorizedMarkets,
  attachAuthorizedMarkets,
  requireMarketScope,
};
