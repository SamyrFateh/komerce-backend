/**
 * ═══════════════════════════════════════════════════════════════════════
 * ORDER API v2 — Komerce
 * ═══════════════════════════════════════════════════════════════════════
 * 
 * RÈGLE MÉTIER FONDAMENTALE:
 *   Pas de paiement confirmé → Pas de commande confirmée → Pas de colis
 *
 *   cash_relais  → Client paie au relais → Agent relais confirme ici
 *   online       → Client paie en ligne  → Stripe/webhook confirme
 * 
 * Endpoints:
 *   POST /api/v2/orders/:ref/confirm-cash-payment → Confirmer paiement cash relais
 *   GET  /api/v2/orders/pending-cash              → Liste commandes cash en attente
 * ═══════════════════════════════════════════════════════════════════════
 */

const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');

// ═══════════════════════════════════════════════════════════════════════
// 1. POST /:ref/confirm-cash-payment — Confirmer paiement cash relais
// ═══════════════════════════════════════════════════════════════════════
/**
 * Appelé par l'agent relais quand le client paie en cash au point relais.
 * 
 * Flow:
 *   1. Client vient au relais, paie cash
 *   2. Agent relais scanne/saisit la référence commande
 *   3. Cet endpoint confirme le paiement
 *   4. La commande passe en "confirmed" → eligible pour création colis au hub
 *
 * Body: { notes?: string }
 */
router.post('/:ref/confirm-cash-payment',
  authenticate,
  requireRole(['agent_relais', 'admin']),
  async (req, res, next) => {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      const { ref } = req.params;
      const { notes } = req.body || {};

      // Find order by reference or UUID
      const { rows: [order] } = await client.query(
        `SELECT o.id, o.reference, o.status, o.payment_mode, o.payment_status,
                o.total_kmf, o.user_id,
                u.full_name AS customer_name, u.phone AS customer_phone,
                r.name AS relais_name
         FROM orders o
         LEFT JOIN users u ON u.id = o.user_id
         LEFT JOIN relais r ON r.id = COALESCE(o.relais_id, o.destination_relais)
         WHERE o.reference = $1 OR o.id::text = $1`,
        [ref]
      );

      if (!order) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          error: `Commande ${ref} introuvable`,
          hint: 'Vérifiez la référence (ex: KT-001)'
        });
      }

      // Validations
      if (order.payment_mode !== 'cash_relais') {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: `Commande ${order.reference} n'est pas en mode cash relais`,
          payment_mode: order.payment_mode,
          hint: order.payment_mode === 'stripe_eur'
            ? 'Cette commande est payée en ligne — pas besoin de confirmation manuelle'
            : `Mode de paiement: ${order.payment_mode}`
        });
      }

      if (order.payment_status === 'paid') {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: `Commande ${order.reference} est déjà payée`,
          payment_status: 'paid',
          hint: 'Le paiement a déjà été confirmé'
        });
      }

      if (order.status === 'cancelled') {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: `Commande ${order.reference} est annulée — impossible de confirmer le paiement`,
          status: 'cancelled'
        });
      }

      // ── CONFIRMER LE PAIEMENT ─────────────────────────────────────
      const noteText = notes
        || `💰 Paiement cash confirmé par ${req.user.full_name || req.user.email} au relais`;

      await client.query(
        `UPDATE orders SET
           payment_status = 'paid',
           cash_paid_at = NOW(),
           status = CASE
             WHEN status IN ('pending', 'confirmed') THEN 'confirmed'
             ELSE status
           END,
           updated_at = NOW()
         WHERE id = $1`,
        [order.id]
      );

      // Log dans l'historique
      await client.query(
        `INSERT INTO order_status_history (order_id, status, note, changed_by)
         VALUES ($1, 'confirmed', $2, $3::uuid)`,
        [order.id, noteText, req.user.id]
      );

      await client.query('COMMIT');

      const newStatus = ['pending', 'confirmed'].includes(order.status) ? 'confirmed' : order.status;

      console.log(`💰 [CASH] ${order.reference} — ${order.total_kmf} KMF — confirmé par ${req.user.email} (${order.relais_name || '?'})`);

      res.json({
        success: true,
        message: `✅ Paiement cash confirmé pour ${order.reference}`,
        order: {
          reference: order.reference,
          customer_name: order.customer_name,
          customer_phone: order.customer_phone,
          relais_name: order.relais_name,
          total_kmf: order.total_kmf,
          old_status: order.status,
          new_status: newStatus,
          old_payment_status: order.payment_status,
          new_payment_status: 'paid',
          confirmed_by: req.user.full_name || req.user.email,
          confirmed_at: new Date().toISOString(),
        },
        next_step: 'La commande est maintenant éligible à la création d\'un colis au hub.',
      });

    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      next(err);
    } finally {
      client.release();
    }
  }
);

// ═══════════════════════════════════════════════════════════════════════
// 2. GET /pending-cash — Liste commandes cash relais en attente de paiement
// ═══════════════════════════════════════════════════════════════════════
/**
 * Liste toutes les commandes cash_relais non payées.
 * Utilisé par le dashboard relais pour voir qui doit payer.
 * 
 * Filtres query: ?island=Anjouan&relais_id=xxx
 */
router.get('/pending-cash',
  authenticate,
  requireRole(['agent_relais', 'admin', 'agent_hub']),
  async (req, res, next) => {
    try {
      const { island, relais_id } = req.query;

      const conditions = [
        "o.payment_mode = 'cash_relais'",
        "o.payment_status != 'paid'",
        "o.status != 'cancelled'"
      ];
      const params = [];
      let pi = 1;

      if (island) {
        conditions.push(`o.destination_island = $${pi++}`);
        params.push(island);
      }
      if (relais_id) {
        conditions.push(`COALESCE(o.relais_id, o.destination_relais) = $${pi++}::uuid`);
        params.push(relais_id);
      }

      const { rows } = await db.query(`
        SELECT
          o.reference, o.status, o.total_kmf, o.payment_status,
          o.destination_island, o.created_at,
          u.full_name AS customer_name, u.phone AS customer_phone,
          r.name AS relais_name, r.island AS relais_island,
          (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id)::int AS nb_items
        FROM orders o
        LEFT JOIN users u ON u.id = o.user_id
        LEFT JOIN relais r ON r.id = COALESCE(o.relais_id, o.destination_relais)
        WHERE ${conditions.join(' AND ')}
        ORDER BY o.created_at DESC
      `, params);

      res.json({
        pending_cash_orders: rows,
        total: rows.length,
        total_kmf: rows.reduce((s, r) => s + (Number(r.total_kmf) || 0), 0),
        message: rows.length === 0
          ? 'Aucune commande cash en attente 🎉'
          : `${rows.length} commande(s) en attente de paiement cash`,
      });

    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
