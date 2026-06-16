/**
 * @komerce-arch
 * @role          shared-cart-shared-cart-refund-admin
 * @domain        shared-cart
 * @layer         route
 * @criticality   critical
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db.js, middleware/auth.js, services/*
 * @used-by       bootstrap/api-routes.js
 * @db-read       @unknown
 * @db-write      @unknown
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  shared-cart, admin-dashboard
 * @version       2026-06
 */

'use strict';

const express = require('express');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { markManualRefundProcessed } = require('../services/shared-cart-refund-queue');

const router = express.Router();

/**
 * POST /api/admin/shared-carts/refund-queue/:contributionId/mark-refunded
 *
 * Marque une contribution comme remboursée manuellement après traitement dans
 * Stripe/admin. Cette route ne déclenche aucun appel Stripe.
 */
router.post('/refund-queue/:contributionId/mark-refunded', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const contribution = await markManualRefundProcessed(
      req.params.contributionId,
      req.user.id,
      {
        refund_reference: req.body?.refund_reference,
        note: req.body?.note,
      }
    );

    res.json({ ok: true, contribution });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    next(err);
  }
});

module.exports = { router };
