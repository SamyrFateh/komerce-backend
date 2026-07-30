/**
 * @komerce-arch
 * @role          orders-order-api-v2
 * @domain        orders
 * @layer         route
 * @criticality   critical
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db.js, middleware/auth.js, services/*
 * @used-by       bootstrap/api-routes.js
 * @db-read       order_items, orders, parcel_items, parcels, products, relais, users
 * @db-write      none
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  orders, checkout
 * @version       2026-06
 */


'use strict';
/**
 * ═══════════════════════════════════════════════════════════════
 * ORDER API v2.3 — Komerce (COLIS-FIRST) — AUTO-PARCEL
 * ═══════════════════════════════════════════════════════════════
 * 
 * FLUX CORRECT:
 *   pending → confirmed → ordered → preparation → shipped → in_transit → available → collected
 *
 * ✅ v2.3: Auto-create parcel on payment confirmation (cash + stripe)
 *
 * Endpoints opérationnels pour la Control Tower:
 *   GET  /api/v2/orders                     → Liste complète + KPIs
 *   GET  /api/v2/orders/pending-cash        → Commandes cash en attente
 *   GET  /api/v2/orders/ready-for-parcel    → Commandes CONFIRMÉES sans colis
 *   POST /api/v2/orders/:ref/confirm-cash   → Confirmer paiement cash + FACTURE + AUTO-PARCEL
 *   POST /api/v2/orders/:ref/create-parcel  → Créer colis manuellement (fallback)
 * ═══════════════════════════════════════════════════════════════
 */

const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const { confirmCashAndCreateParcel, createParcelManually } = require('../services/parcel-auto-create-service');
const { cacheCodeForReveal } = require('../services/pickup-secret-service');
const log = require('../utils/logger').child({ module: 'order-api-v2' });

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

// ═══════════════════════════════════════════════════════════════
// 1. GET /pending-cash — Commandes cash_relais en attente
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
//    → AUTO-PARCEL: crée automatiquement le colis après confirmation
// ═══════════════════════════════════════════════════════════════

router.post('/:ref/confirm-cash', ...guard, async (req, res, next) => {
  try {
    const actor = {
      id:        req.user?.id        || null,
      role:      req.user?.role      || 'system',
      full_name: req.user?.full_name || 'Admin CT',
      email:     req.user?.email,
    };
    const { order, parcelResult, pickupCodeToCache } = await confirmCashAndCreateParcel(req.params.ref, actor);

    log.info(`💰 Cash confirmed + auto-parcel: ${order.reference} by ${actor.email || 'system'}`);

    if (pickupCodeToCache) {
      cacheCodeForReveal(order.id, pickupCodeToCache)
        .catch(e => log.error({ err: e }, '[CONFIRM-CASH] cacheCodeForReveal error:'));
    }

    // Notifications (fire-and-forget)
    const notif = require('../services/notification-service');
    notif.notifyPaymentConfirmed(order.id, order.reference)
      .then(r => { if (r?.invoice) log.info(`🧾 Invoice ${r.invoice} sent for ${order.reference}`); })
      .catch(e => log.error({ err: e }, '[CONFIRM-NOTIF]'));
    // O7.2 (Cycle A) : lien facture désormais construit/envoyé par orders lui-même.
    require('../services/invoice-service').sendInvoiceReadyNotification(order.id, order.reference)
      .catch(e => log.error({ err: e }, '[CONFIRM-INVOICE-NOTIF]'));

    if (parcelResult.success) {
      notif.notifyParcelCreated(parcelResult.parcel.reference, order.id, order.reference)
        .catch(e => log.error({ err: e }, '[AUTO-PARCEL-NOTIF]'));
    }

    res.json({
      success: true,
      message: parcelResult.success
        ? `✅ Paiement confirmé + 📦 Colis ${parcelResult.parcel.reference} créé automatiquement`
        : `✅ Paiement confirmé pour ${order.reference} — Facture envoyée par WhatsApp`,
      order: {
        reference:      order.reference,
        old_status:     order.status,
        new_status:     parcelResult.success ? 'preparation' : 'confirmed',
        payment_status: 'paid',
        total_kmf:      Number(order.total_kmf),
        customer_name:  order.customer_name,
        customer_phone: order.customer_phone,
      },
      parcel: parcelResult.success ? parcelResult.parcel : null,
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

// ═══════════════════════════════════════════════════════════════
// 4. POST /:ref/create-parcel — Créer colis manuellement (fallback)
// ═══════════════════════════════════════════════════════════════

router.post('/:ref/create-parcel', ...guard, async (req, res, next) => {
  try {
    const actor = {
      id:   req.user?.id        || null,
      name: req.user?.full_name || 'Admin CT',
      role: req.user?.role      || 'system',
    };
    const { order, parcel } = await createParcelManually(req.params.ref, actor);

    log.info(`📦 Manual parcel created: ${parcel.reference} for ${order.reference}`);

    const notifSvc = require('../services/notification-service');
    notifSvc.notifyParcelCreated(parcel.reference, order.id, order.reference)
      .catch(e => log.error({ err: e }, '[CREATE-NOTIF]'));

    res.json({
      success: true,
      message: `📦 Colis ${parcel.reference} créé — Commande ${order.reference} en préparation`,
      parcel,
    });
  } catch (err) {
    const e = {};
    if (err.status) { e.error = err.message; if (err.rule) e.rule = err.rule; return res.status(err.status).json(e); }
    next(err);
  }
});

module.exports = router;
