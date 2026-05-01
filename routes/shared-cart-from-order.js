/**
 * KOMERCE — Route POST /api/shared-carts/from-order
 * ═══════════════════════════════════════════════════════════════════
 *
 * Crée un panier partagé (groupe) A PARTIR D'UNE COMMANDE FIGEE.
 *
 * Doctrine :
 *   Le créateur compose son panier, valide la commande normalement.
 *   La commande est créée en statut 'pending_group_payment'.
 *   ENSUITE il active "Payer en groupe" → cette route.
 *   Le système fige le snapshot depuis la commande existante.
 *
 * POST /api/shared-carts/from-order
 *   Body : {
 *     order_id       : UUID   (requis)
 *     split_mode     : 'free' | 'equal'  (défaut: 'free')
 *     nb_participants: number (optionnel, pour split_mode='equal')
 *     expiration_days: number (défaut: 7, max: 30)
 *     message        : string (optionnel)
 *   }
 *
 * À ajouter dans shared-cart.js :
 *   router.post('/from-order', authenticateOrCreateGuest, fromOrderHandler);
 *   module.exports = { ..., fromOrderHandler };
 */

'use strict';

const db     = require('../db');
const engine = require('../services/shared-cart-engine');
const crypto = require('crypto');

const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || 'http://localhost:3000';

/**
 * Génère un token URL-safe aléatoire.
 */
function generateToken(len = 16) {
  return crypto.randomBytes(len).toString('base64url').slice(0, len);
}

/**
 * POST /api/shared-carts/from-order
 *
 * 1. Vérifie que la commande appartient à l'utilisateur
 * 2. Vérifie que la commande est en statut 'pending' (pas encore payée)
 * 3. Passe la commande en 'pending_group_payment'
 * 4. Crée le shared_cart avec snapshot figé depuis order_items
 * 5. Retourne le lien public
 */
async function fromOrderHandler(req, res, next) {
  const client = await db.getClient();

  try {
    await client.query('BEGIN');

    const {
      order_id,
      split_mode       = 'free',
      nb_participants,
      expiration_days  = 7,
      message,
    } = req.body || {};

    // ── Validation basique ─────────────────────────────────────────
    if (!order_id) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'order_id requis' });
    }

    if (!['free', 'equal'].includes(split_mode)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'split_mode invalide : free | equal' });
    }

    const safeDays = Math.max(1, Math.min(30, Number(expiration_days) || 7));

    if (!req.user?.id) {
      await client.query('ROLLBACK');
      return res.status(401).json({ error: 'Authentification requise' });
    }

    // ── Récupérer la commande avec lock ────────────────────────────
    const { rows: [order] } = await client.query(
      `SELECT o.*, r.name AS relais_name, r.address AS relais_address
       FROM orders o
       LEFT JOIN relais r ON r.id = o.relais_id
       WHERE o.id = $1
         AND o.user_id = $2
       FOR UPDATE`,
      [order_id, req.user.id]
    );

    if (!order) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Commande introuvable' });
    }

    // ── Vérifier statut ────────────────────────────────────────────
    if (!['pending'].includes(order.status)) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: `Impossible d'activer le paiement groupé sur une commande en statut "${order.status}". Seules les commandes "pending" sont éligibles.`,
        order_status: order.status,
      });
    }

    if (order.payment_mode === 'stripe_eur' && order.payment_status === 'paid') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Commande déjà payée' });
    }

    // ── Vérifier qu'un shared_cart n'existe pas déjà ───────────────
    const { rows: [existing] } = await client.query(
      `SELECT id FROM shared_carts WHERE source_order_id = $1 LIMIT 1`,
      [order_id]
    );
    if (existing) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'Un panier groupe existe déjà pour cette commande',
        shared_cart_id: existing.id,
      });
    }

    // ── Récupérer les items de la commande ─────────────────────────
    const { rows: orderItems } = await client.query(
      `SELECT oi.*, p.name AS product_name, p.image_url AS product_image,
              p.category AS product_category
       FROM order_items oi
       LEFT JOIN products p ON p.id = oi.product_id
       WHERE oi.order_id = $1
       ORDER BY oi.created_at`,
      [order_id]
    );

    if (!orderItems.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Commande sans articles' });
    }

    const totalKmf = order.total_kmf;

    // ── Calculer la part suggérée si mode equal ────────────────────
    const safeNbParticipants = nb_participants
      ? Math.max(2, Math.min(50, Number(nb_participants)))
      : null;

    const suggestedShareKmf = (split_mode === 'equal' && safeNbParticipants)
      ? Math.ceil(totalKmf / safeNbParticipants)
      : null;

    // ── Passer la commande en pending_group_payment ────────────────
    await client.query(
      `UPDATE orders
       SET status     = 'pending_group_payment',
           updated_at = NOW()
       WHERE id = $1`,
      [order_id]
    );

    await client.query(
      `INSERT INTO order_status_history (order_id, status, note, changed_by)
       VALUES ($1, 'pending_group_payment', 'Paiement groupé activé par le créateur', $2)`,
      [order_id, req.user.id]
    );

    // ── Créer le shared_cart ───────────────────────────────────────
    const token      = generateToken(16);
    const expiresAt  = new Date(Date.now() + safeDays * 86400 * 1000);

    const { rows: [cart] } = await client.query(
      `INSERT INTO shared_carts (
         token,
         beneficiary_user_id,
         beneficiary_name_snapshot,
         beneficiary_phone_snapshot,
         source_order_id,
         title,
         message,
         total_kmf_snapshot,
         contributed_kmf,
         remaining_kmf,
         split_mode,
         suggested_share_kmf,
         expected_participants,
         delivery_relay_id,
         status,
         expires_at
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,0,$8,$9,$10,$11,$12,'active',$13
       ) RETURNING *`,
      [
        token,
        req.user.id,
        order.recipient_name || req.user.full_name || 'Bénéficiaire',
        order.recipient_phone || order.tracking_phone || req.user.phone || null,
        order_id,
        order.reference
          ? `Commande ${order.reference}`
          : 'Commande groupée',
        message || null,
        totalKmf,
        split_mode,
        suggestedShareKmf,
        safeNbParticipants,
        order.relais_id || null,
        expiresAt,
      ]
    );

    // ── Créer les shared_cart_items (snapshot figé depuis order) ───
    for (const item of orderItems) {
      await client.query(
        `INSERT INTO shared_cart_items (
           shared_cart_id,
           product_id,
           product_name_snapshot,
           product_image_snapshot,
           product_category_snapshot,
           quantity,
           unit_price_kmf_snapshot,
           line_total_kmf_snapshot
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          cart.id,
          item.product_id,
          item.product_name || 'Produit',
          item.product_image || null,
          item.product_category || null,
          item.quantity,
          item.price_kmf,
          item.price_kmf * item.quantity,
        ]
      );
    }

    // ── Audit log ──────────────────────────────────────────────────
    await client.query(
      `INSERT INTO shared_cart_events
         (shared_cart_id, event_type, actor_type, actor_id, payload)
       VALUES ($1, 'group_order_created', 'user', $2, $3)`,
      [
        cart.id,
        req.user.id,
        {
          order_id,
          order_reference: order.reference,
          total_kmf: totalKmf,
          split_mode,
          suggested_share_kmf: suggestedShareKmf,
          nb_participants: safeNbParticipants,
        },
      ]
    );

    await client.query('COMMIT');

    const shareUrl = `${PUBLIC_BASE_URL}/cart/shared/${token}`;

    return res.status(201).json({
      shared_cart_id:     cart.id,
      token,
      share_url:          shareUrl,
      total_kmf:          totalKmf,
      split_mode,
      suggested_share_kmf: suggestedShareKmf,
      expected_participants: safeNbParticipants,
      expires_at:         cart.expires_at,
      order_reference:    order.reference,
    });

  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    next(err);
  } finally {
    client.release();
  }
}

module.exports = { fromOrderHandler };
