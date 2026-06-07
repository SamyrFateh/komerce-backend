/**
 * â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
 * ORDER API v2.3 â€" Komerce (COLIS-FIRST) â€" AUTO-PARCEL
 * â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
 * 
 * FLUX CORRECT:
 *   pending â†' confirmed â†' ordered â†' preparation â†' shipped â†' in_transit â†' available â†' collected
 *
 * âœ… v2.3: Auto-create parcel on payment confirmation (cash + stripe)
 *
 * Endpoints opÃ©rationnels pour la Control Tower:
 *   GET  /api/v2/orders                     â†' Liste complÃ¨te + KPIs
 *   GET  /api/v2/orders/pending-cash        â†' Commandes cash en attente
 *   GET  /api/v2/orders/ready-for-parcel    â†' Commandes CONFIRMÃ‰ES sans colis
 *   POST /api/v2/orders/:ref/confirm-cash   â†' Confirmer paiement cash + FACTURE + AUTO-PARCEL
 *   POST /api/v2/orders/:ref/create-parcel  â†' CrÃ©er colis manuellement (fallback)
 * â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
 */

const express = require('express');
const router = express.Router();
const { randomBytes, randomUUID } = require('crypto');
const db = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const { transitionOrderStatus } = require('../services/order-status-machine');
const log = require('../utils/logger').child({ module: 'order-api-v2' });

const guard = [authenticate, requireRole(['admin', 'agent_hub', 'agent_relais'])];

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// SHARED: Auto-create parcel for a confirmed+paid order
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

async function autoCreateParcel(client, orderId, actor) {
  // 1. Load order
  const { rows: [order] } = await client.query(
    `SELECT o.id, o.reference, o.status, o.payment_status, o.payment_mode,
       o.total_kmf, o.user_id, o.relais_id, o.destination_island,
       u.full_name AS customer_name, u.phone AS customer_phone,
       r.name AS relais_name, r.island AS relais_island
     FROM orders o
     LEFT JOIN users u ON u.id = o.user_id
     LEFT JOIN relais r ON r.id = o.relais_id
     WHERE o.id = $1`, [orderId]
  );
  if (!order) return { success: false, reason: 'order_not_found' };

  // 2. Skip if not paid
  if (order.payment_status !== 'paid') {
    return { success: false, reason: 'not_paid' };
  }

  // 3. Skip if already has parcel
  const { rows: existing } = await client.query(
    'SELECT id, reference FROM parcels WHERE order_id = $1', [orderId]
  );
  if (existing.length > 0) {
    return { success: false, reason: 'parcel_exists', parcel_ref: existing[0].reference };
  }

  // 4. Get order items
  const { rows: items } = await client.query(
    `SELECT oi.id, oi.product_id, oi.quantity, oi.price_kmf,
       p.name AS product_name, p.weight_kg AS product_weight
     FROM order_items oi
     LEFT JOIN products p ON p.id = oi.product_id
     WHERE oi.order_id = $1`, [orderId]
  );
  if (!items.length) return { success: false, reason: 'no_items' };

  // 5. Generate parcel reference
  const year = new Date().getFullYear();
  const { rows: [{ max_seq }] } = await client.query(
    `SELECT COALESCE(MAX(CAST(SUBSTRING(reference FROM 'PCL-\\d{4}-(\\d+)') AS INT)), 0) AS max_seq
     FROM parcels WHERE reference LIKE $1`, [`PCL-${year}-%`]
  );
  const newSeq = (max_seq || 0) + 1;
  const parcelRef = `PCL-${year}-${String(newSeq).padStart(4, '0')}`;

  // 6. Compute weight + totals
  const totalQty = items.reduce((s, i) => s + i.quantity, 0);
  const weightKg = items.reduce((s, i) => s + (Number(i.product_weight) || 0.5) * i.quantity, 0);

  // 7. Generate pickup code
  const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const pickupCode = Array.from({ length: 6 }, () => {
    let b; do { b = randomBytes(1)[0]; } while (b >= 216);
    return CHARS[b % 36];
  }).join('');

  // 8. Insert parcel
  const parcelId = randomUUID();
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
      parcelId, orderId, parcelRef, order.relais_id,
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
        [randomUUID(), parcelId, item.id, item.product_id, item.quantity,
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
      [randomUUID(), parcelId, orderId, parcelRef,
       actor.id || null, actor.name || 'SystÃ¨me',
       actor.role === 'agent_hub' ? 'hub_agent' : 'system',
       `Colis ${parcelRef} auto-crÃ©Ã© pour ${order.reference}`]
    );
    await client.query('RELEASE SAVEPOINT sp_scan');
  } catch(_) { await client.query('ROLLBACK TO SAVEPOINT sp_scan'); }

  // 11. Transition order: confirmed â†' ordered â†' preparation
  if (order.status === 'confirmed') {
    await transitionOrderStatus({
      orderId, newStatus: 'ordered',
      actor: { id: actor.id, role: actor.role || 'system' },
      source: 'auto_parcel', note: 'Auto: colis crÃ©Ã© â†' ordered',
      dbClient: client,
    }).catch(() => {});
  }

  await transitionOrderStatus({
    orderId, newStatus: 'preparation',
    actor: { id: actor.id, role: actor.role || 'system' },
    source: 'auto_parcel', note: `Auto: colis ${parcelRef} â†' prÃ©paration`,
    dbClient: client,
  }).catch(() => {});

  log.info(`ðŸ"¦ AUTO-PARCEL: ${parcelRef} created for ${order.reference}`);

  return {
    success: true,
    parcel: {
      id: parcelId, reference: parcelRef, status: 'preparation',
      pickup_code: pickupCode, order_ref: order.reference,
      nb_items: items.length, total_qty: totalQty,
      weight_kg: Number(weightKg.toFixed(2)),
    }
  };
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// 0. GET / â€" Liste complÃ¨te de toutes les commandes + KPIs
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

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

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// 1. GET /pending-cash â€" Commandes cash_relais en attente
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

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

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// 2. GET /ready-for-parcel â€" Commandes CONFIRMÃ‰ES sans colis
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

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

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// 1b. GET /:ref â€" DÃ©tail complet d'une commande
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

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

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// 3. POST /:ref/confirm-cash â€" Confirmer paiement cash relais
//    â†' AUTO-PARCEL: crÃ©e automatiquement le colis aprÃ¨s confirmation
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

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
      return res.status(400).json({ error: 'Paiement dÃ©jÃ  confirmÃ©' });
    }

    // Update payment fields
    await client.query(
      `UPDATE orders SET payment_status = 'paid',
         cash_paid_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [order.id]
    );

    // Transition status â†' confirmed
    const _confirmResult = await transitionOrderStatus({
      orderId: order.id,
      newStatus: 'confirmed',
      actor: { id: req.user?.id || null, role: req.user?.role || 'system' },
      source: 'cash_confirm',
      note: 'Paiement cash confirmÃ© par agent',
      dbClient: client,
    });
    if (!_confirmResult.success) {
      log.warn(`[ORDER-V2] transitionOrderStatus confirm failed for ${order.id}: ${_confirmResult.error}`);
    }

    // âœ… AUTO-PARCEL: create parcel automatically after payment confirmation
    const actor = {
      id: req.user?.id || null,
      name: req.user?.full_name || 'Admin CT',
      role: req.user?.role || 'system',
    };
    const parcelResult = await autoCreateParcel(client, order.id, actor);

    await client.query('COMMIT');

    log.info(`ðŸ'° Cash confirmed + auto-parcel: ${order.reference} by ${req.user?.email || 'system'}`);

    // NOTIFICATIONS (fire-and-forget)
    const notif = require('../services/notification-service');
    notif.notifyPaymentConfirmed(order.id, order.reference)
      .then(result => {
        if (result?.invoice) {
          log.info(`ðŸ§¾ Invoice ${result.invoice} sent for ${order.reference}`);
        }
      })
      .catch(e => log.error({ err: e }, '[CONFIRM-NOTIF] âŒ'));

    if (parcelResult.success) {
      const notifSvc = require('../services/notification-service');
      notifSvc.notifyParcelCreated(parcelResult.parcel.reference, order.id, order.reference)
        .catch(e => log.error({ err: e }, '[AUTO-PARCEL-NOTIF] âŒ'));
    }

    res.json({
      success: true,
      message: parcelResult.success
        ? `âœ… Paiement confirmÃ© + ðŸ"¦ Colis ${parcelResult.parcel.reference} crÃ©Ã© automatiquement`
        : `âœ… Paiement confirmÃ© pour ${order.reference} â€" Facture envoyÃ©e par WhatsApp`,
      order: {
        reference: order.reference,
        old_status: order.status,
        new_status: parcelResult.success ? 'preparation' : 'confirmed',
        payment_status: 'paid',
        total_kmf: Number(order.total_kmf),
        customer_name: order.customer_name,
        customer_phone: order.customer_phone,
      },
      parcel: parcelResult.success ? parcelResult.parcel : null,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// 4. POST /:ref/create-parcel â€" CrÃ©er colis manuellement (fallback)
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

router.post('/:ref/create-parcel', ...guard, async (req, res, next) => {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const { ref } = req.params;

    // Find order
    const { rows: [order] } = await client.query(
      `SELECT o.id, o.reference, o.status, o.payment_status
       FROM orders o WHERE o.reference = $1 OR o.id::text = $1`, [ref]
    );

    if (!order) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: `Commande ${ref} introuvable` });
    }
    if (order.payment_status !== 'paid') {
      await client.query('ROLLBACK');
      return res.status(400).json({ 
        error: 'Paiement non confirmÃ© â€" impossible de crÃ©er un colis',
        rule: 'PAS DE PAIEMENT = PAS DE COLIS'
      });
    }
    if (!['confirmed', 'ordered'].includes(order.status)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ 
        error: `La commande doit Ãªtre en statut "confirmed" ou "ordered" (actuellement: ${order.status})`,
      });
    }

    const actor = {
      id: req.user?.id || null,
      name: req.user?.full_name || 'Admin CT',
      role: req.user?.role || 'system',
    };

    const result = await autoCreateParcel(client, order.id, actor);

    if (!result.success) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `CrÃ©ation impossible: ${result.reason}` });
    }

    await client.query('COMMIT');

    log.info(`ðŸ"¦ Manual parcel created: ${result.parcel.reference} for ${order.reference}`);

    // NOTIFICATIONS (fire-and-forget)
    const notifSvc = require('../services/notification-service');
    notifSvc.notifyParcelCreated(result.parcel.reference, order.id, order.reference)
      .catch(e => log.error({ err: e }, '[CREATE-NOTIF] âŒ'));

    res.json({
      success: true,
      message: `ðŸ"¦ Colis ${result.parcel.reference} crÃ©Ã© â€" Commande ${order.reference} en prÃ©paration`,
      parcel: result.parcel,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

module.exports = router;
