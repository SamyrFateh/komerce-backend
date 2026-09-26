/**
 * @komerce-arch
 * @role          market-delegation-client-api
 * @domain        market-delegation
 * @layer         route
 * @criticality   high
 * @inputs        authenticated user, canonical market code, client_search, client_sort, pagination, client_phone
 * @outputs       market-scoped client index projection, market-scoped client 360 projection
 * @depends       middleware/auth.js, middleware/require-market-delegated-capability.js, services/client-index.js, services/client-360.js
 * @used-by       bootstrap/api-routes.js, market operator dashboard (canonical Clients screen)
 * @db-read       orders, users, recipients, markets (via client-index.js / client-360.js — no query reimplemented here)
 * @db-write      none
 * @db-write-via:market-delegation-service market_delegation_audit
 * @db-txn        none
 * @doctrine      capability_is_the_authority_not_role, market_scope_is_server_resolved, client_market_id_never_authority, client_account_facets_global_only, client_index_finds_client_360
 * @impact-areas  market-delegation, admin-dashboard, clients
 * @version       2026-09
 */
'use strict';

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { requireMarketDelegatedCapability } = require('../middleware/require-market-delegated-capability');
const clientIndex = require('../services/client-index');
const client360 = require('../services/client-360');
const log = require('../utils/logger').child({ module: 'market-delegation-client' });

const CAPABILITY = 'client.read';

// market_id/marketId ne sont jamais une preuve d'autorité côté client : le
// seul marché qui compte est celui résolu serveur dans
// req.marketDelegatedCapability.market_id (posé par
// requireMarketDelegatedCapability). Un client qui en fournit un se voit
// refuser explicitement plutôt qu'ignoré silencieusement, pour que toute
// tentative de contournement soit visible côté audit/logs.
function rejectClientMarketIdentity(req, res, next) {
  const query = req.query || {};
  if (Object.prototype.hasOwnProperty.call(query, 'market_id') ||
      Object.prototype.hasOwnProperty.call(query, 'marketId')) {
    return res.status(400).json({
      error: 'Identifiant marché client interdit — utilisez le code marché de la route',
      code: 'client_market_identity_forbidden',
    });
  }
  return next();
}

function queryFor(req) {
  return {
    search: req.query.search || '',
    sort: req.query.sort || 'recent',
    page: req.query.page || '1',
    page_size: req.query.page_size || '25',
  };
}

router.get(
  '/markets/:marketCode/clients',
  authenticate,
  requireMarketDelegatedCapability(CAPABILITY),
  rejectClientMarketIdentity,
  async (req, res, next) => {
    try {
      res.set('Cache-Control', 'private, no-store');
      const { market_id: marketId, market_code: marketCode } = req.marketDelegatedCapability;
      const payload = await clientIndex.listClients(queryFor(req), {
        marketIds: [marketId],
        market: { id: marketId, code: marketCode },
      });
      return res.json(payload);
    } catch (err) {
      log.error({ err, marketCode: req.params.marketCode }, '[market-delegation-client] list failed');
      return next(err);
    }
  }
);

router.get(
  '/markets/:marketCode/clients/:clientPhone',
  authenticate,
  requireMarketDelegatedCapability(CAPABILITY),
  rejectClientMarketIdentity,
  async (req, res, next) => {
    try {
      res.set('Cache-Control', 'private, no-store');
      const { market_id: marketId } = req.marketDelegatedCapability;

      const phone = client360.normalizePhone(req.params.clientPhone);
      if (!phone) {
        return res.status(400).json({ error: 'Téléphone client invalide', code: 'invalid_client_phone' });
      }

      const resolved = await client360.resolveClient(phone, { marketIds: [marketId] });
      if (!resolved.client) {
        // Client inexistant OU existant mais hors marché autorisé : même 404
        // dans les deux cas — aucune fuite d'existence inter-marché.
        return res.status(404).json({ error: 'Client introuvable dans le périmètre autorisé', code: 'client_not_found' });
      }

      // includeSecurity toujours false ici : un market_operator ne voit
      // jamais passkeys/rôle compte/historique global, quelle que soit sa
      // capability — cette facette reste strictement admin-global
      // (doctrine client_account_facets_global_only).
      const payload = await client360.loadClient360(resolved.client, {
        marketIds: [marketId],
        includeSecurity: false,
      });
      return res.json(payload);
    } catch (err) {
      log.error({ err, clientPhone: req.params.clientPhone }, '[market-delegation-client] 360 read failed');
      return next(err);
    }
  }
);

module.exports = router;
module.exports._test = { rejectClientMarketIdentity, queryFor };
