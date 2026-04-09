/**
 * KOMERCE — Annulation commande
 *
 * POST /:id/cancel — annulation avec remboursement automatique
 *
 * Auth : client (sa propre commande) ou admin (toute commande)
 * Body : { reason?: string }
 *
 * Règles (business_rules) :
 *   CANCEL_FREE_WINDOW_HOURS  — fenêtre remboursement 100% (défaut: 24h)
 *   CANCEL_PARTIAL_REFUND_PCT — % remboursé hors fenêtre  (défaut: 80%)\
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

// ─── POST /api/orders/:id/cancel ─────────────────────────────────────────────

router.post('/:id/cancel', authenticate, validate(orders.cancelOrder), async (req, res, next) => {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    const { id }     = req.params;
    const { reason } = req.body;

    // ── 1. Récupérer la commande ──────────────────────────────────────────────
    const { rows: [order] } = await client.query(
      `SELECT o.*, u.phone AS user_phone, u.email AS user_email
       FROM orders o
       LEFT JOIN users u ON u.id = o.user_id
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
      'confirmed', 'ordered', 'preparation',
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

    // ── 5. Calculer le remboursement ──────────────────────────────────────────
    const isPaid         = order.payment_status === 'paid';
    let refundAmountKmf  = 0;
    let refundAmountEur  = 0;
    let refundType       = 'none';
    let inFreeWindow     = false;

    if (isPaid) {
      const freeWindowHours  = await getRule('CANCEL_FREE_WINDOW_HOURS', 24);
      const partialRefundPct = await getRule('CANCEL_PARTIAL_REFUND_PCT', 80);

      // Référence temporelle : ordered_at (moment du paiement réel)
      const paidAt         = order.ordered_at || order.created_at;
      const hoursSincePaid = (Date.now() - new Date(paidAt).getTime()) / (1000 * 60 * 60);
      inFreeWindow         = hoursSincePaid <= freeWindowHours;

      const refundPct   = inFreeWindow ? 100 : partialRefundPct;
      refundAmountKmf   = Math.round(Number(order.total_kmf) * refundPct / 100);

      // Convertir en EUR (pro-rata basé sur total_eur/total_kmf)
      const eurKmfRate  = order.total_eur && order.total_kmf
        ? Number(order.total_kmf) / Number(order.total_eur)
        : 492;
      refundAmountEur   = parseFloat((refundAmountKmf / eurKmfRate).toFixed(2));
      refundType        = inFreeWindow ? 'full' : 'partial';
    }

    // ── 6. Exécuter le remboursement Stripe AVANT le COMMIT ────────────────
    let refundResult = null;

    if (isPaid && refundAmountKmf > 0) {
      // processRefund lève une erreur si Stripe échoue — on ROLLBACK
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
        console.error('[CANCEL] Refund error:', refundErr.message);
        return res.status(500).json({
          error: `Annulation impossible — erreur remboursement: ${refundErr.message}`,
        });
      }
    }

    // ── 7. Annuler la commande ──────────────────────────────────────────────
    await client.query(
      `UPDATE orders
       SET status = 'cancelled', cancelled_at = NOW(), cancel_reason = $1, updated_at = NOW()
       WHERE id = $2`,
      [reason || null, id]
    );

    await client.query(
      `INSERT INTO order_status_history (order_id, status, note, changed_by)
       VALUES ($1, 'cancelled', $2, $3)`,
      [id, reason ? `Annulation : ${reason}` : 'Annulation client', req.user.id]
    );

    // ── 8. Restaurer le stock ───────────────────────────────────────────────
    const { rows: items } = await client.query(
      'SELECT product_id, quantity FROM order_items WHERE order_id = $1', [id]
    );
    for (const item of items) {
      await client.query(
        'UPDATE products SET stock = stock + $1 WHERE id = $2',
        [item.quantity, item.product_id]
      );
    }

    await client.query('COMMIT');

    // ── 9. SMS client (non bloquant) ───────────────────────────────────────
    const smsRefundInfo = refundResult ? {
      method:    refundResult.method,
      amountEur: refundResult.amountEur,
      amountKmf: refundResult.amountKmf,
    } : null;
    notifyCancellation(order, smsRefundInfo);

    // ── Réponse ─────────────────────────────────────────────────────────────
    const refundInfo = isPaid && refundAmountKmf > 0 && refundResult ? {
      amount_kmf:       refundAmountKmf,
      amount_eur:       refundAmountEur,
      type:             refundType,
      method:           refundResult.method,
      in_free_window:   inFreeWindow,
      stripe_refund_id: refundResult.stripeRefundId,
      store_credit_id:  refundResult.storeCreditId,
    } : null;

    let message;
    if (!isPaid) {
      message = 'Commande annulée — aucun prélèvement effectué';
    } else if (refundResult?.method === 'stripe') {
      message = `Remboursement de ${refundAmountEur.toFixed(2)}€ initié via Stripe (2–5 jours ouvrés)`;
    } else {
      message = `Crédit boutique de ${Number(refundAmountKmf).toLocaleString('fr-FR')} KMF crédité sur votre compte`;
    }

    res.json({
      success:   true,
      reference: order.reference,
      status:    'cancelled',
      refund:    refundInfo,
      message,
    });

  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

module.exports = router;
