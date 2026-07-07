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
 * @db-read       orders, shared_cart_contributions, shared_carts
 * @db-write-via:shared-cart-refund-queue refunds, shared_cart_contributions
 * @db-write-via:refund-receipt           transaction_documents
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  shared-cart, admin-dashboard
 * @version       2026-06
 */

'use strict';

const express = require('express');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { markManualRefundProcessed } = require('../services/shared-cart-refund-queue');
const refundReceiptService = require('../services/documents/refund-receipt');
const log = require('../utils/logger').child({ module: 'shared-cart-refund-admin' });

const router = express.Router();

/**
 * POST /api/admin/shared-carts/refund-queue/:contributionId/mark-refunded
 *
 * Marque une contribution comme remboursée manuellement après traitement dans
 * Stripe/admin. Cette route ne déclenche aucun appel Stripe.
 * Post-commit : émet un reçu de remboursement si une ligne refunds a été créée.
 */
router.post('/refund-queue/:contributionId/mark-refunded', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { contribution, refundRowId } = await markManualRefundProcessed(
      req.params.contributionId,
      req.user.id,
      {
        refund_reference: req.body?.refund_reference,
        note: req.body?.note,
      }
    );

    // ── Reçu de remboursement (post-commit, non bloquant) ─────────────────
    // Doctrine : refund_confirmed → reçu émis. Jamais avant COMMIT.
    if (refundRowId) {
      refundReceiptService.issue(refundRowId, { issuedBy: req.user.id }).catch(err => {
        log.warn({ err, contribution_id: contribution.id },
          '[shared-cart-refund-admin] émission reçu remboursement manuel échouée (non-fatal)');
      });
    }

    res.json({ ok: true, contribution });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    next(err);
  }
});

module.exports = { router };
