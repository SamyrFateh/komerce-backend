/**
 * @komerce-arch
 * @role          orders-status
 * @domain        orders
 * @layer         route
 * @criticality   critical
 * @inputs        order_id, status, note (admin/agent)
 * @outputs       updated order status, pickup_proof (if collected)
 * @depends       db.js, middleware/auth.js, services/*
 * @used-by       bootstrap/api-routes.js
 * @db-read       orders, recipients, relais, users
 * @db-write      customs_history, orders
 * @db-txn        resolve_before_behavior_change
 * @doctrine      order_status_machine, pickup_collected_proof, resolve_before_behavior_change
 * @impact-areas  orders, checkout
 * @version       2026-06
 */

/**
 * KOMERCE — Mise à jour statut & coût — v2.0 (cleaned)
 *
 * PATCH /:id/status → changer statut (admin/agent_hub/agent_relais)
 * PATCH /:id/cost   → saisir le coût réel (admin)
 *
 * v2.0 — E1 cleanup:
 *   Removed dead local ORDER_STATUSES, VALID_TRANSITIONS, TRANSITION_ROLES.
 *   All transition logic is in services/order-status-machine.js (D1/D2).
 */

'use strict';

const express = require('express');
const router  = express.Router();
const db      = require('../../db');
const { authenticate, requireRole } = require('../../middleware/auth');
const { validate }                  = require('../../middleware/validate');
const { orders }                    = require('../../validators');
// O7.3 (provider loyalty) : importait auparavant '../loyalty' (routes/loyalty.js,
// une route — pas une boundary de feature). Voir docs/O7_3_BOUNDARY_ANALYSIS.md.
const { recalculateLoyalty }        = require('../../services/loyalty-service');
const { notifyStatusChange }        = require('../../services/notification-service');
const { transitionOrderStatus }     = require('../../services/order-status-machine');
const log = require('../../utils/logger').child({ module: 'status' });
const pickupProofService = require('../../services/documents/pickup-proof');

// ─── PATCH /api/orders/:id/status ────────────────────────────────────────────

router.patch('/:id/status', authenticate, requireRole(['admin', 'agent_hub', 'agent_relais']), validate(orders.updateStatus), async (req, res, next) => {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    const { status, note } = req.body;

    // ── D1/D2: ALL status transitions go through the machine ─────────────
    // The machine handles: validation, transitions, timestamps, history,
    // pickup_code generation, cash_relais auto-paid, wallet reversal (cancel),
    // stock restore (cancel).

    const { rows: [order] } = await client.query(
      `SELECT o.*,
              r.name        AS relais_name,
              u.phone       AS user_phone,
              u.full_name   AS user_full_name,
              u.phone_payer,
              rc.phone      AS recipient_phone,
              rc.full_name  AS recipient_name
       FROM orders o
       LEFT JOIN relais     r  ON r.id  = o.relais_id
       LEFT JOIN users      u  ON u.id  = o.user_id
       LEFT JOIN recipients rc ON rc.id = o.recipient_id
       WHERE o.id = $1`,
      [req.params.id]
    );
    if (!order) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Commande introuvable' });
    }

    // GOV-02 (volet 2) — IDOR cross-relais : agent_relais est multi-tenant
    // (plusieurs points relais physiques). Un agent_relais ne peut agir que
    // sur les commandes de SON relais. admin et agent_hub ont une portée
    // globale, non concernés par ce garde-fou.
    if (req.user.role === 'agent_relais' && String(order.relais_id) !== String(req.user.relais_id)) {
      await client.query('ROLLBACK');
      log.warn(`[IDOR] bloqué — user ${req.user.id} (relais ${req.user.relais_id}) → order ${order.id} (relais ${order.relais_id})`);
      return res.status(403).json({ error: "Cette commande n'appartient pas à votre relais" });
    }

    const result = await transitionOrderStatus({
      orderId: order.id,
      newStatus: status,
      actor: { id: req.user.id, role: req.user.role },
      source: 'patch',
      note: note || null,
      cancelReason: (status === 'cancelled' && note) ? note : null,
      dbClient: client,
    });

    if (!result.success) {
      await client.query('ROLLBACK');
      const httpCode = result.error?.includes('Rôle') ? 403 : 422;
      return res.status(httpCode).json({
        error: result.error,
        current_status: order.status,
      });
    }

    await client.query('COMMIT');

    // ── Preuve de retrait (post-commit, non bloquant) ─────────────────────
    if (status === 'collected') {
      pickupProofService.issue(order.id, { issuedBy: req.user.id }).catch(err => {
        log.warn({ err, order_id: order.id }, '[status] émission preuve de retrait échouée (non-fatal)');
      });
    }

    // ── Recalculer le palier fidélité après collecte ──────────────────────
    if (status === 'collected' && order.user_id) {
      recalculateLoyalty(db, order.user_id)
        .catch(e => log.error({ err: e }, '[LOYALTY] recalculate error:'));
    }

    // SMS notification (non bloquant)
    Promise.resolve().then(() => notifyStatusChange(order, status))
      .catch(e => log.warn({ err: e, order_id: order.id }, '[status] notifyStatusChange failed (non-fatal)'));

    res.json({ success: true, status });

  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    next(err);
  } finally {
    client.release();
  }
});

// ─── PATCH /api/orders/:id/cost ──────────────────────────────────────────────

router.patch('/:id/cost', authenticate, requireRole(['admin']), validate(orders.updateCost), async (req, res, next) => {
  try {
    const {
      cost_real_kmf,
      customs_real_kmf,
      customs_agent_id,
      customs_notes,
      sh_category,
      supplier_name,
      supplier_invoice_url,
    } = req.body;

    if (!cost_real_kmf) return res.status(400).json({ error: 'cost_real_kmf obligatoire' });

    const { rows: [order] } = await db.query(
      'SELECT * FROM orders WHERE id = $1', [req.params.id]
    );
    if (!order) return res.status(404).json({ error: 'Commande introuvable' });

    const updates = ['cost_real_kmf = $1', 'updated_at = NOW()'];
    const values  = [cost_real_kmf];
    let   pi      = 2;

    if (supplier_name !== undefined) {
      updates.push(`supplier_name = $${pi++}`);
      values.push(supplier_name);
    }
    if (supplier_invoice_url !== undefined) {
      updates.push(`supplier_invoice_url = $${pi++}`);
      values.push(supplier_invoice_url);
    }
    values.push(order.id);

    await db.query(
      `UPDATE orders SET ${updates.join(', ')} WHERE id = $${pi}`,
      values
    );

    if (customs_real_kmf && sh_category) {
      await db.query(
        `INSERT INTO customs_history
           (order_id, sh_category, customs_estimated_kmf, customs_real_kmf,
            customs_agent_id, customs_notes)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [
          order.id,
          sh_category,
          order.cost_estimated_kmf || null,
          customs_real_kmf,
          customs_agent_id || null,
          customs_notes    || null,
        ]
      );
    }

    const { rows: [updated] } = await db.query(
      `SELECT id, reference, cost_real_kmf, margin_real_pct,
              margin_alert, sourcing_blocked, cost_delta_pct,
              supplier_name, supplier_invoice_url
       FROM orders WHERE id = $1`,
      [req.params.id]
    );

    res.json({ success: true, order: updated });

  } catch(err) { next(err); }
});

module.exports = router;
