/**
 * ═══════════════════════════════════════════════════════════════
 * ORDER API v2.1 — Komerce (COLIS-FIRST) — Flux corrigé
 * ═══════════════════════════════════════════════════════════════
 * 
 * FLUX CORRECT:
 *   pending → confirmed → ordered → preparation → shipped → in_transit → available → collected
 *
 * Endpoints opérationnels pour la Control Tower:
 *   GET  /api/v2/orders/pending-cash        → Commandes cash en attente
 *   GET  /api/v2/orders/ready-for-parcel    → Commandes CONFIRMÉES sans colis
 *   POST /api/v2/orders/:ref/confirm-cash   → Confirmer paiement cash + FACTURE
 *   POST /api/v2/orders/:ref/create-parcel  → Créer colis (status → ordered)
 * ═══════════════════════════════════════════════════════════════
 */

const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');

const guard = [authenticate, requireRole(['admin', 'agent_hub', 'agent_relais'])];

// ═══════════════════════════════════════════════════════════════
// 1. GET /pending-cash — Commandes cash_relais en attente de paiement
// ═══════════════════════════════════════════════════════════════

router.get('/pending-cash', ...guard, async (req, res, next) => {
  try {
    const { rows } = await db.query(`
      SELECT o.id, o.reference, o.status, o.total_kmf, o.total_eur,
        o.payment_mode, o.payment_status, o.cash_ref_code,
        o.created_at, o.destination_island,
        u.full_name AS customer_name, u.phone AS customer_phone,
        r.name AS relais_name, r.island AS relais_island,
        (SELECT COUNT(*)::int FROM order_items WHERE order_id = o.id) AS nb_items,
        (SELECT SUM(quantity)::int FROM order_items WHERE order_id = o.id) AS total_qty
      FROM orders o
      LEFT JOIN users u ON u.id = o.user_id
      LEFT JOIN relais r ON r.id = o.relais_id
      WHERE o.payment_mode = 'cash_relais' 
        AND o.payment_status = 'pending'
        AND o.status NOT IN ('cancelled', 'collected', 'refunded')
      ORDER BY o.created_at ASC
    `);
    res.json({ count: rows.length, orders: rows });
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════════
// 2. GET /ready-for-parcel — Commandes CONFIRMÉES sans colis
//    ⚠️ UNIQUEMENT status = 'confirmed' (payées, prêtes pour colis)
// ═══════════════════════════════════════════════════════════════

router.get('/ready-for-parcel', ...guard, async (req, res, next) => {
  try {
    const { rows } = await db.query(`
      SELECT o.id, o.reference, o.status, o.total_kmf, o.total_eur,
        o.payment_mode, o.payment_status,
        o.created_at, o.destination_island,
        u.full_name AS customer_name, u.phone AS customer_phone,
        r.name AS relais_name, r.island AS relais_island, r.id AS relais_id,
        (SELECT COUNT(*)::int FROM order_items WHERE order_id = o.id) AS nb_items,
        (SELECT SUM(quantity)::int FROM order_items WHERE order_id = o.id) AS total_qty
      FROM orders o
      LEFT JOIN users u ON u.id = o.user_id
      LEFT JOIN relais r ON r.id = o.relais_id
      WHERE o.payment_status = 'paid'
        AND o.status = 'confirmed'
        AND NOT EXISTS (SELECT 1 FROM parcels p WHERE p.order_id = o.id)
      ORDER BY o.created_at ASC
    `);
    res.json({ count: rows.length, orders: rows });
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════════
// 3. POST /:ref/confirm-cash — Confirmer paiement cash relais
//    → Génère la FACTURE + envoie WhatsApp avec facture
// ═══════════════════════════════════════════════════════════════

router.post('/:ref/confirm-cash', ...guard, async (req, res, next) => {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const { ref } = req.params;

    const { rows: [order] } = await client.query(
      `SELECT o.id, o.reference, o.status, o.payment_mode, o.payment_status, o.total_kmf, o.user_id,
         u.full_name AS customer_name, u.phone AS customer_phone
       FROM orders o
       LEFT JOIN users u ON u.id = o.user_id
       WHERE o.reference = $1 OR o.id::text = $1`, [ref]
    );

    if (!order) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: `Commande ${ref} introuvable` });
    }
    if (order.payment_mode !== 'cash_relais') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Cette commande n\'est pas en paiement cash relais' });
    }
    if (order.payment_status === 'paid') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Paiement déjà confirmé' });
    }

    // ── Update order: paid + confirmed ──
    await client.query(
      `UPDATE orders SET payment_status = 'paid', status = 'confirmed', 
         cash_paid_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [order.id]
    );

    // ── Log status change ──
    try {
      await client.query('SAVEPOINT sp_osh');
      await client.query(
        `INSERT INTO order_status_history (order_id, status, note, changed_by)
         VALUES ($1::uuid, 'confirmed', 'Paiement cash confirmé par agent', $2::uuid)`,
        [order.id, req.user?.id || null]
      );
      await client.query('RELEASE SAVEPOINT sp_osh');
    } catch(_) { await client.query('ROLLBACK TO SAVEPOINT sp_osh'); }

    await client.query('COMMIT');

    console.log(`💰 Cash confirmed: ${order.reference} by ${req.user?.email || 'system'}`);

    // ── NOTIFICATIONS — Facture + WhatsApp (fire-and-forget) ──
    const notif = require('../services/notification-service');
    notif.notifyPaymentConfirmed(order.id, order.reference)
      .then(result => {
        if (result?.invoice) {
          console.log(`🧾 Invoice ${result.invoice} sent for ${order.reference}`);
        }
      })
      .catch(e => console.error('[CONFIRM-NOTIF] ❌', e.message));

    res.json({
      success: true,
      message: `✅ Paiement confirmé pour ${order.reference} — Facture envoyée par WhatsApp`,
      order: {
        reference: order.reference,
        old_status: order.status,
        new_status: 'confirmed',
        payment_status: 'paid',
        total_kmf: Number(order.total_kmf),
        customer_name: order.customer_name,
        customer_phone: order.customer_phone,
      }
    });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

// ═══════════════════════════════════════════════════════════════
// 4. POST /:ref/create-parcel — Créer un colis pour une commande
//    → Status: confirmed → ORDERED (pas preparation)
// ═══════════════════════════════════════════════════════════════

router.post('/:ref/create-parcel', ...guard, async (req, res, next) => {
  const { v4: uuidv4 } = require('uuid');
  const { randomBytes } = require('crypto');
  const client = await db.getClient();
  
  try {
    await client.query('BEGIN');
    const { ref } = req.params;

    // 1. Find order
    const { rows: [order] } = await client.query(
      `SELECT o.id, o.reference, o.status, o.payment_status, o.payment_mode,
         o.total_kmf, o.user_id, o.relais_id, o.destination_island,
         u.full_name AS customer_name, u.phone AS customer_phone,
         r.name AS relais_name, r.island AS relais_island
       FROM orders o
       LEFT JOIN users u ON u.id = o.user_id
       LEFT JOIN relais r ON r.id = o.relais_id
       WHERE o.reference = $1 OR o.id::text = $1`, [ref]
    );

    if (!order) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: `Commande ${ref} introuvable` });
    }

    // 2. Validate: must be PAID + CONFIRMED
    if (order.payment_status !== 'paid') {
      await client.query('ROLLBACK');
      return res.status(400).json({ 
        error: 'Paiement non confirmé — impossible de créer un colis',
        rule: 'PAS DE PAIEMENT = PAS DE COLIS'
      });
    }

    if (order.status !== 'confirmed') {
      await client.query('ROLLBACK');
      return res.status(400).json({ 
        error: `La commande doit être en statut "confirmed" (actuellement: ${order.status})`,
        rule: 'Flux: pending → confirmed → ordered'
      });
    }

    // 3. Check no existing parcel
    const { rows: existing } = await client.query(
      'SELECT id, reference FROM parcels WHERE order_id = $1', [order.id]
    );
    if (existing.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ 
        error: `Un colis existe déjà: ${existing[0].reference}` 
      });
    }

    // 4. Get order items
    const { rows: items } = await client.query(
      `SELECT oi.id, oi.product_id, oi.quantity, oi.price_kmf,
         p.name AS product_name, p.weight_kg AS product_weight
       FROM order_items oi
       LEFT JOIN products p ON p.id = oi.product_id
       WHERE oi.order_id = $1`, [order.id]
    );

    // 5. Generate parcel reference
    const year = new Date().getFullYear();
    const { rows: [{ max_seq }] } = await client.query(
      `SELECT COALESCE(MAX(CAST(SUBSTRING(reference FROM 'PCL-\\d{4}-(\\d+)') AS INT)), 0) AS max_seq
       FROM parcels WHERE reference LIKE $1`, [`PCL-${year}-%`]
    );
    const newSeq = (max_seq || 0) + 1;
    const parcelRef = `PCL-${year}-${String(newSeq).padStart(4, '0')}`;

    // 6. Compute weight
    const totalQty = items.reduce((s, i) => s + i.quantity, 0);
    const weightKg = items.reduce((s, i) => s + (Number(i.product_weight) || 0.5) * i.quantity, 0);

    // 7. Generate pickup code
    const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const pickupCode = Array.from({ length: 6 }, () => {
      let b; do { b = randomBytes(1)[0]; } while (b >= 216);
      return CHARS[b % 36];
    }).join('');

    // 8. Insert parcel (status = preparation)
    const parcelId = uuidv4();
    await client.query(
      `INSERT INTO parcels (
         id, order_id, reference, type, status, relais_id,
         weight_kg, destination_island, recipient_name, recipient_phone,
         items_count, total_qty, pickup_code, prepared_at
       ) VALUES (
         $1::uuid, $2::uuid, $3, 'standard', 'preparation', $4::uuid,
         $5, $6, $7, $8,
         $9, $10, $11, NOW()
       )`,
      [
        parcelId, order.id, parcelRef, order.relais_id,
        weightKg.toFixed(2), order.relais_island || order.destination_island || 'Comores',
        order.customer_name || 'Client', order.customer_phone || '',
        items.length, totalQty, pickupCode,
      ]
    );

    // 9. Insert parcel_items
    for (const item of items) {
      try {
        await client.query('SAVEPOINT sp_pi');
        await client.query(
          `INSERT INTO parcel_items (
             id, parcel_id, order_item_id, product_id, quantity,
             qty_allocated, qty_packed, qty_shipped, qty_received, qty_collected,
             verified, product_name
           ) VALUES (
             $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5,
             $6, $7, 0, 0, 0,
             false, $8
           )`,
          [uuidv4(), parcelId, item.id, item.product_id, item.quantity,
           item.quantity, item.quantity, item.product_name]
        );
        await client.query('RELEASE SAVEPOINT sp_pi');
      } catch(_) { await client.query('ROLLBACK TO SAVEPOINT sp_pi'); }
    }

    // 10. Insert initial scan event
    try {
      await client.query('SAVEPOINT sp_scan');
      await client.query(
        `INSERT INTO scan_events (
           id, parcel_id, order_id, event_type,
           scan_code, scanned_by, actor_name, actor_role,
           location, notes, status, created_at
         ) VALUES (
           $1::uuid, $2::uuid, $3::uuid, 'preparation',
           $4, $5::uuid, $6, $7,
           'Hub', $8, 'applied', NOW()
         )`,
        [uuidv4(), parcelId, order.id, parcelRef,
         req.user?.id || null, req.user?.full_name || 'Admin CT',
         req.user?.role === 'agent_hub' ? 'hub_agent' : 'system',
         `Colis ${parcelRef} créé pour ${order.reference}`]
      );
      await client.query('RELEASE SAVEPOINT sp_scan');
    } catch(_) { await client.query('ROLLBACK TO SAVEPOINT sp_scan'); }

    // 11. Update order status → ORDERED ✅
    await client.query(
      `UPDATE orders SET status = 'ordered', ordered_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [order.id]
    );

    // Log status change
    try {
      await client.query('SAVEPOINT sp_osh2');
      await client.query(
        `INSERT INTO order_status_history (order_id, status, note, changed_by)
         VALUES ($1::uuid, 'ordered', 'Colis créé — commande passée en "ordered"', $2::uuid)`,
        [order.id, req.user?.id || null]
      );
      await client.query('RELEASE SAVEPOINT sp_osh2');
    } catch(_) { await client.query('ROLLBACK TO SAVEPOINT sp_osh2'); }

    await client.query('COMMIT');

    console.log(`📦 Parcel created: ${parcelRef} for ${order.reference} — status → ordered`);

    // ── NOTIFICATIONS (fire-and-forget) ──
    const notifSvc = require('../services/notification-service');
    notifSvc.notifyParcelCreated(parcelRef, order.id, order.reference)
      .catch(e => console.error('[CREATE-NOTIF] ❌', e.message));

    res.json({
      success: true,
      message: `📦 Colis ${parcelRef} créé — Commande ${order.reference} passée en "ordered"`,
      parcel: {
        id: parcelId,
        reference: parcelRef,
        status: 'preparation',
        pickup_code: pickupCode,
        order_ref: order.reference,
        order_status: 'ordered',
        customer_name: order.customer_name,
        destination_island: order.relais_island || order.destination_island,
        nb_items: items.length,
        total_qty: totalQty,
        weight_kg: Number(weightKg.toFixed(2)),
      }
    });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

module.exports = router;
