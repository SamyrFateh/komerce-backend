/**
 * @komerce-arch
 * @role          payment-pickup-pay-cash
 * @domain        payment
 * @layer         route
 * @criticality   critical
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db.js, middleware/auth.js, services/*
 * @used-by       bootstrap/api-routes.js
 * @db-read       none
 * @db-write      none
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  payment
 * @version       2026-06
 */

'use strict';

const express = require('express');
const router = express.Router();

const { authenticate } = require('../middleware/auth');
const { confirmPickupCashPayment } = require('../services/confirm-pickup-cash-payment');
// O7.2 (Cycle B) : importait auparavant './pickup-secret' (routes/pickup-secret.js,
// une route — pas une boundary de feature). Voir docs/O7_2_CYCLE_ANALYSIS.md, Cycle B.
const { generateAndStoreSecret } = require('../services/pickup-secret-service');

function requireRelaisOrAdmin(req, res, next) {
  const role = req.user && req.user.role;
  if (role !== 'admin' && role !== 'agent_relais') {
    return res.status(403).json({ error: 'Accès réservé agents relais et admin' });
  }
  return next();
}

router.post('/:orderId', authenticate, requireRelaisOrAdmin, async (req, res, next) => {
  try {
    const result = await confirmPickupCashPayment({
      orderId: req.params.orderId,
      user: req.user,
      payload: req.body,
      generateAndStoreSecret,
    });

    return res.status(result.status).json(result.body);
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
