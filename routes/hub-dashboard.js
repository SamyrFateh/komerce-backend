/**
 * KOMERCE — Hub Dashboard API v1.0
 * Centre de contrôle opérateur hub (Dubai)
 *
 * GET  /dashboard       — KPIs temps réel
 * GET  /queue           — File de travail priorisée
 * GET  /orders/:id      — Détail complet commande + colis + paiement + client
 * GET  /validate/:id    — Validations anti-erreur avant action
 * POST /orders/:id/start-prep   — Démarrer préparation
 * POST /orders/:id/create-parcel — Créer colis (complet ou partiel)
 * POST /parcels/:id/add-item    — Ajouter article au colis
 * POST /parcels/:id/remove-item — Retirer article du colis
 * POST /parcels/:id/ready       — Marquer colis prêt
 * POST /parcels/:id/ship        — Expédier colis + transport
 * POST /orders/:id/incident     — Signaler incident
 * POST /orders/:id/escalate     — Escalader admin
 * POST /orders/:id/comment      — Commentaire terrain
 * POST /orders/:id/backorder    — Marquer en attente fournisseur
 */

'use strict';

const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const { safeSyncScanToParcels } = require('../utils/parcelSync');
const { generateParcelRef } = require('../utils/reference');
const { transitionOrderStatus } = require('../services/order-status-machine');
const log = require('../utils/logger').child({ module: 'hub-dashboard' });

const hubAuth = [authenticate, requireRole(['admin', 'agent_hub'])];

// ── Auto-create + migrate tables (handles both hub and relay schemas) ────────
(async () => {
  try {
    // Create tables if not exist
    await db.query(`
      CREATE TABLE IF NOT EXISTS order_incidents (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        reporter_id UUID REFERENCES users(id),
        reporter_name TEXT,
        type TEXT NOT NULL DEFAULT 'autre',
        description TEXT,
        priority TEXT DEFAULT 'normal',
        status TEXT DEFAULT 'open',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        resolved_at TIMESTAMPTZ,
        resolved_by UUID REFERENCES users(id),
        resolution_note TEXT
      );
      CREATE TABLE IF NOT EXISTS order_comments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        author_id UUID REFERENCES users(id),
        author_name TEXT,
        author_role TEXT,
        text TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_oi_order ON order_incidents(order_id);
      CREATE INDEX IF NOT EXISTS idx_oi_status ON order_incidents(status);
      CREATE INDEX IF NOT EXISTS idx_oc_order ON order_comments(order_id);
    `);
    // Migrate: if table was created with old hub schema (severity/reported_by/content)
    // Add missing columns defensively
    const migrations = [
      "ALTER TABLE order_incidents ADD COLUMN IF NOT EXISTS priority TEXT DEFAULT 'normal'",
      "ALTER TABLE order_incidents ADD COLUMN IF NOT EXISTS reporter_id UUID",
      "ALTER TABLE order_incidents ADD COLUMN IF NOT EXISTS reporter_name TEXT",
      "ALTER TABLE order_incidents ADD COLUMN IF NOT EXISTS resolution_note TEXT",
      "ALTER TABLE order_comments ADD COLUMN IF NOT EXISTS author_name TEXT",
      "ALTER TABLE order_comments ADD COLUMN IF NOT EXISTS author_role TEXT",
      "ALTER TABLE order_comments ADD COLUMN IF NOT EXISTS text TEXT DEFAULT ''",
    ];
    for (const m of migrations) {
      try { await db.query(m); } catch(e) { /* column may already exist */ }
    }
    log.info('[HUB-DASH] Tables + migrations OK');
  } catch(e) { log.warn('Hub-dash tables init (non-fatal):', e.message); }
})();

// ── GET /dashboard — KPIs Hub (défensif) ────────────────────────────────────
router.get('/dashboard', ...hubAuth, async (req, res, next) => {
  try {
    // Each query wrapped individually to isolate errors
    let ordersData = { to_prepare: 0, in_preparation: 0, shipped_today: 0, shipped_total: 0, urgent: 0, cash_pending: 0, pending: 0, total_active: 0, today: 0 };
    let parcelsData = { draft: 0, preparation: 0, shipped: 0, in_transit: 0, at_relay: 0 };
    let incidentsData = { open: 0, critical: 0 };
    let stockData = { low_stock_count: 0 };

    // 1. Orders KPIs
    try {
      const { rows: [r] } = await db.query(`
        SELECT
          COUNT(*) FILTER (WHERE status IN ('confirmed','ordered')) AS to_prepare,
          COUNT(*) FILTER (WHERE status = 'preparation') AS in_preparation,
          COUNT(*) FILTER (WHERE status = 'shipped' AND updated_at >= CURRENT_DATE) AS shipped_today,
          COUNT(*) FILTER (WHERE status = 'shipped') AS shipped_total,
          COUNT(*) FILTER (WHERE status IN ('confirmed','ordered')
            AND created_at < NOW() - INTERVAL '48 hours') AS urgent,
          COUNT(*) FILTER (WHERE payment_mode = 'cash_relais'
            AND payment_status != 'paid'
            AND status NOT IN ('cancelled','collected')) AS cash_pending,
          COUNT(*) FILTER (WHERE status = 'pending') AS pending,
          COUNT(*) AS total_active
        FROM orders
        WHERE status NOT IN ('cancelled','collected','pending')
      `);
      const { rows: [t] } = await db.query(`SELECT COUNT(*) AS c FROM orders WHERE created_at >= CURRENT_DATE`);
      ordersData = {
        to_prepare: parseInt(r.to_prepare) || 0,
        in_preparation: parseInt(r.in_preparation) || 0,
        shipped_today: parseInt(r.shipped_today) || 0,
        shipped_total: parseInt(r.shipped_total) || 0,
        urgent: parseInt(r.urgent) || 0,
        cash_pending: parseInt(r.cash_pending) || 0,
        pending: parseInt(r.pending) || 0,
        total_active: parseInt(r.total_active) || 0,
        today: parseInt(t.c) || 0
      };
    } catch(e) { log.error('[HUB-DASH] Orders KPI error:', e.message); }

    // 2. Parcels KPIs
    try {
      const { rows: [r] } = await db.query(`
        SELECT
          COUNT(*) FILTER (WHERE status = 'draft') AS draft,
          COUNT(*) FILTER (WHERE status = 'preparation') AS preparation,
          COUNT(*) FILTER (WHERE status = 'shipped') AS shipped,
          COUNT(*) FILTER (WHERE status = 'in_transit') AS in_transit,
          COUNT(*) FILTER (WHERE status = 'available') AS at_relay
        FROM parcels
      `);
      parcelsData = {
        draft: parseInt(r.draft) || 0,
        preparation: parseInt(r.preparation) || 0,
        shipped: parseInt(r.shipped) || 0,
        in_transit: parseInt(r.in_transit) || 0,
        at_relay: parseInt(r.at_relay) || 0
      };
    } catch(e) { log.error('[HUB-DASH] Parcels KPI error:', e.message); }

    // 3. Incidents
    try {
      const { rows: [r] } = await db.query(`
        SELECT
          COUNT(*) FILTER (WHERE status = 'open') AS open_count,
          COUNT(*) FILTER (WHERE status = 'open'
            AND (priority = 'urgent' OR priority = 'high')) AS critical_count
        FROM order_incidents
      `);
      incidentsData = {
        open: parseInt(r.open_count) || 0,
        critical: parseInt(r.critical_count) || 0
      };
    } catch(e) { log.error('[HUB-DASH] Incidents error:', e.message); }

    // 4. Stock alerts
    try {
      const { rows: [r] } = await db.query(`
        SELECT COUNT(*) AS c FROM products
        WHERE stock IS NOT NULL AND stock <= 2 AND stock >= 0
      `);
      stockData = { low_stock_count: parseInt(r.c) || 0 };
    } catch(e) { log.error('[HUB-DASH] Stock error:', e.message); }

    res.json({
      orders: ordersData,
      parcels: parcelsData,
      incidents: incidentsData,
      stock: stockData
    });
  } catch(e) { next(e); }
});

// ── GET /queue — File de travail priorisée ──────────────────────────────────
router.get('/queue', ...hubAuth, async (req, res, next) => {
  try {
    const { tab = 'to_prepare', search, page = 1, limit = 50 } = req.query;
    const safePage = Math.max(parseInt(page) || 1, 1);
    const safeLimit = Math.min(parseInt(limit) || 50, 100);
    const offset = (safePage - 1) * safeLimit;

    let statusFilter;
    switch(tab) {
      case 'to_prepare':   statusFilter = "('confirmed','ordered')"; break;
      case 'preparation':  statusFilter = "('preparation')"; break;
      case 'ready':        statusFilter = "('shipped')"; break;
      case 'blocked':      statusFilter = "('confirmed','ordered','preparation')"; break;
      case 'all':          statusFilter = "('confirmed','ordered','preparation','shipped','in_transit')"; break;
      default:             statusFilter = "('confirmed','ordered')";
    }

    let searchClause = '';
    const params = [];
    let idx = 1;

    if (search) {
      searchClause = `AND (o.reference ILIKE $${idx} OR u.full_name ILIKE $${idx} OR u.phone ILIKE $${idx})`;
      params.push(`%${search}%`);
      idx++;
    }

    // Blocked = has open incidents
    let blockedClause = '';
    if (tab === 'blocked') {
      blockedClause = `AND EXISTS (SELECT 1 FROM order_incidents oi WHERE oi.order_id = o.id AND oi.status = 'open')`;
    }

    const countQ = await db.query(`
      SELECT COUNT(*) FROM orders o
      LEFT JOIN users u ON u.id = o.user_id
      WHERE o.status IN ${statusFilter}
      ${searchClause} ${blockedClause}
    `, params);
    const total = parseInt(countQ.rows[0].count);

    const { rows } = await db.query(`
      SELECT
        o.id, o.reference, o.status, o.computed_status,
        o.payment_mode, o.payment_status, o.total_kmf,
        o.destination_island, o.routing_mode, o.transit_hub,
        o.created_at, o.updated_at,
        u.full_name AS client_name, u.phone AS client_phone, u.email AS client_email,
        r.name AS relais_name,
        -- Items count
        (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) AS items_count,
        -- Items total qty
        (SELECT COALESCE(SUM(oi.quantity), 0) FROM order_items oi WHERE oi.order_id = o.id) AS items_qty,
        -- Parcels count
        (SELECT COUNT(*) FROM parcels p WHERE p.order_id = o.id AND p.status != 'cancelled') AS parcels_count,
        -- Parcels items assigned
        (SELECT COUNT(*) FROM parcel_items pi
         JOIN parcels p ON p.id = pi.parcel_id
         WHERE p.order_id = o.id AND p.status != 'cancelled') AS items_assigned,
        -- Has open incidents
        (SELECT COUNT(*) FROM order_incidents inc WHERE inc.order_id = o.id AND inc.status = 'open') AS open_incidents,
        -- Age in hours
        EXTRACT(EPOCH FROM (NOW() - o.created_at)) / 3600 AS age_hours,
        -- Completeness
        CASE
          WHEN (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) = 0 THEN 'empty'
          WHEN (SELECT COUNT(*) FROM parcel_items pi
                JOIN parcels p ON p.id = pi.parcel_id
                WHERE p.order_id = o.id AND p.status != 'cancelled')
               >= (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id)
          THEN 'complete'
          WHEN (SELECT COUNT(*) FROM parcel_items pi
                JOIN parcels p ON p.id = pi.parcel_id
                WHERE p.order_id = o.id AND p.status != 'cancelled') > 0
          THEN 'partial'
          ELSE 'unassigned'
        END AS completeness
      FROM orders o
      LEFT JOIN users u ON u.id = o.user_id
      LEFT JOIN relais r ON r.id = o.relais_id
      WHERE o.status IN ${statusFilter}
      ${searchClause} ${blockedClause}
      ORDER BY
        -- Priority: oldest first, urgent first, paid first
        CASE WHEN o.created_at < NOW() - INTERVAL '48 hours' THEN 0 ELSE 1 END,
        CASE WHEN o.payment_status = 'paid' THEN 0 ELSE 1 END,
        o.created_at ASC
      LIMIT $${idx++} OFFSET $${idx++}
    `, [...params, safeLimit, offset]);

    res.json({
      data: rows,
      pagination: { page: safePage, limit: safeLimit, total, pages: Math.ceil(total / safeLimit) },
      tab
    });
  } catch(e) { next(e); }
});

// ── GET /orders/:id — Détail complet ────────────────────────────────────────
router.get('/orders/:id', ...hubAuth, async (req, res, next) => {
  try {
    const { rows: orderRows } = await db.query(`
      SELECT o.*,
             u.full_name AS client_name, u.phone AS client_phone, u.email AS client_email,
             r.name AS relais_name, r.address AS relais_address, r.phone AS relais_phone,
             r.island AS relais_island
      FROM orders o
      LEFT JOIN users u ON u.id = o.user_id
      LEFT JOIN relais r ON r.id = o.relais_id
      WHERE o.id = $1
    `, [req.params.id]);

    if (!orderRows.length) return res.status(404).json({ error: 'Commande introuvable' });
    const order = orderRows[0];

    // Items with product detail + stock check
    const { rows: items } = await db.query(`
      SELECT oi.id, oi.product_id, oi.quantity, oi.price_kmf,
             p.name AS product_name, p.image_url, p.stock,
             p.weight_kg AS unit_weight, p.category,
             CASE
               WHEN p.stock IS NULL THEN 'unknown'
               WHEN p.stock >= oi.quantity THEN 'ok'
               WHEN p.stock > 0 THEN 'partial'
               ELSE 'out_of_stock'
             END AS stock_status
      FROM order_items oi
      LEFT JOIN products p ON p.id = oi.product_id
      WHERE oi.order_id = $1
      ORDER BY oi.created_at ASC
    `, [order.id]);

    // Parcels with their items
    const { rows: parcels } = await db.query(`
      SELECT p.id, p.reference, p.external_code, p.status, p.type,
             p.weight_kg, p.notes, p.created_at, p.updated_at,
             p.shipped_at, p.prepared_at
      FROM parcels p
      WHERE p.order_id = $1 AND p.status != 'cancelled'
      ORDER BY p.created_at ASC
    `, [order.id]);

    for (const parcel of parcels) {
      const { rows: pItems } = await db.query(`
        SELECT pi.id, pi.order_item_id, pi.quantity, oi.price_kmf,
               pr.name AS product_name, pr.image_url
        FROM parcel_items pi
        LEFT JOIN order_items oi ON oi.id = pi.order_item_id
        LEFT JOIN products pr ON pr.id = oi.product_id
        WHERE pi.parcel_id = $1
      `, [parcel.id]);
      parcel.items = pItems;
    }

    // Timeline (scans)
    const { rows: timeline } = await db.query(`
      SELECT s.id, s.step, s.scanned_by, s.notes, s.created_at,
             u.full_name AS scanned_by_name
      FROM scans s
      LEFT JOIN users u ON u.id = s.scanned_by
      WHERE s.order_id = $1
      ORDER BY s.created_at ASC
    `, [order.id]);

    // Incidents
    const { rows: incidents } = await db.query(`
      SELECT i.*, u.full_name AS reporter_name
      FROM order_incidents i
      LEFT JOIN users u ON u.id = i.reporter_id
      WHERE i.order_id = $1
      ORDER BY i.created_at DESC
    `, [order.id]);

    // Comments
    const { rows: comments } = await db.query(`
      SELECT c.*, u.full_name AS author_name
      FROM order_comments c
      LEFT JOIN users u ON u.id = c.author_id
      WHERE c.order_id = $1
      ORDER BY c.created_at DESC
    `, [order.id]);

    // Client history
    let clientHistory = null;
    if (order.user_id) {
      const { rows: ch } = await db.query(`
        SELECT
          COUNT(*) AS total_orders,
          COUNT(*) FILTER (WHERE status = 'collected') AS completed,
          COUNT(*) FILTER (WHERE status = 'cancelled') AS cancelled,
          MIN(created_at) AS first_order
        FROM orders WHERE user_id = $1
      `, [order.user_id]);
      clientHistory = ch[0];
    }

    // Payment info
    const payment = {
      mode: order.payment_mode,
      paid: order.payment_status === 'paid',
      total_kmf: order.total_kmf,
      stripe_payment_id: order.stripe_payment_id || null,
      blocking: order.payment_mode === 'cash_relais' && !order.paid
    };

    res.json({
      ...order,
      items,
      parcels,
      timeline,
      incidents,
      comments,
      client_history: clientHistory,
      payment,
      meta: {
        items_count: items.length,
        items_total_qty: items.reduce((s, i) => s + i.quantity, 0),
        parcels_count: parcels.length,
        items_assigned: parcels.reduce((s, p) => s + p.items.length, 0),
        age_hours: Math.round((Date.now() - new Date(order.created_at).getTime()) / 3600000),
        has_stock_issue: items.some(i => i.stock_status === 'out_of_stock' || i.stock_status === 'partial'),
        all_items_assigned: parcels.reduce((s, p) => s + p.items.length, 0) >= items.length
      }
    });
  } catch(e) { next(e); }
});

// ── GET /validate/:id — Validations anti-erreur ────────────────────────────
router.get('/validate/:id', ...hubAuth, async (req, res, next) => {
  try {
    const { rows: orderRows } = await db.query(
      'SELECT id, status, payment_mode, payment_status, total_kmf FROM orders WHERE id = $1',
      [req.params.id]
    );
    if (!orderRows.length) return res.status(404).json({ error: 'Commande introuvable' });
    const order = orderRows[0];

    const errors = [];
    const warnings = [];

    // 1. Check items exist
    const { rows: [itemCount] } = await db.query(
      'SELECT COUNT(*) AS cnt FROM order_items WHERE order_id = $1', [order.id]
    );
    if (parseInt(itemCount.cnt) === 0) {
      errors.push({ code: 'NO_ITEMS', message: 'Commande sans articles' });
    }

    // 2. Check stock for each item
    const { rows: stockCheck } = await db.query(`
      SELECT oi.id, p.name, oi.quantity, p.stock,
        CASE
          WHEN p.stock IS NULL THEN 'unknown'
          WHEN p.stock >= oi.quantity THEN 'ok'
          WHEN p.stock > 0 THEN 'partial'
          ELSE 'rupture'
        END AS status
      FROM order_items oi
      LEFT JOIN products p ON p.id = oi.product_id
      WHERE oi.order_id = $1
    `, [order.id]);

    for (const item of stockCheck) {
      if (item.status === 'rupture') {
        errors.push({
          code: 'STOCK_RUPTURE',
          message: `Rupture stock: ${item.name} (demandé: ${item.quantity}, stock: ${item.stock})`,
          item_id: item.id
        });
      } else if (item.status === 'partial') {
        warnings.push({
          code: 'STOCK_PARTIAL',
          message: `Stock insuffisant: ${item.name} (demandé: ${item.quantity}, dispo: ${item.stock})`,
          item_id: item.id
        });
      }
    }

    // 3. Check payment for shipping
    if (order.payment_status !== 'paid' && order.payment_mode !== 'cash_relais') {
      warnings.push({ code: 'UNPAID', message: 'Commande non payée (paiement non cash)' });
    }

    // 4. Check parcels have destination
    const { rows: parcels } = await db.query(`
      SELECT p.id, p.reference, p.status,
        o.destination_island, o.relais_id
      FROM parcels p
      JOIN orders o ON o.id = p.order_id
      WHERE p.order_id = $1 AND p.status != 'cancelled'
    `, [order.id]);

    for (const p of parcels) {
      if (!p.destination_island && !p.relais_id) {
        errors.push({
          code: 'NO_DESTINATION',
          message: `Colis ${p.reference} sans destination`,
          parcel_id: p.id
        });
      }
    }

    // 5. Check all items are assigned to parcels
    const { rows: [assignedCount] } = await db.query(`
      SELECT COUNT(DISTINCT pi.order_item_id) AS cnt
      FROM parcel_items pi
      JOIN parcels p ON p.id = pi.parcel_id
      WHERE p.order_id = $1 AND p.status != 'cancelled'
    `, [order.id]);

    if (parseInt(assignedCount.cnt) < parseInt(itemCount.cnt)) {
      const missing = parseInt(itemCount.cnt) - parseInt(assignedCount.cnt);
      warnings.push({
        code: 'ITEMS_NOT_ASSIGNED',
        message: `${missing} article(s) non assigné(s) à un colis`
      });
    }

    // 6. Check for open incidents
    const { rows: [incCount] } = await db.query(
      "SELECT COUNT(*) AS cnt FROM order_incidents WHERE order_id = $1 AND status = 'open'",
      [order.id]
    );
    if (parseInt(incCount.cnt) > 0) {
      warnings.push({
        code: 'OPEN_INCIDENTS',
        message: `${incCount.cnt} incident(s) ouvert(s) sur cette commande`
      });
    }

    res.json({
      order_id: order.id,
      can_prepare: errors.length === 0,
      can_ship: errors.length === 0 && !warnings.some(w => w.code === 'ITEMS_NOT_ASSIGNED'),
      errors,
      warnings,
      checks_passed: errors.length === 0 && warnings.length === 0
    });
  } catch(e) { next(e); }
});

// ── POST /orders/:id/start-prep — Démarrer préparation ─────────────────────
router.post('/orders/:id/start-prep', ...hubAuth, async (req, res, next) => {
  try {
    const { rows } = await db.query(
      "SELECT id, status, reference FROM orders WHERE id = $1",
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Commande introuvable' });
    const order = rows[0];

    if (!['confirmed', 'ordered'].includes(order.status)) {
      return res.status(400).json({
        error: `Impossible de préparer — statut actuel: ${order.status}`,
        hint: 'La commande doit être confirmée ou commandée'
      });
    }

    // Transition via state machine
    const _prepResult = await transitionOrderStatus({
      orderId: order.id,
      newStatus: 'preparation',
      actor: { id: req.user?.id || null, role: req.user?.role || 'system' },
      source: 'hub_start_prep',
    });
    if (!_prepResult.success) {
      log.warn(`[HUB] transitionOrderStatus failed for ${order.id}: ${_prepResult.error}`);
    }

    // Log scan
    await db.query(`
      INSERT INTO scans (order_id, step, scanned_by, notes)
      VALUES ($1, 'preparation', $2, $3)
    `, [order.id, req.user.id, `Préparation démarrée par ${req.user.full_name || 'hub'}`]);

    // Log comment
    await db.query(`
      INSERT INTO order_comments (order_id, author_id, author_name, text)
      VALUES ($1, $2, 'Hub', 'Préparation démarrée')
    `, [order.id, req.user.id]);

    res.json({ message: `Commande ${order.reference} en préparation`, status: 'preparation' });
  } catch(e) { next(e); }
});

// ── POST /orders/:id/create-parcel — Créer colis ───────────────────────────
router.post('/orders/:id/create-parcel', ...hubAuth, async (req, res, next) => {
  try {
    const { type = 'standard', notes, item_ids } = req.body;
    const { rows } = await db.query('SELECT id, reference FROM orders WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Commande introuvable' });
    const order = rows[0];

    const reference = await generateParcelRef(db);

    // Generate security codes if available
    let external_code = null, seal_code = null;
    try {
      const security = require('../services/parcel-security');
      external_code = security.generateExternalCode();
      seal_code = security.generateSealCode();
    } catch(e) { /* security module not critical */ }

    const insertQ = external_code
      ? `INSERT INTO parcels (reference, external_code, seal_code, order_id, type, notes, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'draft') RETURNING *`
      : `INSERT INTO parcels (reference, order_id, type, notes, status)
         VALUES ($1, $2, $3, $4, 'draft') RETURNING *`;

    const insertParams = external_code
      ? [reference, external_code, seal_code, order.id, type, notes || null]
      : [reference, order.id, type, notes || null];

    const { rows: [parcel] } = await db.query(insertQ, insertParams);

    // Auto-assign items if provided
    if (item_ids && item_ids.length) {
      for (const itemId of item_ids) {
        await db.query(`
          INSERT INTO parcel_items (parcel_id, order_item_id, quantity)
          SELECT $1, oi.id, oi.quantity
          FROM order_items oi WHERE oi.id = $2 AND oi.order_id = $3
          ON CONFLICT DO NOTHING
        `, [parcel.id, itemId, order.id]).catch(() => {});
      }
    }

    // Log
    await db.query(`
      INSERT INTO order_comments (order_id, author_id, author_name, text)
      VALUES ($1, $2, 'Hub', $3)
    `, [order.id, req.user.id, `Colis ${reference} créé (${type})`]);

    res.status(201).json({
      message: `Colis ${reference} créé`,
      parcel,
      items_assigned: item_ids ? item_ids.length : 0
    });
  } catch(e) { next(e); }
});

// ── POST /orders/:id/auto-prepare — Auto-split + assign articles (R2 compliant) ──
// Crée automatiquement un colis et assigne tous les articles non-assignés.
// Déclenché sur premier scan QR d'une commande. L'opérateur ne décide rien.
router.post('/orders/:id/auto-prepare', ...hubAuth, async (req, res, next) => {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    // Lock la commande
    const { rows: [order] } = await client.query(
      `SELECT id, reference, status FROM orders WHERE id = $1 FOR UPDATE`,
      [req.params.id]
    );
    if (!order) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Commande introuvable' }); }

    if (!['confirmed', 'ordered', 'preparation'].includes(order.status)) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: `Auto-prepare impossible — statut: ${order.status}`,
        hint: 'La commande doit être confirmée, commandée ou en préparation'
      });
    }

    // Articles non encore assignés à un colis actif
    const { rows: unassigned } = await client.query(`
      SELECT oi.id, oi.quantity, oi.product_id, p.name AS product_name, p.weight_kg
      FROM order_items oi
      LEFT JOIN products p ON p.id = oi.product_id
      WHERE oi.order_id = $1
        AND NOT EXISTS (
          SELECT 1 FROM parcel_items pi
          JOIN parcels pa ON pa.id = pi.parcel_id AND pa.status != 'cancelled'
          WHERE pi.order_item_id = oi.id
        )
      ORDER BY oi.created_at ASC
    `, [order.id]);

    if (unassigned.length === 0) {
      await client.query('ROLLBACK');
      return res.json({
        message: 'Tous les articles sont déjà assignés à un colis',
        already_complete: true
      });
    }

    // Passer en preparation si besoin
    if (['confirmed', 'ordered'].includes(order.status)) {
      await transitionOrderStatus({
        orderId: order.id,
        newStatus: 'preparation',
        actor: { id: req.user?.id || null, role: req.user?.role || 'system' },
        source: 'hub_auto_prepare',
        dbClient: client,
      });
    }

    // Créer un colis unique pour tous les articles non-assignés
    const reference = await generateParcelRef(client);

    let external_code = null, seal_code = null;
    try {
      const security = require('../services/parcel-security');
      external_code = security.generateExternalCode();
      seal_code = security.generateSealCode();
    } catch(e) { /* non-critique */ }

    const insertQ = external_code
      ? `INSERT INTO parcels (reference, external_code, seal_code, order_id, type, status, notes)
         VALUES ($1, $2, $3, $4, 'standard', 'draft', $5) RETURNING *`
      : `INSERT INTO parcels (reference, order_id, type, status, notes)
         VALUES ($1, $2, 'standard', 'draft', $3) RETURNING *`;

    const insertParams = external_code
      ? [reference, external_code, seal_code, order.id, `Auto-créé sur scan QR — ${unassigned.length} article(s)`]
      : [reference, order.id, `Auto-créé sur scan QR — ${unassigned.length} article(s)`];

    const { rows: [parcel] } = await client.query(insertQ, insertParams);

    // Assigner tous les articles non-assignés
    for (const item of unassigned) {
      await client.query(`
        INSERT INTO parcel_items (parcel_id, order_item_id, quantity)
        VALUES ($1, $2, $3)
        ON CONFLICT DO NOTHING
      `, [parcel.id, item.id, item.quantity]);
    }

    // Poids estimé total
    const totalWeight = unassigned.reduce((s, i) => s + ((i.weight_kg || 0.5) * i.quantity), 0);
    await client.query(
      'UPDATE parcels SET weight_kg = $1 WHERE id = $2',
      [Math.round(totalWeight * 100) / 100, parcel.id]
    );

    // Log scan + commentaire
    try {
      await client.query(`
        INSERT INTO scans (order_id, step, scanned_by, notes)
        VALUES ($1, 'preparation', $2, $3)
      `, [order.id, req.user.id, `Auto-prepare: colis ${reference} créé, ${unassigned.length} article(s) assigné(s)`]);
    } catch(e) { /* scans table peut varier */ }

    await client.query(`
      INSERT INTO order_comments (order_id, author_id, author_name, text)
      VALUES ($1, $2, 'Hub', $3)
    `, [order.id, req.user.id, `📦 Auto-prepare: colis ${reference} créé (${unassigned.length} article(s))`]);

    await client.query('COMMIT');

    // Fetch colis complet post-commit
    const { rows: [fullParcel] } = await db.query('SELECT * FROM parcels WHERE id = $1', [parcel.id]);

    res.status(201).json({
      message: `Colis ${reference} créé automatiquement — ${unassigned.length} article(s) assigné(s)`,
      parcel: fullParcel,
      items_assigned: unassigned.length,
      items: unassigned.map(i => ({ id: i.id, product_name: i.product_name, quantity: i.quantity })),
      next_action: 'ready', // l'opérateur n'a plus qu'à marquer prêt
    });
  } catch(e) {
    await client.query('ROLLBACK').catch(() => {});
    next(e);
  } finally {
    client.release();
  }
});

// ── POST /parcels/:id/add-item — Ajouter article ───────────────────────────
router.post('/parcels/:id/add-item', ...hubAuth, async (req, res, next) => {
  try {
    const { order_item_id, quantity } = req.body;
    if (!order_item_id) return res.status(400).json({ error: 'order_item_id requis' });

    const { rows: [parcel] } = await db.query(
      'SELECT id, order_id, reference FROM parcels WHERE id = $1', [req.params.id]
    );
    if (!parcel) return res.status(404).json({ error: 'Colis introuvable' });

    // Verify item belongs to same order
    const { rows: [item] } = await db.query(
      'SELECT id, quantity FROM order_items WHERE id = $1 AND order_id = $2',
      [order_item_id, parcel.order_id]
    );
    if (!item) return res.status(400).json({ error: "Article n'appartient pas à cette commande" });

    const qty = quantity || item.quantity;

    const { rows: [pi] } = await db.query(`
      INSERT INTO parcel_items (parcel_id, order_item_id, quantity)
      VALUES ($1, $2, $3)
      ON CONFLICT DO NOTHING
      RETURNING *
    `, [parcel.id, order_item_id, qty]);

    res.json({ message: 'Article ajouté', item: pi || { already_assigned: true } });
  } catch(e) { next(e); }
});

// ── POST /parcels/:id/remove-item — Retirer article ────────────────────────
router.post('/parcels/:id/remove-item', ...hubAuth, async (req, res, next) => {
  try {
    const { order_item_id } = req.body;
    if (!order_item_id) return res.status(400).json({ error: 'order_item_id requis' });

    const { rows } = await db.query(
      'DELETE FROM parcel_items WHERE parcel_id = $1 AND order_item_id = $2 RETURNING *',
      [req.params.id, order_item_id]
    );

    if (!rows.length) return res.status(404).json({ error: 'Article non trouvé dans ce colis' });
    res.json({ message: 'Article retiré', deleted: rows[0] });
  } catch(e) { next(e); }
});

// ── POST /parcels/:id/ready — Marquer prêt ─────────────────────────────────
router.post('/parcels/:id/ready', ...hubAuth, async (req, res, next) => {
  try {
    const { rows: [parcel] } = await db.query(
      "SELECT id, order_id, reference, status FROM parcels WHERE id = $1",
      [req.params.id]
    );
    if (!parcel) return res.status(404).json({ error: 'Colis introuvable' });

    // Anti-error: check items assigned
    const { rows: [itemCheck] } = await db.query(
      'SELECT COUNT(*) AS cnt FROM parcel_items WHERE parcel_id = $1',
      [parcel.id]
    );
    if (parseInt(itemCheck.cnt) === 0) {
      return res.status(400).json({
        error: 'Impossible — colis vide',
        hint: 'Ajoutez des articles avant de marquer prêt'
      });
    }

    // Update parcel
    await db.query(`
      UPDATE parcels SET status = 'preparation', prepared_at = NOW(), updated_at = NOW()
      WHERE id = $1
    `, [parcel.id]);

    // Log
    await db.query(`
      INSERT INTO order_comments (order_id, author_id, author_name, text)
      VALUES ($1, $2, 'Hub', $3)
    `, [parcel.order_id, req.user.id, `Colis ${parcel.reference} prêt à expédier`]);

    res.json({ message: `Colis ${parcel.reference} prêt`, status: 'preparation' });
  } catch(e) { next(e); }
});

// ── POST /parcels/:id/ship — Expédier ──────────────────────────────────────
router.post('/parcels/:id/ship', ...hubAuth, async (req, res, next) => {
  try {
    const { transport, batch_id, notes } = req.body;

    const { rows: [parcel] } = await db.query(
      "SELECT id, order_id, reference, status FROM parcels WHERE id = $1",
      [req.params.id]
    );
    if (!parcel) return res.status(404).json({ error: 'Colis introuvable' });

    // Anti-error: check parcel is ready
    const { rows: [itemCheck] } = await db.query(
      'SELECT COUNT(*) AS cnt FROM parcel_items WHERE parcel_id = $1',
      [parcel.id]
    );
    if (parseInt(itemCheck.cnt) === 0) {
      return res.status(400).json({
        error: 'Impossible — colis vide',
        hint: 'Ajoutez des articles et marquez prêt avant expédition'
      });
    }

    // Anti-error: check order payment for non-cash
    const { rows: [order] } = await db.query(
      'SELECT payment_mode, payment_status, reference FROM orders WHERE id = $1',
      [parcel.order_id]
    );
    if (order.payment_status !== 'paid' && order.payment_mode !== 'cash_relais') {
      return res.status(400).json({
        error: `⚠️ Commande ${order.reference} non payée`,
        hint: 'Vérifiez le paiement avant expédition'
      });
    }

    // Sync via parcelSync (handles order status cascade)
    await safeSyncScanToParcels({
      order_id: parcel.order_id,
      step: 'shipped',
      scan_id: null,
      scanned_by: req.user.id,
      notes: notes || `Expédié par hub — transport: ${transport || 'non spécifié'}`
    });

    // Update parcel with transport info
    await db.query(`
      UPDATE parcels SET
        shipped_at = NOW(),
        notes = COALESCE(notes, '') || $1,
        updated_at = NOW()
      WHERE id = $2
    `, [
      `\n[SHIPPED] ${new Date().toISOString()} | transport: ${transport || '-'} | batch: ${batch_id || '-'}`,
      parcel.id
    ]);

    // Log
    await db.query(`
      INSERT INTO order_comments (order_id, author_id, author_name, text)
      VALUES ($1, $2, 'Hub', $3)
    `, [parcel.order_id, req.user.id,
       `Colis ${parcel.reference} expédié — ${transport || 'transport non précisé'}`]);

    res.json({
      message: `Colis ${parcel.reference} expédié ✈️`,
      status: 'shipped',
      transport: transport || null
    });
  } catch(e) { next(e); }
});

// ── POST /orders/:id/incident — Signaler incident ──────────────────────────
router.post('/orders/:id/incident', ...hubAuth, async (req, res, next) => {
  try {
    const { type, description, priority = 'normal' } = req.body;
    if (!type || !description) {
      return res.status(400).json({ error: 'type et description requis' });
    }

    const validTypes = ['retard', 'blocage', 'paiement', 'stock', 'colis_endommage', 'colis_perdu', 'client_absent', 'autre'];
    if (!validTypes.includes(type)) {
      return res.status(400).json({ error: `Type invalide. Valides: ${validTypes.join(', ')}` });
    }

    const { rows: [order] } = await db.query('SELECT id FROM orders WHERE id = $1', [req.params.id]);
    if (!order) return res.status(404).json({ error: 'Commande introuvable' });

    const { rows: [incident] } = await db.query(`
      INSERT INTO order_incidents (order_id, type, description, priority, reporter_id)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [order.id, type, description, priority, req.user.id]);

    // Auto-comment
    await db.query(`
      INSERT INTO order_comments (order_id, author_id, author_name, text)
      VALUES ($1, $2, 'Hub', $3)
    `, [order.id, req.user.id, `🚨 Incident ${type}: ${description}`]);

    res.status(201).json({ message: 'Incident signalé', incident });
  } catch(e) { next(e); }
});

// ── POST /orders/:id/escalate — Escalader ──────────────────────────────────
router.post('/orders/:id/escalate', ...hubAuth, async (req, res, next) => {
  try {
    const { reason, priority = 'high' } = req.body;
    if (!reason) return res.status(400).json({ error: 'Raison requise' });

    const { rows: [order] } = await db.query(
      'SELECT id, reference FROM orders WHERE id = $1', [req.params.id]
    );
    if (!order) return res.status(404).json({ error: 'Commande introuvable' });

    // Create critical incident
    const { rows: [incident] } = await db.query(`
      INSERT INTO order_incidents (order_id, type, description, priority, reporter_id)
      VALUES ($1, 'autre', $2, 'urgent', $3)
      RETURNING *
    `, [order.id, `[ESCALADE] ${reason}`, req.user.id]);

    // Log comment
    await db.query(`
      INSERT INTO order_comments (order_id, author_id, author_name, text)
      VALUES ($1, $2, 'Hub', $3)
    `, [order.id, req.user.id, `⚠️ ESCALADE: ${reason}`]);

    res.status(201).json({
      message: `Commande ${order.reference} escaladée`,
      incident,
      priority
    });
  } catch(e) { next(e); }
});

// ── POST /orders/:id/comment — Commentaire terrain ─────────────────────────
router.post('/orders/:id/comment', ...hubAuth, async (req, res, next) => {
  try {
    const { content } = req.body;
    if (!content) return res.status(400).json({ error: 'Contenu requis' });

    const { rows: [order] } = await db.query('SELECT id FROM orders WHERE id = $1', [req.params.id]);
    if (!order) return res.status(404).json({ error: 'Commande introuvable' });

    const { rows: [comment] } = await db.query(`
      INSERT INTO order_comments (order_id, author_id, author_name, text)
      VALUES ($1, $2, 'Hub', $3)
      RETURNING *
    `, [order.id, req.user.id, req.body.content]);

    res.json({ message: 'Commentaire ajouté', comment });
  } catch(e) { next(e); }
});

// ── POST /orders/:id/backorder — Marquer en attente fournisseur ─────────────
router.post('/orders/:id/backorder', ...hubAuth, async (req, res, next) => {
  try {
    const { reason, items_waiting } = req.body;

    const { rows: [order] } = await db.query(
      'SELECT id, reference FROM orders WHERE id = $1', [req.params.id]
    );
    if (!order) return res.status(404).json({ error: 'Commande introuvable' });

    // Create incident
    await db.query(`
      INSERT INTO order_incidents (order_id, type, description, priority, reporter_id)
      VALUES ($1, 'backorder', $2, 'medium', $3)
    `, [order.id, reason || 'En attente fournisseur', req.user.id]);

    // Log
    await db.query(`
      INSERT INTO order_comments (order_id, author_id, author_name, text)
      VALUES ($1, $2, 'Hub', $3)
    `, [order.id, req.user.id,
       `📦 Backorder: ${reason || 'En attente fournisseur'}${items_waiting ? ` (${items_waiting.length} articles)` : ''}`]);

    res.json({
      message: `Commande ${order.reference} marquée en attente`,
      status: 'backorder'
    });
  } catch(e) { next(e); }
});

module.exports = router;

