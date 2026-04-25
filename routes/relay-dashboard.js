/**
 * KOMERCE — Relay Agent Dashboard API v1.0
 * =========================================
 * Endpoints dédiés aux agents relais — mini centre de contrôle local + SAV
 *
 * GET  /api/relay/dashboard              → KPIs relais (colis en attente, collectés, cash)
 * GET  /api/relay/orders                 → Commandes du relais (filtrables)
 * GET  /api/relay/orders/:id             → Détail complet (timeline, paiement, client, incidents)
 * POST /api/relay/orders/:id/incident    → Signaler un incident
 * POST /api/relay/orders/:id/comment     → Ajouter un commentaire terrain
 * POST /api/relay/orders/:id/escalate    → Escalader au hub/admin
 * PATCH /api/relay/orders/:id/client-absent → Marquer client absent
 *
 * Auth : JWT + rôle agent_relais ou admin
 */

'use strict';

const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');

// ── Auth : relay + admin ────────────────────────────────────────────────────
router.use(authenticate, requireRole(['admin', 'agent_relais']));

// ── Auto-create tables (idempotent) ─────────────────────────────────────────
async function ensureRelayTables() {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS order_incidents (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        reporter_id UUID REFERENCES users(id),
        reporter_name TEXT,
        type TEXT NOT NULL CHECK (type IN ('retard','blocage','paiement','stock','colis_endommage','colis_perdu','client_absent','autre')),
        description TEXT,
        priority TEXT DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
        status TEXT DEFAULT 'open' CHECK (status IN ('open','in_progress','resolved','closed')),
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
        text TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_incidents_order ON order_incidents(order_id);
      CREATE INDEX IF NOT EXISTS idx_incidents_status ON order_incidents(status);
      CREATE INDEX IF NOT EXISTS idx_comments_order ON order_comments(order_id);
    `);
  } catch(e) {
    console.warn('[RELAY] Table creation (non-fatal):', e.message);
  }
}

// Run on module load
ensureRelayTables();

// ═══════════════════════════════════════════════════════════════════════════════
// 1. GET /dashboard — KPIs relais
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/dashboard', async (req, res, next) => {
  try {
    // ── KPIs principaux ──────────────────────────────────────────────────
    const { rows: [kpi] } = await db.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'in_transit')   AS en_transit,
        COUNT(*) FILTER (WHERE status = 'available')    AS disponibles,
        COUNT(*) FILTER (WHERE status = 'available'
          AND payment_mode = 'cash_relais' AND payment_status = 'pending') AS cash_a_encaisser,
        COUNT(*) FILTER (WHERE status = 'collected'
          AND collected_at::date = CURRENT_DATE)        AS collectes_aujourd_hui,
        COUNT(*) FILTER (WHERE status = 'collected'
          AND collected_at >= NOW() - INTERVAL '7 days') AS collectes_7j,
        COUNT(*) FILTER (WHERE status = 'available'
          AND available_at < NOW() - INTERVAL '72 hours') AS en_attente_72h,
        COUNT(*) FILTER (WHERE status NOT IN ('collected','cancelled','refunded')) AS total_actives,
        COALESCE(SUM(total_kmf) FILTER (WHERE status = 'available'
          AND payment_mode = 'cash_relais' AND payment_status = 'pending'), 0) AS montant_cash_pending
      FROM orders
    `);

    // ── Incidents ouverts ────────────────────────────────────────────────
    let incidents_ouverts = 0;
    try {
      const { rows: [inc] } = await db.query(
        `SELECT COUNT(*)::int AS c FROM order_incidents WHERE status IN ('open','in_progress')`
      );
      incidents_ouverts = inc.c;
    } catch(e) { /* table might not exist yet */ }

    // ── Alertes ──────────────────────────────────────────────────────────
    const alertes = [];
    if (Number(kpi.en_attente_72h) > 0)
      alertes.push({ type: 'warning', message: `${kpi.en_attente_72h} colis en attente depuis +72h` });
    if (Number(kpi.cash_a_encaisser) > 0)
      alertes.push({ type: 'info', message: `${kpi.cash_a_encaisser} paiements cash à encaisser (${Number(kpi.montant_cash_pending).toLocaleString()} KMF)` });
    if (incidents_ouverts > 0)
      alertes.push({ type: 'danger', message: `${incidents_ouverts} incident(s) non résolu(s)` });

    res.json({
      kpi: {
        en_transit:           Number(kpi.en_transit),
        disponibles:          Number(kpi.disponibles),
        cash_a_encaisser:     Number(kpi.cash_a_encaisser),
        montant_cash_pending: Math.round(Number(kpi.montant_cash_pending)),
        collectes_aujourd_hui: Number(kpi.collectes_aujourd_hui),
        collectes_7j:         Number(kpi.collectes_7j),
        en_attente_72h:       Number(kpi.en_attente_72h),
        total_actives:        Number(kpi.total_actives),
        incidents_ouverts,
      },
      alertes,
    });
  } catch(err) { next(err); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. GET /orders — Commandes du relais (filtrables)
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/orders', async (req, res, next) => {
  try {
    const { status, search, limit = 50, offset = 0 } = req.query;

    let where = 'WHERE 1=1';
    const params = [];
    let pi = 1;

    if (status) {
      // Allow comma-separated statuses
      const statuses = status.split(',').map(s => s.trim());
      where += ` AND o.status = ANY($${pi}::text[])`;
      params.push(statuses);
      pi++;
    } else {
      // Default: relay-relevant statuses
      // Note: ENUM order_status n'a pas 'in_transit' (c'est sur parcels).
      // Les statuts pertinents pour un relais sont : shipped → available → collected.
      where += ` AND o.status IN ('shipped','available','collected')`;
    }

    if (search) {
      where += ` AND (o.reference ILIKE $${pi} OR rc.full_name ILIKE $${pi} OR rc.phone ILIKE $${pi})`;
      params.push(`%${search}%`);
      pi++;
    }

    params.push(Math.min(100, Number(limit) || 50));
    params.push(Math.max(0, Number(offset) || 0));

    const { rows } = await db.query(`
      SELECT
        o.id, o.reference, o.status, o.total_kmf,
        o.payment_mode, o.payment_status, o.pickup_code,
        o.created_at, o.ordered_at, o.shipped_at, o.in_transit_at,
        o.available_at, o.collected_at, o.cancelled_at, o.updated_at,
        rc.full_name AS client_nom, rc.phone AS client_phone,
        u.email AS client_email, u.full_name AS user_name,
        r.name AS relais_nom, r.island AS ile,
        EXTRACT(EPOCH FROM (NOW() - COALESCE(o.available_at, o.updated_at))) / 3600 AS heures_attente,
        EXTRACT(EPOCH FROM (NOW() - o.created_at)) / 86400 AS age_jours,
        (SELECT COUNT(*) FROM order_items WHERE order_id = o.id)::int AS nb_items,
        (SELECT p.name FROM order_items oi JOIN products p ON p.id = oi.product_id
         WHERE oi.order_id = o.id ORDER BY oi.created_at ASC LIMIT 1) AS premier_produit,
        (SELECT COUNT(*)::int FROM order_incidents WHERE order_id = o.id AND status IN ('open','in_progress')) AS incidents_ouverts,
        (SELECT COUNT(*)::int FROM order_comments WHERE order_id = o.id) AS nb_commentaires
      FROM orders o
      LEFT JOIN users u ON u.id = o.user_id
      LEFT JOIN recipients rc ON rc.id = o.recipient_id
      LEFT JOIN relais r ON r.id = o.relais_id
      ${where}
      ORDER BY
        CASE o.status
          WHEN 'available' THEN 1
          WHEN 'in_transit' THEN 2
          WHEN 'collected' THEN 3
          ELSE 4
        END,
        o.available_at ASC NULLS LAST,
        o.created_at DESC
      LIMIT $${pi} OFFSET $${pi + 1}
    `, params);

    // Enrich with priority/urgency
    const orders = rows.map(o => {
      const heures = Math.round(Number(o.heures_attente) || 0);
      let urgence = 'normale';
      if (o.status === 'available') {
        if (heures > 120) urgence = 'critique';
        else if (heures > 72) urgence = 'haute';
        else if (heures > 24) urgence = 'moyenne';
      }
      return {
        ...o,
        total_kmf: Number(o.total_kmf),
        heures_attente: heures,
        age_jours: Math.round(Number(o.age_jours)),
        urgence,
        cash_pending: o.payment_mode === 'cash_relais' && o.payment_status !== 'paid',
      };
    });

    res.json({ total: orders.length, orders });
  } catch(err) { next(err); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. GET /orders/:id — Détail complet d'une commande
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/orders/:id', async (req, res, next) => {
  try {
    const orderId = req.params.id;

    // ── Commande ─────────────────────────────────────────────────────────
    const { rows: [order] } = await db.query(`
      SELECT
        o.*,
        rc.full_name AS client_nom, rc.phone AS client_phone,
        u.email AS client_email, u.full_name AS user_name, u.phone AS user_phone,
        r.name AS relais_nom, r.island AS ile, r.address AS relais_adresse,
        r.phone AS relais_phone,
        EXTRACT(EPOCH FROM (NOW() - COALESCE(o.available_at, o.updated_at))) / 3600 AS heures_attente,
        EXTRACT(EPOCH FROM (NOW() - o.created_at)) / 86400 AS age_jours
      FROM orders o
      LEFT JOIN users u ON u.id = o.user_id
      LEFT JOIN recipients rc ON rc.id = o.recipient_id
      LEFT JOIN relais r ON r.id = o.relais_id
      WHERE o.id = $1 OR o.reference = $1
    `, [orderId]);

    if (!order) return res.status(404).json({ error: 'Commande introuvable' });

    // ── Items ────────────────────────────────────────────────────────────
    const { rows: items } = await db.query(`
      SELECT oi.*, p.name AS produit_nom, p.image_url, p.category
      FROM order_items oi
      JOIN products p ON p.id = oi.product_id
      WHERE oi.order_id = $1
    `, [order.id]);

    // ── Timeline (order_status_history) ─────────────────────────────────
    const { rows: timeline } = await db.query(`
      SELECT osh.status, osh.note, osh.created_at,
        u.full_name AS changed_by_name, u.role AS changed_by_role
      FROM order_status_history osh
      LEFT JOIN users u ON u.id = osh.changed_by
      WHERE osh.order_id = $1
      ORDER BY osh.created_at ASC
    `, [order.id]);

    // ── Incidents ────────────────────────────────────────────────────────
    let incidents = [];
    try {
      const { rows } = await db.query(`
        SELECT i.*, u.full_name AS resolved_by_name
        FROM order_incidents i
        LEFT JOIN users u ON u.id = i.resolved_by
        WHERE i.order_id = $1
        ORDER BY i.created_at DESC
      `, [order.id]);
      incidents = rows;
    } catch(e) { /* table might not exist */ }

    // ── Commentaires ─────────────────────────────────────────────────────
    let comments = [];
    try {
      const { rows } = await db.query(`
        SELECT * FROM order_comments
        WHERE order_id = $1
        ORDER BY created_at DESC
      `, [order.id]);
      comments = rows;
    } catch(e) { /* table might not exist */ }

    // ── SMS envoyés ──────────────────────────────────────────────────────
    let sms_log = [];
    try {
      const { rows } = await db.query(`
        SELECT event, status, sent_at, message_preview
        FROM sms_log
        WHERE order_id = $1
        ORDER BY sent_at DESC
      `, [order.id]);
      sms_log = rows;
    } catch(e) { /* table might not exist */ }

    // ── Historique client (commandes précédentes) ────────────────────────
    let client_history = { total_orders: 0, total_spent_kmf: 0, problems: 0 };
    if (order.user_id) {
      const { rows: [hist] } = await db.query(`
        SELECT
          COUNT(*)::int AS total_orders,
          COALESCE(SUM(total_kmf), 0) AS total_spent_kmf,
          COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelled,
          MIN(created_at) AS first_order
        FROM orders WHERE user_id = $1
      `, [order.user_id]);
      client_history = {
        total_orders: hist.total_orders,
        total_spent_kmf: Math.round(Number(hist.total_spent_kmf)),
        cancelled: hist.cancelled,
        first_order: hist.first_order,
        is_recurring: hist.total_orders > 1,
      };
    }

    // ── Paiement détaillé ────────────────────────────────────────────────
    const paiement = {
      mode: order.payment_mode,
      status: order.payment_status,
      is_paid: order.payment_status === 'paid',
      cash_pending: order.payment_mode === 'cash_relais' && order.payment_status !== 'paid',
      total_kmf: Number(order.total_kmf),
      total_eur: order.total_eur ? Number(order.total_eur) : null,
      wallet_applied: order.wallet_applied_kmf ? Number(order.wallet_applied_kmf) : 0,
      bloquant_pour_remise: order.payment_mode === 'cash_relais' && order.payment_status !== 'paid',
    };

    res.json({
      order: {
        id: order.id,
        reference: order.reference,
        status: order.status,
        pickup_code: order.pickup_code,
        created_at: order.created_at,
        updated_at: order.updated_at,
        age_jours: Math.round(Number(order.age_jours)),
        heures_attente: Math.round(Number(order.heures_attente) || 0),
      },
      client: {
        nom: order.client_nom || order.user_name || 'Client',
        phone: order.client_phone || order.user_phone || '',
        email: order.client_email || '',
        history: client_history,
      },
      relais: {
        nom: order.relais_nom,
        ile: order.ile,
        adresse: order.relais_adresse,
        phone: order.relais_phone,
      },
      paiement,
      items: items.map(i => ({
        produit: i.produit_nom,
        image: i.image_url,
        category: i.category,
        quantity: Number(i.quantity),
        prix_kmf: Number(i.price_kmf),
      })),
      timeline,
      incidents,
      comments,
      notifications_envoyees: sms_log,
    });
  } catch(err) { next(err); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. POST /orders/:id/incident — Signaler un incident
// ═══════════════════════════════════════════════════════════════════════════════

router.post('/orders/:id/incident', async (req, res, next) => {
  try {
    const { type, description, priority } = req.body;

    if (!type) return res.status(400).json({ error: 'Type d\'incident requis' });

    const validTypes = ['retard','blocage','paiement','stock','colis_endommage','colis_perdu','client_absent','autre'];
    if (!validTypes.includes(type)) {
      return res.status(400).json({ error: `Type invalide. Valides: ${validTypes.join(', ')}` });
    }

    // Verify order exists
    const { rows: [order] } = await db.query('SELECT id, reference FROM orders WHERE id = $1', [req.params.id]);
    if (!order) return res.status(404).json({ error: 'Commande introuvable' });

    const { rows: [incident] } = await db.query(`
      INSERT INTO order_incidents (order_id, reporter_id, reporter_name, type, description, priority)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [order.id, req.user.id, req.user.full_name, type, description || null, priority || 'normal']);

    console.log(`[RELAY] 🚨 Incident ${incident.id} créé — commande ${order.reference} — type: ${type}`);

    res.status(201).json({ success: true, incident });
  } catch(err) { next(err); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. POST /orders/:id/comment — Ajouter commentaire terrain
// ═══════════════════════════════════════════════════════════════════════════════

router.post('/orders/:id/comment', async (req, res, next) => {
  try {
    const { text } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ error: 'Texte requis' });

    const { rows: [order] } = await db.query('SELECT id FROM orders WHERE id = $1', [req.params.id]);
    if (!order) return res.status(404).json({ error: 'Commande introuvable' });

    const { rows: [comment] } = await db.query(`
      INSERT INTO order_comments (order_id, author_id, author_name, author_role, text)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [order.id, req.user.id, req.user.full_name, req.user.role, text.trim()]);

    res.status(201).json({ success: true, comment });
  } catch(err) { next(err); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. POST /orders/:id/escalate — Escalader au hub
// ═══════════════════════════════════════════════════════════════════════════════

router.post('/orders/:id/escalate', async (req, res, next) => {
  try {
    const { reason, priority } = req.body;
    if (!reason || !reason.trim()) return res.status(400).json({ error: 'Raison d\'escalade requise' });

    const { rows: [order] } = await db.query('SELECT id, reference FROM orders WHERE id = $1', [req.params.id]);
    if (!order) return res.status(404).json({ error: 'Commande introuvable' });

    // Create incident of type "escalade" with high priority
    const { rows: [incident] } = await db.query(`
      INSERT INTO order_incidents (order_id, reporter_id, reporter_name, type, description, priority)
      VALUES ($1, $2, $3, 'autre', $4, $5)
      RETURNING *
    `, [order.id, req.user.id, req.user.full_name, `⚠️ ESCALADE HUB: ${reason.trim()}`, priority || 'high']);

    // Also add a comment for visibility
    await db.query(`
      INSERT INTO order_comments (order_id, author_id, author_name, author_role, text)
      VALUES ($1, $2, $3, $4, $5)
    `, [order.id, req.user.id, req.user.full_name, req.user.role, `⚠️ Escaladé au hub: ${reason.trim()}`]);

    console.log(`[RELAY] ⚠️ Escalade hub — commande ${order.reference} — raison: ${reason}`);

    res.status(201).json({ success: true, incident, message: 'Escalade envoyée au hub' });
  } catch(err) { next(err); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. PATCH /orders/:id/client-absent — Marquer client absent
// ═══════════════════════════════════════════════════════════════════════════════

router.patch('/orders/:id/client-absent', async (req, res, next) => {
  try {
    const { rows: [order] } = await db.query(
      'SELECT id, reference, status FROM orders WHERE id = $1',
      [req.params.id]
    );
    if (!order) return res.status(404).json({ error: 'Commande introuvable' });

    if (order.status !== 'available') {
      return res.status(422).json({ error: 'Seules les commandes "available" peuvent être marquées client absent' });
    }

    // Create incident
    await db.query(`
      INSERT INTO order_incidents (order_id, reporter_id, reporter_name, type, description, priority)
      VALUES ($1, $2, $3, 'client_absent', $4, 'normal')
    `, [order.id, req.user.id, req.user.full_name, `Client absent — relancé par ${req.user.full_name}`]);

    // Add comment
    await db.query(`
      INSERT INTO order_comments (order_id, author_id, author_name, author_role, text)
      VALUES ($1, $2, $3, $4, 'Client absent — relance programmée')
    `, [order.id, req.user.id, req.user.full_name, req.user.role]);

    console.log(`[RELAY] 👤 Client absent — commande ${order.reference}`);

    res.json({ success: true, message: 'Client marqué absent, relance programmée' });
  } catch(err) { next(err); }
});

module.exports = router;
