/**
 * @komerce-arch
 * @role          ops-api
 * @domain        operations
 * @layer         route
 * @criticality   medium
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db.js, middleware/auth.js, services/incident-write-service.js, services/*
 * @used-by       bootstrap/api-routes.js
 * @db-read       incidents, invoices, order_items, orders, parcel_items, parcels, products, relais, scan_events, users
 * @db-write-via:incident-write-service incidents
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  operations
 * @version       2026-06
 */


'use strict';
// routes/ops-api.js — v2.2 — Fix: reconciliation alias + cash_relais enum — Endpoints opérationnels pour Control Tower
// RequÀªte directement la DB — pas de dépendance aux services v2
const express = require('express');
const router = express.Router();
const pool = require('../db');
const { resolveOpsIncident } = require('../services/incident-write-service');
const { authenticate, requireRole } = require('../middleware/auth');
const log = require('../utils/logger').child({ module: 'ops-api' });

router.use(authenticate, requireRole(['admin', 'agent_hub', 'agent_relais']));

// ——— GET /api/v2/global —————————————————————————————————————————————
// Dashboard summary — all KPIs in one call
router.get('/global', async (req, res, next) => {
  try {
    // Orders summary
    const { rows: orderStats } = await pool.query(`
      SELECT 
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status NOT IN ('collected','cancelled','refunded'))::int AS active,
        json_object_agg(status, cnt) AS by_status
      FROM (SELECT status, COUNT(*)::int AS cnt FROM orders GROUP BY status) sub
      CROSS JOIN (SELECT COUNT(*)::int AS total, 
        COUNT(*) FILTER (WHERE status NOT IN ('collected','cancelled','refunded'))::int AS active 
        FROM orders) totals
    `);
    
    // Simpler approach
    const { rows: oByStatus } = await pool.query(`
      SELECT status, COUNT(*)::int AS count FROM orders GROUP BY status ORDER BY status
    `);
    const { rows: [oTotals] } = await pool.query(`
      SELECT 
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status NOT IN ('collected','cancelled','refunded'))::int AS active
      FROM orders
    `);
    
    // Parcels summary
    let parcelData = { total: 0, by_status: {} };
    try {
      const { rows: pByStatus } = await pool.query(`
        SELECT status, COUNT(*)::int AS count FROM parcels GROUP BY status ORDER BY status
      `);
      const pTotal = pByStatus.reduce((s, r) => s + r.count, 0);
      parcelData = { total: pTotal, by_status: Object.fromEntries(pByStatus.map(r => [r.status, r.count])) };
    } catch(_) {}
    
    // Finance
    const { rows: [finance] } = await pool.query(`
      SELECT 
        COALESCE(SUM(total_kmf), 0)::int AS ca_total_kmf,
        COUNT(*) FILTER (WHERE payment_mode = 'cash_relais' AND payment_status = 'pending' AND status NOT IN ('cancelled','refunded'))::int AS cash_pending,
        COUNT(*) FILTER (WHERE payment_status = 'paid')::int AS paid
      FROM orders
    `);
    
    // Incidents
    let incidentData = { total: 0, open: 0, resolved: 0 };
    try {
      const { rows: [inc] } = await pool.query(`
        SELECT 
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE status = 'open')::int AS open,
          COUNT(*) FILTER (WHERE status = 'resolved')::int AS resolved
        FROM incidents
      `);
      incidentData = inc;
    } catch(_) {}
    
    // Alerts count (reuse logic from /alerts)
    let alertCount = { total: 0, critical: 0, high: 0 };
    try {
      const { rows: [sla] } = await pool.query(`
        SELECT COUNT(*)::int AS c FROM orders 
        WHERE status NOT IN ('cancelled','collected','refunded') 
        AND created_at < NOW() - INTERVAL '21 days'
      `);
      const { rows: [cash] } = await pool.query(`
        SELECT COUNT(*)::int AS c FROM orders 
        WHERE payment_mode = 'cash_relais' AND payment_status = 'pending' 
        AND status NOT IN ('cancelled','collected') 
        AND created_at < NOW() - INTERVAL '72 hours'
      `);
      const { rows: [stuck] } = await pool.query(`
        SELECT COUNT(*)::int AS c FROM parcels 
        WHERE status NOT IN ('collected','cancelled','draft') 
        AND updated_at < NOW() - INTERVAL '7 days'
      `);
      alertCount = {
        total: (sla?.c || 0) + (cash?.c || 0) + (stuck?.c || 0),
        critical: sla?.c || 0,
        high: cash?.c || 0,
        medium: stuck?.c || 0
      };
    } catch(_) {}
    
    res.json({
      orders: {
        total: oTotals.total,
        active: oTotals.active,
        by_status: Object.fromEntries(oByStatus.map(r => [r.status, r.count]))
      },
      parcels: parcelData,
      finance,
      incidents: incidentData,
      alerts: alertCount
    });
  } catch (err) {
    next(err);
  }
});

// ——— GET /api/v2/incidents ——————————————————————————————————————————
router.get('/incidents', async (req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT 
        i.id, i.incident_type, i.severity, i.status, i.title, i.description,
        i.details, i.client_impact, i.client_notified, i.detected_source,
        i.resolution, i.resolution_type, i.resolved_at,
        i.created_at, i.updated_at,
        p.reference AS parcel_reference, p.status AS parcel_status,
        o.reference AS order_reference,
        u_client.full_name AS client_name, u_client.phone AS client_phone,
        u_detected.full_name AS detected_by_name,
        u_resolved.full_name AS resolved_by_name
      FROM incidents i
      LEFT JOIN parcels p ON i.parcel_id = p.id
      LEFT JOIN orders o ON i.order_id = o.id
      LEFT JOIN users u_client ON o.user_id = u_client.id
      LEFT JOIN users u_detected ON i.detected_by = u_detected.id
      LEFT JOIN users u_resolved ON i.resolved_by = u_resolved.id
      ORDER BY 
        CASE i.severity 
          WHEN 'critical' THEN 0 WHEN 'high' THEN 1 
          WHEN 'medium' THEN 2 ELSE 3 
        END,
        i.created_at DESC
    `);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// ——— GET /api/v2/reconciliation/summary —————————————————————————————
const reconciliationHandler = async (req, res, next) => {
  try {
    // Reconciliation based on parcel_items.verified status
    const { rows: summary } = await pool.query(`
      SELECT 
        COUNT(DISTINCT p.id) AS total_parcels,
        COUNT(DISTINCT p.id) FILTER (
          WHERE NOT EXISTS (
            SELECT 1 FROM parcel_items pi WHERE pi.parcel_id = p.id AND pi.verified = false
          ) AND EXISTS (
            SELECT 1 FROM parcel_items pi2 WHERE pi2.parcel_id = p.id
          )
        ) AS reconciled,
        COUNT(DISTINCT p.id) FILTER (
          WHERE EXISTS (
            SELECT 1 FROM parcel_items pi WHERE pi.parcel_id = p.id AND pi.verified = false
          )
        ) AS pending,
        COUNT(DISTINCT p.id) FILTER (
          WHERE EXISTS (
            SELECT 1 FROM incidents inc WHERE inc.parcel_id = p.id AND inc.status = 'open'
          )
        ) AS anomalies
      FROM parcels p
      WHERE p.status NOT IN ('draft', 'cancelled')
    `);

    const s = summary[0] || {};

    // Details: parcels with their verification info
    const { rows: parcels } = await pool.query(`
      SELECT 
        p.id, p.reference, p.status, p.weight_kg,
        p.created_at, p.shipped_at, p.arrived_at,
        o.reference AS order_reference,
        r.name AS relay_name,
        COALESCE(pi_stats.total_items, 0) AS total_items,
        COALESCE(pi_stats.verified_items, 0) AS verified_items,
        CASE 
          WHEN pi_stats.total_items = 0 THEN 'no_items'
          WHEN pi_stats.verified_items = pi_stats.total_items THEN 'verified'
          WHEN pi_stats.verified_items > 0 THEN 'partial'
          ELSE 'pending'
        END AS verification_status
      FROM parcels p
      LEFT JOIN orders o ON p.order_id = o.id
      LEFT JOIN relais r ON p.relais_id = r.id
      LEFT JOIN LATERAL (
        SELECT 
          COUNT(*) AS total_items,
          COUNT(*) FILTER (WHERE verified = true) AS verified_items
        FROM parcel_items WHERE parcel_id = p.id
      ) pi_stats ON true
      WHERE p.status NOT IN ('draft', 'cancelled')
      ORDER BY p.created_at DESC
      LIMIT 100
    `);

    res.json({
      summary: {
        total_parcels: parseInt(s.total_parcels) || 0,
        reconciled: parseInt(s.reconciled) || 0,
        pending: parseInt(s.pending) || 0,
        anomalies: parseInt(s.anomalies) || 0,
        rate: s.total_parcels > 0 
          ? Math.round((parseInt(s.reconciled) / parseInt(s.total_parcels)) * 100) 
          : 0
      },
      parcels
    });
  } catch (err) {
    next(err);
  }
};

// Register reconciliation on both paths (frontend uses /reconciliation)
router.get('/reconciliation', reconciliationHandler);
router.get('/reconciliation/summary', reconciliationHandler);

// ——— GET /api/v2/alerts —————————————————————————————————————————————
// Auto-generated alerts from business rules
router.get('/alerts', async (req, res, next) => {
  try {
    const alerts = [];

    // 1. Cash orders pending > 72h
    const { rows: cashAlerts } = await pool.query(`
      SELECT o.id, o.reference, o.total_kmf, o.created_at,
             u.full_name AS customer_name,
             r.name AS relay_name,
             EXTRACT(EPOCH FROM (NOW() - o.created_at)) / 3600 AS hours_pending
      FROM orders o
      LEFT JOIN users u ON o.user_id = u.id
      LEFT JOIN relais r ON o.relais_id = r.id
      WHERE o.payment_mode = 'cash_relais' 
        AND o.payment_status = 'pending'
        AND o.status NOT IN ('cancelled', 'collected')
        AND o.created_at < NOW() - INTERVAL '72 hours'
      ORDER BY o.created_at ASC
    `);
    cashAlerts.forEach(o => alerts.push({
      id: `cash-${o.id}`,
      type: 'cash_pending',
      severity: 'high',
      message: `💵 Paiement cash en attente depuis ${Math.round(o.hours_pending)}h — ${o.reference}`,
      order_reference: o.reference,
      customer: o.customer_name,
      relay: o.relay_name,
      amount_kmf: o.total_kmf,
      created_at: o.created_at
    }));

    // 2. Stuck parcels > 7 days in same status
    const { rows: stuckAlerts } = await pool.query(`
      SELECT p.id, p.reference, p.status, p.updated_at,
             o.reference AS order_reference,
             u.full_name AS customer_name, u.phone AS customer_phone,
             EXTRACT(EPOCH FROM (NOW() - p.updated_at)) / 86400 AS days_stuck
      FROM parcels p
      LEFT JOIN orders o ON p.order_id = o.id
      LEFT JOIN users u ON o.user_id = u.id
      WHERE p.status NOT IN ('collected', 'cancelled', 'draft')
        AND p.updated_at < NOW() - INTERVAL '7 days'
      ORDER BY p.updated_at ASC
    `);
    stuckAlerts.forEach(p => alerts.push({
      id: `stuck-${p.id}`,
      type: 'stuck_parcel',
      severity: 'medium',
      message: `📦 Colis bloqué depuis ${Math.round(p.days_stuck)}j en statut "${p.status}" — ${p.reference}`,
      parcel_reference: p.reference,
      order_reference: p.order_reference,
      customer: p.customer_name, customer_phone: p.customer_phone,
      status: p.status,
      days_stuck: Math.round(p.days_stuck),
      created_at: p.updated_at
    }));

    // 3. SLA breach > 21 days (order created — collected)
    const { rows: slaAlerts } = await pool.query(`
      SELECT o.id, o.reference, o.status, o.created_at, o.total_kmf,
             u.full_name AS customer_name,
             EXTRACT(EPOCH FROM (NOW() - o.created_at)) / 86400 AS days_elapsed
      FROM orders o
      LEFT JOIN users u ON o.user_id = u.id
      WHERE o.status NOT IN ('cancelled', 'collected')
        AND o.created_at < NOW() - INTERVAL '21 days'
      ORDER BY o.created_at ASC
    `);
    slaAlerts.forEach(o => alerts.push({
      id: `sla-${o.id}`,
      type: 'sla_breach',
      severity: 'critical',
      message: `🚨 SLA dépassé (${Math.round(o.days_elapsed)}j) — ${o.reference} (${o.customer_name || 'Client inconnu'})`,
      order_reference: o.reference,
      customer: o.customer_name,
      days_elapsed: Math.round(o.days_elapsed),
      amount_kmf: o.total_kmf,
      created_at: o.created_at
    }));

    // 4. Weight anomalies (incidents of type weight_mismatch still open)
    const { rows: weightAlerts } = await pool.query(`
      SELECT i.id, i.title, i.description, i.details, i.created_at,
             p.reference AS parcel_reference,
             u.full_name AS customer_name, u.phone AS customer_phone, o.reference AS order_reference
      FROM incidents i
      LEFT JOIN parcels p ON i.parcel_id = p.id
      LEFT JOIN orders o ON p.order_id = o.id
      LEFT JOIN users u ON o.user_id = u.id
      WHERE i.incident_type = 'weight_mismatch' AND i.status = 'open'
      ORDER BY i.created_at DESC
    `);
    weightAlerts.forEach(i => alerts.push({
      id: `weight-${i.id}`,
      type: 'weight_anomaly',
      severity: 'medium',
message: `⚠️ Anomalie poids — ${i.parcel_reference}: ${i.title}`,
      parcel_reference: i.parcel_reference,
      customer: i.customer_name, customer_phone: i.customer_phone, order_reference: i.order_reference,
      details: i.details,
      created_at: i.created_at
    }));

    // Sort by severity
    const sevOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    alerts.sort((a, b) => (sevOrder[a.severity] ?? 9) - (sevOrder[b.severity] ?? 9));

    res.json(alerts);
  } catch (err) {
    next(err);
  }
});

// ——— POST /api/v2/alerts/:id/acknowledge ————————————————————————————
router.post('/alerts/:id/acknowledge', async (req, res, next) => {
  try {
    // For incident-based alerts, mark as resolved
    const alertId = req.params.id;
    
    if (alertId.startsWith('weight-')) {
      const incidentId = alertId.replace('weight-', '');
      await resolveOpsIncident(pool, {
        incidentId,
        resolution: JSON.stringify({
          type: 'acknowledged',
          note: 'Acquitte via Control Tower',
        }),
      });
    }
    
    res.json({ success: true, message: 'Alerte acquittée' });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/v2/parcels/:ref/detail ────────────────────────────────
// Combined drill-down: parcel + scans + orders+items in one call
// Accepts UUID or reference (PCL-2026-xxxx)
router.get('/parcels/:ref/detail', async (req, res, next) => {
  try {
    const ref = req.params.ref;
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ref);
    const whereClause = isUUID ? 'p.id = $1' : 'p.reference = $1';

    // 1. Get parcel
    const { rows: parcelRows } = await pool.query(`
      SELECT 
        p.*,
        o.reference AS order_reference, o.status AS order_status,
        o.total_kmf, o.payment_mode, o.payment_status,
        u.full_name AS customer_name, u.phone AS customer_phone,
        r.name AS relay_name, r.island AS relay_island
      FROM parcels p
      LEFT JOIN orders o ON p.order_id = o.id
      LEFT JOIN users u ON o.user_id = u.id
      LEFT JOIN relais r ON p.relais_id = r.id
      WHERE ${whereClause}
    `, [ref]);

    if (!parcelRows.length) return res.status(404).json({ error: 'Colis non trouvé' });
    const parcel = parcelRows[0];

    // 2. Get scan events
    const { rows: scans } = await pool.query(`
      SELECT 
        se.id, se.event_type, se.scan_code, se.actor_name, se.actor_role,
        se.location, se.notes, se.status, se.created_at,
        u.full_name AS scanned_by_name
      FROM scan_events se
      LEFT JOIN users u ON se.scanned_by = u.id
      WHERE se.parcel_id = $1
      ORDER BY se.created_at ASC
    `, [parcel.id]);

    // 3. Get linked orders with items
    const { rows: orders } = await pool.query(`
      SELECT 
        o.id, o.reference, o.status, o.total_kmf, o.payment_mode, o.payment_status,
        o.created_at, o.shipped_at, o.available_at, o.collected_at,
        u.full_name AS customer_name,
        r.name AS relay_name
      FROM orders o
      LEFT JOIN users u ON o.user_id = u.id
      LEFT JOIN relais r ON o.relais_id = r.id
      WHERE o.id = $1
    `, [parcel.order_id]);

    for (const order of orders) {
      const { rows: items } = await pool.query(`
        SELECT 
          oi.id, oi.quantity, oi.price_kmf, oi.scan_code,
          pr.name AS product_name, pr.sku,
          pi.quantity AS parcel_qty, pi.qty_packed, pi.qty_shipped, 
          pi.qty_received, pi.qty_collected, pi.verified
        FROM order_items oi
        LEFT JOIN products pr ON oi.product_id = pr.id
        LEFT JOIN parcel_items pi ON pi.order_item_id = oi.id AND pi.parcel_id = $1
        WHERE oi.order_id = $2
        ORDER BY oi.created_at ASC
      `, [parcel.id, order.id]);
      order.items = items;
    }

    res.json({ parcel, scans, orders });
  } catch (err) {
    next(err);
  }
});

// NOTE gouvernance (resolu 2026-07-06) : GET /parcels/:id etait mort -- code
// jamais atteint. parcel-api-v2 est monte en premier (/api/v2/parcels,
// bootstrap/api-routes.js) et sa route GET /:ref (routes/parcel-api-v2/read.js)
// capte toujours la requete avant celle-ci. Supprime. Voir
// features/logistics.feature.js et features/platform-ops.feature.js.
// ——— GET /api/v2/parcels/:id/scans ——————————————————————————————————
router.get('/parcels/:id/scans', async (req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT 
        se.id, se.event_type, se.scan_code, se.actor_name, se.actor_role,
        se.location, se.notes, se.metadata, se.status,
        se.qty_before, se.qty_after,
        se.created_at,
        u.full_name AS scanned_by_name
      FROM scan_events se
      LEFT JOIN users u ON se.scanned_by = u.id
      WHERE se.parcel_id = $1
      ORDER BY se.created_at ASC
    `, [req.params.id]);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// ——— GET /api/v2/parcels/:id/orders —————————————————————————————————
// Returns orders linked to this parcel + their items (for drill-down accordion)
router.get('/parcels/:id/orders', async (req, res, next) => {
  try {
    // Get the order linked to this parcel
    const { rows: parcels } = await pool.query(
      `SELECT order_id FROM parcels WHERE id = $1`, [req.params.id]
    );
    if (!parcels.length) return res.json([]);

    const orderId = parcels[0].order_id;

    const { rows: orders } = await pool.query(`
      SELECT 
        o.id, o.reference, o.status, o.total_kmf, o.payment_mode, o.payment_status,
        o.created_at, o.shipped_at, o.available_at, o.collected_at,
        u.full_name AS customer_name,
        r.name AS relay_name
      FROM orders o
      LEFT JOIN users u ON o.user_id = u.id
      LEFT JOIN relais r ON o.relais_id = r.id
      WHERE o.id = $1
    `, [orderId]);

    // Get items for the order
    for (const order of orders) {
      const { rows: items } = await pool.query(`
        SELECT 
          oi.id, oi.quantity, oi.price_kmf, oi.scan_code,
          p.name AS product_name, p.sku,
          pi.quantity AS parcel_qty, pi.qty_packed, pi.qty_shipped, 
          pi.qty_received, pi.qty_collected, pi.verified
        FROM order_items oi
        LEFT JOIN products p ON oi.product_id = p.id
        LEFT JOIN parcel_items pi ON pi.order_item_id = oi.id AND pi.parcel_id = $1
        WHERE oi.order_id = $2
        ORDER BY oi.created_at ASC
      `, [req.params.id, order.id]);
      order.items = items;
    }

    res.json(orders);
  } catch (err) {
    next(err);
  }
});


// ——— GET /api/v2/invoices ———————————————————————————————————————————
// List all invoices with order + client info
router.get('/invoices', async (req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT 
        inv.id, inv.invoice_number, inv.order_id, inv.parcel_id,
        inv.client_name, inv.client_phone, inv.relay_name,
        inv.items_snapshot, inv.subtotal_kmf, inv.shipping_kmf, inv.total_kmf,
        inv.payment_mode, inv.payment_status,
        inv.delivered_via, inv.delivered_at, inv.created_at,
        o.reference AS order_reference, o.status AS order_status,
        p.reference AS parcel_reference
      FROM invoices inv
      LEFT JOIN orders o ON inv.order_id = o.id
      LEFT JOIN parcels p ON inv.parcel_id = p.id
      ORDER BY inv.created_at DESC
      LIMIT 200
    `);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// ——— GET /api/v2/scan-events ————————————————————————————————————————
// List recent scan events across all parcels
router.get('/scan-events', async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    const { rows } = await pool.query(`
      SELECT 
        se.id, se.event_type, se.scan_code, se.actor_name, se.actor_role,
        se.location, se.notes, se.status, se.created_at,
        p.reference AS parcel_reference, p.status AS parcel_status,
        o.reference AS order_reference,
        u.full_name AS scanned_by_name
      FROM scan_events se
      LEFT JOIN parcels p ON se.parcel_id = p.id
      LEFT JOIN orders o ON se.order_id = o.id
      LEFT JOIN users u ON se.scanned_by = u.id
      ORDER BY se.created_at DESC
      LIMIT $1
    `, [limit]);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// NOTE gouvernance (resolu 2026-07-06) : GET /parcels etait mort -- code
// jamais atteint. parcel-api-v2 est monte en premier (/api/v2/parcels,
// bootstrap/api-routes.js) et sa route GET / (routes/parcel-api-v2/read.js)
// capte toujours la requete avant celle-ci. Supprime. Voir
// features/logistics.feature.js et features/platform-ops.feature.js.

module.exports = router;
