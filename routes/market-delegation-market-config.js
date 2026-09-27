/**
 * @komerce-arch
 * @role          market-delegation-market-config-api
 * @domain        market-delegation
 * @layer         route
 * @criticality   low
 * @inputs        authenticated user, canonical market code
 * @outputs       market-scoped read-only market configuration projection
 * @depends       db.js, middleware/auth.js, middleware/require-market-delegated-capability.js
 * @used-by       bootstrap/api-routes.js
 * @db-read       markets
 * @db-write      none
 * @db-txn        none
 * @doctrine      capability_is_the_authority_not_role, market_scope_is_server_resolved
 * @impact-areas  market-delegation, admin-dashboard
 * @version       2026-09
 */
'use strict';

const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticate } = require('../middleware/auth');
const { requireMarketDelegatedCapability } = require('../middleware/require-market-delegated-capability');
const log = require('../utils/logger').child({ module: 'market-delegation-market-config' });

// market_config.read couvre un référentiel pur (migration
// 135_markets_foundation.sql) : code/currency/minor_unit restent réservés
// central, is_active porte la même autorité que market.create et reste
// central (cf. market_config.update = CENTRAL_ONLY dans
// config/market-delegation-capabilities.js). Une fois ces champs exclus, ce
// qui reste à lire est le libellé et la date d'ouverture du marché — cette
// route ne prétend pas exposer une "configuration" plus riche qu'elle ne
// l'est réellement.
const CAPABILITY = 'market_config.read';

router.get(
  '/markets/:marketCode/config',
  authenticate,
  requireMarketDelegatedCapability(CAPABILITY, { audit: false }),
  async (req, res, next) => {
    try {
      res.set('Cache-Control', 'private, no-store');
      const { market_id: marketId, market_code: marketCode } = req.marketDelegatedCapability;

      const { rows } = await db.query(
        `SELECT name, created_at FROM markets WHERE id = $1`,
        [marketId]
      );
      if (!rows.length) {
        return res.status(404).json({ error: 'Marché introuvable', code: 'market_not_found' });
      }

      return res.json({
        market_code: marketCode,
        name: rows[0].name,
        created_at: rows[0].created_at,
      });
    } catch (err) {
      log.error({ err, marketCode: req.params.marketCode }, '[market-delegation-market-config] read failed');
      return next(err);
    }
  }
);

module.exports = router;
