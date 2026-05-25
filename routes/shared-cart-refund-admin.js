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
