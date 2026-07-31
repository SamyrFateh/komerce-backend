/**
 * @komerce-arch
 * @role          orders-cancel
 * @domain        orders
 * @layer         route
 * @criticality   critical
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db.js, middleware/auth.js, services/*
 * @used-by       bootstrap/api-routes.js
 * @db-read       orders, recipients, refunds, users
 * @db-write      order_status_history, orders
 * @db-write-via:refund-service      refunds
 * @db-write-via:refund-receipt      transaction_documents
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  orders, checkout
 * @version       2026-06
 */

/**
 * KOMERCE — Annulation commande — v2.1 (source fix)
 *
 * POST /:id/cancel — annulation avec remboursement automatique
 *
 * Auth : client (sa propre commande) ou admin (toute commande)
 * Body : { reason?: string }
 *
 * v2.1 (source fix) — F16 fix:
 *   Status change, wallet reversal, stock restore ALL go through
 *   order-status-machine.js (D1/D2 compliance).
 *   This file handles: access control, cutoff check, Stripe refund, SMS.
 *
 * Règles (business_rules) :
 *   CANCEL_FREE_WINDOW_HOURS  — fenêtre remboursement 100% (défaut: 24h)
 *   CANCEL_PARTIAL_REFUND_PCT — % remboursé hors fenêtre  (défaut: 80%)
 *   CANCEL_CUTOFF_STATUS      — statut max pour annulation (défaut: shipped)
 */

'use strict';

const express = require('express');
const router  = express.Router();
const db      = require('../../db');
const { authenticate }             = require('../../middleware/auth');
const { validate }                 = require('../../middleware/validate');
const { orders }                   = require('../../validators');
const { getRule }                  = require('../../utils/rules');
const { processRefund }            = require('../../services/refund-service');
const { notifyCancellation }       = require('../../services/notification-service');
const { transitionOrderStatus }    = require('../../services/order-status-machine');
const refundReceiptService         = require('../../services/documents/refund-receipt');
const log = require('../../utils/logger').child({ module: 'cancel' });

// ─── POST /api/orders/:id/cancel ─────────────────────────────────────────────

router.post('/:id/cancel', authenticate, validate(orders.cancelOrder), async (req, res, next) => {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    const { id }     = req.params;
    const { reason } = req.body;

    // ── 1. Récupérer la commande ──────────────────────────────────────────────
    const { rows: [order] } = await client.query(
      `SELECT o.*,
              u.phone       AS user_phone,
              u.full_name   AS user_full_name,
              u.phone_payer,
              u.email       AS user_email,
              rc.phone      AS recipient_phone,
              rc.full_name  AS recipient_name
       FROM orders o
       LEFT JOIN users      u  ON u.id  = o.user_id
       LEFT JOIN recipients rc ON rc.id = o.recipient_id
       WHERE o.id = $1`,
      [id]
    );

    if (!order) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Commande introuvable' });
    }

    // ── 2. Droits d'accès ────────────────────────────────────────────────
    const isAdmin = req.user.role === 'admin';
    if (!isAdmin && order.user_id !== req.user.id) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Accès refusé — commande appartenant à un autre client' });
    }

    // ── 3. Vérifier que la commande n'est pas déjà terminée ────────────────
    if (['cancelled', 'refunded'].includes(order.status)) {
      await client.query('ROLLBACK');
      return res.status(422).json({
        error: `Commande déjà ${order.status} — aucune action possible`,
        current_status: order.status,
      });
    }
    if (order.status === 'collected') {
      await client.query('ROLLBACK');
      return res.status(422).json({
        error: 'Impossible d\'annuler une commande déjà collectée — contactez le SAV',
        current_status: order.status,
      });
    }

    // ── 4. Vérifier le statut de coupure (CANCEL_CUTOFF_STATUS) ──────────────
    const cutoffStatus = await getRule('CANCEL_CUTOFF_STATUS', 'shipped');
    const STATUS_ORDER = [
      'pending', 'confirmed', 'ordered', 'preparation',
      'shipped', 'in_transit', 'available', 'collected',
    ];
    const currentIdx = STATUS_ORDER.indexOf(order.status);
    const cutoffIdx  = STATUS_ORDER.indexOf(cutoffStatus);

    if (currentIdx >= cutoffIdx) {
      await client.query('ROLLBACK');
      return res.status(422).json({
        error: `Annulation impossible — commande en statut "${order.status}". L'annulation n'est possible que jusqu'au statut "${cutoffStatus}" exclu. Pour un retour, contactez le SAV.`,
        current_status: order.status,
        cutoff_status:  cutoffStatus,
      });
    }

    // ── 5. Calculer le remboursement (partie cash/stripe) ────────────────────
    const isPaid         = order.payment_status === 'paid';
    let refundAmountKmf  = 0;
    let refundAmountEur  = 0;
    let refundType       = 'none';
    let inFreeWindow     = false;

    if (isPaid) {
      const freeWindowHours  = await getRule('CANCEL_FREE_WINDOW_HOURS', 24);
      const partialRefundPct = await getRule('CANCEL_PARTIAL_REFUND_PCT', 80);

      const paidAt         = order.ordered_at || order.created_at;
      const hoursSincePaid = (Date.now() - new Date(paidAt).getTime()) / (1000 * 60 * 60);
      inFreeWindow         = hoursSincePaid <= freeWindowHours;

      const refundPct   = inFreeWindow ? 100 : partialRefundPct;
      refundAmountKmf   = Math.round(Number(order.total_kmf) * refundPct / 100);

      const eurKmfRate  = order.total_eur && order.total_kmf
        ? Number(order.total_kmf) / Number(order.total_eur)
        : 492;
      refundAmountEur   = parseFloat((refundAmountKmf / eurKmfRate).toFixed(2));
      refundType        = inFreeWindow ? 'full' : 'partial';
    }

    // ── 6. Exécuter le remboursement Stripe AVANT le statut ────────────────
    let refundResult = null;

    if (isPaid && refundAmountKmf > 0) {
      try {
        refundResult = await processRefund(
          client, order,
          refundAmountKmf, refundAmountEur,
          refundType,
          reason || 'Annulation client',
          req.user.id
        );
      } catch (refundErr) {
        await client.query('ROLLBACK');
        return next(refundErr);
      }
    }

    // ── 7. D1/D2: Transition via machine ─────────────────────────────────────
    //   The machine handles: status change, cancel_reason, timestamps,
    //   wallet reversal (idempotent), stock restore, and history insert.
    const machineResult = await transitionOrderStatus({
      orderId:      id,
      newStatus:    'cancelled',
      actor:        { id: req.user.id, role: req.user.role },
      source:       'cancel',  // not 'patch' — bypass role check, cancel.js does its own access control
      cancelReason: reason || null,
      note:         reason ? `Annulation : ${reason}` : 'Annulation client',
      dbClient:     client,
    });

    if (!machineResult.success) {
      await client.query('ROLLBACK');
      return res.status(422).json({ error: machineResult.error, current_status: order.status });
    }

    await client.query('COMMIT');

    // ── 8. Reçu de remboursement (post-commit, non bloquant) ──────────────
    // Doctrine : refund_confirmed → reçu émis. Jamais avant COMMIT.
    // refundResult.walletTxId ou stripeRefundId est dans la table refunds.
    // On cherche le refund row pour récupérer son id.
    if (refundResult) {
      // Le refundRowId n'est pas exposé par processRefund — on le retrouve
      // via la clé stable (order_id + refund_type + status completed).
      db.query(
        `SELECT id FROM refunds
         WHERE order_id = $1 AND status = 'completed'
         ORDER BY completed_at DESC LIMIT 1`,
        [id]
      ).then(({ rows: [row] }) => {
        if (row) {
          return refundReceiptService.issue(row.id, { issuedBy: req.user.id });
        }
      }).catch(err => {
        log.warn({ err, order_id: id }, '[CANCEL] Émission reçu remboursement échouée (non-fatal)');
      });
    }

    // ── 9. SMS client (non bloquant) ───────────────────────────────────────
    const smsRefundInfo = refundResult ? {
      method:    refundResult.method,
      amountEur: refundResult.amountEur,
      amountKmf: refundResult.amountKmf,
    } : null;
    notifyCancellation(order, smsRefundInfo);

    // ── Réponse ─────────────────────────────────────────────────────────────
    const refundInfo = {};
    const cancelFx = machineResult.cancelEffects || {};

    // Partie cash/stripe
    if (isPaid && refundAmountKmf > 0 && refundResult) {
      refundInfo.cash_refund = {
        amount_kmf:       refundAmountKmf,
        amount_eur:       refundAmountEur,
        type:             refundType,
        method:           refundResult.method,
        in_free_window:   inFreeWindow,
        stripe_refund_id: refundResult.stripeRefundId || null,
        wallet_tx_id:     refundResult.walletTxId || null,
      };
    }

    // Partie wallet reversal (from machine)
    if (cancelFx.walletReversalAmount > 0) {
      refundInfo.wallet_reversal = {
        amount_kmf:   cancelFx.walletReversalAmount,
        wallet_tx_id: cancelFx.walletReversalTxId || null,
      };
    }

    // Message
    let message;
    const parts = [];
    const walletReversed = cancelFx.walletReversalAmount || 0;

    if (!isPaid && walletReversed === 0) {
      message = 'Commande annulée — aucun prélèvement effectué';
    } else {
      if (walletReversed > 0) {
        parts.push(`${walletReversed.toLocaleString('fr-FR')} KMF reversés sur votre wallet`);
      }
      if (isPaid && refundResult) {
        if (refundResult.method === 'stripe') {
          parts.push(`${refundAmountEur.toFixed(2)}€ remboursés via Stripe (2–5 jours ouvrés)`);
        } else {
          parts.push(`${refundAmountKmf.toLocaleString('fr-FR')} KMF crédités en avoir`);
        }
      }
      message = `Commande annulée — ${parts.join(' + ')}`;
    }

    res.json({
      success:   true,
      reference: order.reference,
      status:    'cancelled',
      refund:    Object.keys(refundInfo).length ? refundInfo : null,
      message,
    });

  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    next(err);
  } finally {
    client.release();
  }
});

module.exports = router;
