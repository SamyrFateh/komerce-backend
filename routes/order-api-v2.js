/**
 * ═══════════════════════════════════════════════════════════════
 * ORDER API v2.2 — Komerce (COLIS-FIRST) — Flux corrigé + Liste complète
 * ═══════════════════════════════════════════════════════════════
 * 
 * FLUX CORRECT:
 *   pending → confirmed → ordered → preparation → shipped → in_transit → available → collected
 *
 * Endpoints opérationnels pour la Control Tower:
 *   GET  /api/v2/orders                     → Liste complète + KPIs
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
const { transitionOrderStatus } = require('../services/order-status-machine');

const guard = [authenticate, requireRole(['admin', 'agent_hub', 'agent_relais'])];

// ═══════════════════════════════════════════════════════════════
// 0. GET / — Liste complète de toutes les commandes + KPIs
// ═══════════════════════════════════════════════════════════════

router.get('/', ...guard, async (req, res, next) => {
  try {
    const { status, payment_mode, payment_status, search, limit = 100, offset = 0 } = req.query;

    let conditions = [];
    let params = [];
    let idx = 1;

    if (status) {
      conditions.push(`o.status = $${idx++}`);
      params.push(status);
    }
    if (payment_mode) {
      conditions.push(`o.payment_mode = $${idx++}`);
      params.push(payment_mode);
    }
    if (payment_status) {
      conditions.push(`o.payment_status = $${idx++}`);
      params.push(payment_status);
    }
    if (search) {
      conditions.push(`(o.reference ILIKE $${idx} OR u.full_name ILIKE $${idx})`);
      params.push(`%${search}%`);
      idx++;
    }

    const whereClause = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

    // KPIs (always unfiltered for global overview)
    const { rows: [kpis] } = await db.query(`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
        COUNT(*) FILTER (WHERE status = 'confirmed')::int AS confirmed,
        COUNT(*) FILTER (WHERE status = 'ordered')::int AS ordered,
        COUNT(*) FILTER (WHERE status = 'preparation')::int AS preparation,
        COUNT(*) FILTER (WHERE status = 'shipped')::int AS shipped,
        COUNT(*) FILTER (WHERE status = 'in_transit')::int AS in_transit,
        COUNT(*) FILTER (WHERE status = 'available')::int AS available,
        COUNT(*) FILTER (WHERE status = 'collected')::int AS collected,
        COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelled,
        COUNT(*) FILTER (WHERE status = 'refunded')::int AS refunded,
        COUNT(*) FILTER (WHERE payment_status = 'paid')::int AS paid,
        COUNT(*) FILTER (WHERE payment_status = 'pending')::int AS payment_pending,
        COUNT(*) FILTER (WHERE payment_status = 'failed')::int AS payment_failed,
        COUNT(*) FILTER (WHERE payment_status = 'refunded')::int AS payment_refunded,
        COUNT(*) FILTER (WHERE payment_mode = 'stripe_eur')::int AS stripe_count,
        COUNT(*) FILTER (WHERE payment_mode = 'cash_relais')::int AS cash_count,
        COALESCE(SUM(total_kmf) FILTER (WHERE status NOT IN ('cancelled','refunded')), 0)::int AS ca_total_kmf,
        COALESCE(SUM(total_eur) FILTER (WHERE status NOT IN ('cancelled','refunded')), 0)::numeric(10,2) AS ca_total_eur,
        COALESCE(SUM(total_kmf) FILTER (WHERE payment_status = 'paid' AND payment_mode = 'stripe_eur'), 0)::int AS ca_stripe_kmf,
        COALESCE(SUM(total_kmf) FILTER (WHERE payment_status = 'paid' AND payment_mode = 'cash_relais'), 0)::int AS ca_cash_kmf,
        COUNT(*) FILTER (WHERE payment_status = 'paid')::int AS total_paid
      FROM orders
    `);

    // Orders list with filters
    const { rows } = await db.query(`
      SELECT o.id, o.reference, o.status, o.total_kmf, o.total_eur,
        o.payment_mode, o.payment_status,
        o.created_at, o.updated_at, o.destination_island,
        u.full_name AS customer_name, u.phone AS customer_phone, u.email AS customer_email,
        r.name AS relais_name, r.island AS relais_island,
        (SELECT COUNT(*)::int FROM order_items WHERE order_id = o.id) AS nb_items,
        (SELECT SUM(quantity)::int FROM order_items WHERE order_id = o.id) AS total_qty,
        EXISTS(SELECT 1 FROM parcels p WHERE p.order_id = o.id) AS has_parcel,
        (SELECT p.reference FROM parcels p WHERE p.order_id = o.id LIMIT 1) AS parcel_ref
      FROM orders o
      LEFT JOIN users u ON u.id = o.user_id
      LEFT JOIN relais r ON r.id = o.relais_id
      ${whereClause}
      ORDER BY o.created_at DESC
      LIMIT $${idx++} OFFSET $${idx++}
    `, [...params, parseInt(limit), parseInt(offset)]);

    res.json({ kpis, count: rows.length, orders: rows });
  } catch (err) { next(err); }
});

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
        AND o.status IN ('confirmed', 'ordered')
        AND NOT EXISTS (SELECT 1 FROM parcels p WHERE p.order_id = o.id)
      ORDER BY o.created_at ASC
    `);
    res.json({ count: rows.length, orders: rows });
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════════
// 1b. GET /:ref — Détail complet d'une commande
//     ⚠️ Pas de colonnes optionnelles (confirmed_at, shipped_at, etc.)
//        car elles n'existent pas forcément dans tous les envts.
// ═══════════════════════════════════════════════════════════════

router.get('/:ref', ...guard, async (req, res, next) => {
  try {
    const { ref } = req.params;

    const { rows: [order] } = await db.query(`
      SELECT o.id, o.reference, o.status, o.total_kmf, o.total_eur,
        o.payment_mode, o.payment_status, o.cash_ref_code,
        o.created_at, o.updated_at, o.destination_island,
        u.full_name AS customer_name, u.phone AS local_phone, u.email AS customer_email,
        r.name AS relais_name, r.island AS relais_island,
        (SELECT p.reference FROM parcels p WHERE p.order_id = o.id LIMIT 1) AS parcel_ref,
        (SELECT p.status FROM parcels p WHERE p.order_id = o.id LIMIT 1) AS parcel_status,
        (SELECT p.pickup_code FROM parcels p WHERE p.order_id = o.id LIMIT 1) AS pickup_code,
        EXISTS(SELECT 1 FROM parcels p WHERE p.order_id = o.id) AS has_parcel
      FROM orders o
      LEFT JOIN users u ON u.id = o.user_id
      LEFT JOIN relais r ON r.id = o.relais_id
      WHERE o.reference = $1 OR o.id::text = $1
    `, [ref]);

    if (!order) {
      return res.status(404).json({ error: 'Commande ' + ref + ' introuvable' });
    }

    // Get items
    const { rows: items } = await db.query(`
      SELECT oi.id, oi.product_id, oi.quantity, oi.price_kmf AS unit_price_kmf,
        p.name AS product_name, p.image_url,
        (SELECT pi.id FROM parcel_items pi WHERE pi.order_item_id = oi.id LIMIT 1) IS NOT NULL AS in_parcel,
        (SELECT pcl.reference FROM parcel_items pi JOIN parcels pcl ON pcl.id = pi.parcel_id WHERE pi.order_item_id = oi.id LIMIT 1) AS parcel_ref
      FROM order_items oi
      LEFT JOIN products p ON p.id = oi.product_id
      WHERE oi.order_id = $1
      ORDER BY oi.created_at ASC
    `, [order.id]);

    order.items = items;

    res.json({ order });
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

    // ── Update payment fields (NOT status — handled by state machine) ──
    await client.query(
      `UPDATE orders SET payment_status = 'paid',
         cash_paid_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [order.id]
    );

    // ── Transition status via state machine ──
    const _confirmResult = await transitionOrderStatus({
      orderId: order.id,
      newStatus: 'confirmed',
      actor: { id: req.user?.id || null, role: req.user?.role || 'system' },
      source: 'cash_confirm',
      note: 'Paiement cash confirmé par agent',
      dbClient: client,
    });
    if (!_confirmResult.success) {
      console.warn(`[ORDER-V2] transitionOrderStatus confirm failed for ${order.id}: ${_confirmResult.error}`);
    }

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

    if (!['confirmed', 'ordered'].includes(order.status)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ 
        error: `La commande doit être en statut "confirmed" ou "ordered" (actuellement: ${order.status})`,
        rule: 'Flux: confirmed → ordered → preparation (via colis)'
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

    // 11. Transition order status via state machine ✅
    if (order.status === 'confirmed') {
      const _orderedResult = await transitionOrderStatus({
        orderId: order.id,
        newStatus: 'ordered',
        actor: { id: req.user?.id || null, role: req.user?.role || 'system' },
        source: 'hub_create_parcel',
        note: 'Colis créé — commande passée en "ordered"',
        dbClient: client,
      });
      if (!_orderedResult.success) {
        console.warn(`[ORDER-V2] transition → ordered failed: ${_orderedResult.error}`);
      }
    }

    const _prepResult = await transitionOrderStatus({
      orderId: order.id,
      newStatus: 'preparation',
      actor: { id: req.user?.id || null, role: req.user?.role || 'system' },
      source: 'hub_create_parcel',
      note: `Colis ${parcelRef} créé — préparation lancée`,
      dbClient: client,
    });
    if (!_prepResult.success) {
      console.warn(`[ORDER-V2] transition → preparation failed: ${_prepResult.error}`);
    }

    await client.query('COMMIT');

    console.log(`📦 Parcel created: ${parcelRef} for ${order.reference} — status → preparation`);

    // ── NOTIFICATIONS (fire-and-forget) ──
    const notifSvc = require('../services/notification-service');
    notifSvc.notifyParcelCreated(parcelRef, order.id, order.reference)
      .catch(e => console.error('[CREATE-NOTIF] ❌', e.message));

    res.json({
      success: true,
      message: `📦 Colis ${parcelRef} créé — Commande ${order.reference} en préparation`,
      parcel: {
        id: parcelId,
        reference: parcelRef,
        status: 'preparation',
        pickup_code: pickupCode,
        order_ref: order.reference,
        order_status: 'preparation',
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
