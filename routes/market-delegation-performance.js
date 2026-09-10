/**
 * @komerce-arch
 * @role          market-delegation-performance-api
 * @domain        market-delegation
 * @layer         route
 * @criticality   high
 * @inputs        authenticated user, canonical market code, optional calendar period
 * @outputs       projection lisible de la performance économique du marché
 * @depends       middleware/auth.js, services/market-delegation-performance-service.js
 * @used-by       bootstrap/api-routes.js, market operator dashboard
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      performance_is_a_projection_never_a_new_truth, client_market_id_never_authority
 * @impact-areas  market, delegation, economic-engine
 * @version       2026-09
 */
'use strict';

const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticate } = require('../middleware/auth');
const { getMarketPerformance } = require('../services/market-delegation-performance-service');

function sendDelegationError(res, error) {
  if (!error || !error.code || !error.status) return false;
  res.status(error.status).json({ error: error.message, code: error.code });
  return true;
}

// Lecture seule : aucune mutation possible sur cette surface. La performance
// est une projection de la vérité économique, jamais une vérité nouvelle —
// un opérateur ne peut donc rien y « corriger ».
router.get('/markets/:marketCode/performance', authenticate, async (req, res, next) => {
  try {
    const view = await getMarketPerformance(db, {
      marketCode: req.params.marketCode,
      actorUserId: req.user.id,
      period: req.query.period || null,
    });
    res.json(view);
  } catch (error) {
    if (sendDelegationError(res, error)) return;
    next(error);
  }
});

module.exports = router;
