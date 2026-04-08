/**
 * KOMERCE — Mise à jour statut & coût
 *
 * PATCH /:id/status → changer statut (admin/agent_hub/agent_relais)
 * PATCH /:id/cost   → saisir le coût réel (admin)
 */

'use strict';

const express = require('express');
const router  = express.Router();
const { randomBytes } = require('crypto');
const db      = require('../../db');
const { authenticate, requireRole } = require('../../middleware/auth');
const { validate }                  = require('../../middleware/validate');
const { orders }                    = require('../../validators');
const { recalculateLoyalty }        = require('../loyalty');
const { notifyStatusChange }        = require('../../services/notification-service');

// ─── Constantes — pipeline MVP 6 étapes (v8.0) ──────────────────────────────

const ORDER_STATUSES = [
  'confirmed',    // commande créée
  'ordered',      // paiement validé → commande lancée
  'preparation',  // SCAN Hub — emballage
  'shipped',      // remis au transitaire à Dubai
  'in_transit',   // 🚢 embarqué — confirmation transitaire
  'available',    // SCAN Relais — colis reçu
  'collected',    // SCAN QR — remis au client
  'cancelled',
  'refunded',
];

// Matrice de transitions valides — pipeline MVP 7 étapes (v9.0)
const VALID_TRANSITIONS = {
  confirmed:   ['ordered', 'cancelled'],
  ordered:     ['preparation', 'cancelled'],
  preparation: ['shipped', 'cancelled'],
  shipped:     ['in_transit', 'cancelled'],
  in_transit:  ['available', 'cancelled'],
  available:   ['collected', 'cancelled'],
  collected:   [],
  cancelled:   ['refunded'],
  refunded:    [],
};

// Rôles autorisés par transition — pipeline MVP 7 étapes (v9.0)
const TRANSITION_ROLES = {
  ordered:     ['admin', 'agent_relais'],  // cash validé par agent_relais, ou webhook Stripe
  preparation: ['admin', 'agent_hub'],     // SCAN Hub
  shipped:     ['admin', 'agent_hub'],     // remis au transitaire
  in_transit:  ['admin'],                  // confirmation embarquement transitaire
  available:   ['admin', 'agent_relais'],  // SCAN Relais — arrivée
  collected:   ['admin', 'agent_relais'],  // SCAN QR
  cancelled:   ['admin'],
  refunded:    ['admin'],
};

// ─── PATCH /api/orders/:id/status ────────────────────────────────────────────

router.patch('/:id/status', authenticate, requireRole(['admin', 'agent_hub', 'agent_relais']), validate(orders.updateStatus), async (req, res) => {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    const { status, note } = req.body;

    if (!ORDER_STATUSES.includes(status)) {
      return res.status(400).json({
        error: `Statut invalide. Valeurs : ${ORDER_STATUSES.join(', ')}`,
      });
    }

    const { rows: [order] } = await client.query(
      `SELECT o.*, r.name AS relais_name, u.phone AS user_phone
       FROM orders o
       LEFT JOIN relais r ON r.id = o.relais_id
       LEFT JOIN users  u ON u.id = o.user_id
       WHERE o.id = $1`,
      [req.params.id]
    );
    if (!order) return res.status(404).json({ error: 'Commande introuvable' });

    // ── Valider la transition d'état ─────────────────────────────────────────
    const allowedNext = VALID_TRANSITIONS[order.status] || [];
    if (!allowedNext.includes(status)) {
      await client.query('ROLLBACK');
      return res.status(422).json({
        error: `Transition invalide : ${order.status} → ${status}. Transitions autorisées depuis "${order.status}" : ${allowedNext.join(', ') || 'aucune (état terminal)'}`,
        current_status: order.status,
      });
    }

    // Vérifier que le rôle de l'agent est autorisé pour cette transition
    const allowedRoles = TRANSITION_ROLES[status] || ['admin'];
    if (!allowedRoles.includes(req.user.role)) {
      await client.query('ROLLBACK');
      return res.status(403).json({
        error: `Rôle "${req.user.role}" non autorisé pour la transition → ${status}`,
      });
    }

    // agent_relais ne peut passer à 'ordered' que pour les commandes cash_relais
    if (status === 'ordered' && req.user.role === 'agent_relais' && order.payment_mode !== 'cash_relais') {
      await client.query('ROLLBACK');
      return res.status(403).json({
        error: "L'agent relais ne peut valider le paiement que pour les commandes cash relais",
      });
    }

    // Si passage à available et pickup_code manquant → en générer un
    let pickupCodeValue = null;
    if (status === 'available' && !order.pickup_code) {
      const PICKUP_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
      const newCode = Array.from({ length: 6 }, () => {
        let b;
        do { b = randomBytes(1)[0]; } while (b >= 216);
        return PICKUP_CHARS[b % 36];
      }).join('');
      pickupCodeValue = newCode;
      console.log(`[ORDERS] pickup_code auto-généré pour ${order.reference}: ${newCode}`);
    }

    // Timestamps paramétrés via CASE WHEN — aucune interpolation dans la query (coffre-fort v1.0)
    // Tous les noms de colonnes sont statiques, aucune valeur utilisateur n'entre dans la query string.
    await client.query(
      `UPDATE orders SET
         status         = $1,
         ordered_at     = CASE WHEN $1 = 'ordered'     AND ordered_at IS NULL     THEN NOW() ELSE ordered_at END,
         preparation_at = CASE WHEN $1 = 'preparation' AND preparation_at IS NULL THEN NOW() ELSE preparation_at END,
         shipped_at     = CASE WHEN $1 = 'shipped'     AND shipped_at IS NULL     THEN NOW() ELSE shipped_at END,
         available_at   = CASE WHEN $1 = 'available'   AND available_at IS NULL   THEN NOW() ELSE available_at END,
         collected_at   = CASE WHEN $1 = 'collected'   AND collected_at IS NULL   THEN NOW() ELSE collected_at END,
         cancelled_at   = CASE WHEN $1 = 'cancelled'   AND cancelled_at IS NULL   THEN NOW() ELSE cancelled_at END,
         pickup_code    = COALESCE($2, pickup_code),
         updated_at     = NOW()
       WHERE id = $3`,
      [status, pickupCodeValue, order.id]
    );

    // Mettre à jour payment_status pour les commandes cash_relais passées à 'ordered'
    if (status === 'ordered' && order.payment_mode === 'cash_relais') {
      await client.query(
        `UPDATE orders SET payment_status = 'paid' WHERE id = $1`,
        [order.id]
      );
    }

    await client.query(
      `INSERT INTO order_status_history (order_id, status, note, changed_by)
       VALUES ($1, $2, $3, $4)`,
      [order.id, status, note || null, req.user.id]
    );

    await client.query('COMMIT');

    // ── Recalculer le palier fidélité après collecte ──────────────────────
    if (status === 'collected' && order.user_id) {
      recalculateLoyalty(db, order.user_id)
        .catch(e => console.error('[LOYALTY] recalculate error:', e.message));
    }

    // SMS notification (non bloquant)
    notifyStatusChange(order, status);

    res.json({ success: true, status });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Update status error:', err.message);
    res.status(500).json({ error: 'Erreur mise à jour statut' });
  } finally {
    client.release();
  }
});

// ─── PATCH /api/orders/:id/cost ──────────────────────────────────────────────

router.patch('/:id/cost', authenticate, requireRole(['admin']), validate(orders.updateCost), async (req, res) => {
  try {
    const {
      cost_real_kmf,
      customs_real_kmf,
      customs_agent_id,
      customs_notes,
      sh_category,
      // ── Traçabilité fournisseur (v7.6) ────────────────────────────────────
      // supplier_name        : enseigne / fournisseur (ex: "Noon Dubai", "Carrefour MoE")
      // supplier_invoice_url : lien facture (Google Drive, S3, URL directe)
      supplier_name,
      supplier_invoice_url,
    } = req.body;

    if (!cost_real_kmf) return res.status(400).json({ error: 'cost_real_kmf obligatoire' });

    const { rows: [order] } = await db.query(
      'SELECT * FROM orders WHERE id = $1', [req.params.id]
    );
    if (!order) return res.status(404).json({ error: 'Commande introuvable' });

    // Construire la mise à jour dynamiquement selon les champs fournis
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

    // Mise à jour coût réel (le trigger compute_real_margin recalcule margin_real_pct)
    await db.query(
      `UPDATE orders SET ${updates.join(', ')} WHERE id = $${pi}`,
      values
    );

    // Customs history — sans customs_delta_pct ni customs_delta_kmf (GENERATED)
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

  } catch (err) {
    console.error('Update cost error:', err.message);
    res.status(500).json({ error: 'Erreur saisie coût réel' });
  }
});

module.exports = router;
