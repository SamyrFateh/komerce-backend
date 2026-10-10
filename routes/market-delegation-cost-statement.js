/**
 * @komerce-arch
 * @role          market-delegation-cost-statement-api
 * @domain        market-delegation
 * @layer         route
 * @criticality   high
 * @inputs        authenticated user, canonical market code, optional from/to
 * @outputs       relevé de coûts du marché (lecture seule)
 * @depends       middleware/auth.js, services/market-delegation-cost-statement-service.js
 * @used-by       bootstrap/api-routes.js, market operator dashboard
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      cost_statement_is_a_projection_never_a_new_truth, client_market_id_never_authority
 * @impact-areas  market, delegation, economic-engine, finance
 * @version       2026-10
 */
'use strict';

const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticate } = require('../middleware/auth');
const { getMarketCostStatement } = require('../services/market-delegation-cost-statement-service');

function sendKnownError(res, error) {
  if (!error || !error.code || !error.status) return false;
  res.status(error.status).json({ error: error.message, code: error.code });
  return true;
}

// Lecture seule : un opérateur ne corrige rien ici, le relevé projette la vérité économique du siège.
router.get('/markets/:marketCode/cost-statement', authenticate, async (req, res, next) => {
  try {
    res.json(await getMarketCostStatement(db, {
      marketCode: req.params.marketCode,
      actorUserId: req.user.id,
      from: req.query.from || null,
      to: req.query.to || null,
    }));
  } catch (error) {
    if (sendKnownError(res, error)) return;
    next(error);
  }
});

module.exports = router;
