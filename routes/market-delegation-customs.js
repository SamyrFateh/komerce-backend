/**
 * @komerce-arch
 * @role          market-delegation-customs-api
 * @domain        market-delegation
 * @layer         route
 * @criticality   high
 * @inputs        authenticated user, canonical market code, optional from/to
 * @outputs       expéditions douane du marché (lecture seule)
 * @depends       middleware/auth.js, services/market-delegation-customs-service.js
 * @used-by       bootstrap/api-routes.js, market operator dashboard
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      customs_read_view_is_a_projection, client_market_id_never_authority
 * @impact-areas  market, delegation, customs, logistics
 * @version       2026-10
 */
'use strict';

const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticate } = require('../middleware/auth');
const { listMarketCustomsShipments } = require('../services/market-delegation-customs-service');

function sendKnownError(res, error) {
  if (!error || !error.code || !error.status) return false;
  res.status(error.status).json({ error: error.message, code: error.code });
  return true;
}

// Lecture seule : un opérateur ne modifie rien ici : la gestion des envois reste centrale.
router.get('/markets/:marketCode/customs-shipments', authenticate, async (req, res, next) => {
  try {
    res.json(await listMarketCustomsShipments(db, {
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
