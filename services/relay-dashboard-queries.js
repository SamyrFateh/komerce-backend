/**
 * @komerce-arch
 * @role          dashboard-relay-dashboard-queries
 * @domain        dashboard
 * @layer         service
 * @criticality   high
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db, utils/logger.js
 * @used-by       routes/relay-dashboard.js
 * @db-read       order_comments, order_incidents, order_items, order_status_history, orders, products, recipients, relais, sms_log, users
 * @db-write      none
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  dashboard, admin-dashboard
 * @version       2026-06
 */

'use strict';

/**
 * services/relay-dashboard-queries.js
 *
 * Extrait de routes/relay-dashboard.js — R9 (2026-06-14)
 *
 * Expose uniquement les fonctions READ (GET) :
 *   getDashboardKPIs(user)       — GET /dashboard  (KPIs + alertes relais)
 *   getOrders(user, filters)     — GET /orders  (liste filtrée + enrichissement urgence)
 *   getOrderDetail(user, id)     — GET /orders/:id  (détail complet)
 *
 * Les mutations (POST/PATCH) restent dans la route — inserts simples sans
 * logique partageable :
 *   POST /orders/:id/incident    → assertOrderBelongsToRelais + INSERT order_incidents
 *   POST /orders/:id/comment     → assertOrderBelongsToRelais + INSERT order_comments
 *   POST /orders/:id/escalate    → incident + comment
 *   PATCH /orders/:id/client-absent → incident + comment
 *
 * Note sécurité : le scoping par relais_id (R1 FIX) est préservé à l'identique.
 */

const db  = require('../db');
const log = require('../utils/logger').child({ module: 'relay-dashboard-queries' });

// ─── getDashboardKPIs ─────────────────────────────────────────────────────

async function getDashboardKPIs(user) {
  const kpiParams = [];
  const kpiWhere = user.role !== 'admin'
    ? (kpiParams.push(user.relais_id), 'WHERE relais_id = $1')
    : '';

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
    ${kpiWhere}
  `, kpiParams);

  let incidents_ouverts = 0;
  try {
    const incQuery = user.role !== 'admin'
      ? `SELECT COUNT(*)::int AS c FROM order_incidents oi
         JOIN orders o ON o.id = oi.order_id
         WHERE oi.status IN ('open','in_progress') AND o.relais_id = $1`
      : `SELECT COUNT(*)::int AS c FROM order_incidents WHERE status IN ('open','in_progress')`;
    const incParams = user.role !== 'admin' ? [user.relais_id] : [];
    const { rows: [inc] } = await db.query(incQuery, incParams);
    incidents_ouverts = inc.c;
  } catch(e) { /* table might not exist yet */ }

  const alertes = [];
  if (Number(kpi.en_attente_72h) > 0)
    alertes.push({ type: 'warning', message: `${kpi.en_attente_72h} colis en attente depuis +72h` });
  if (Number(kpi.cash_a_encaisser) > 0)
    alertes.push({ type: 'info', message: `${kpi.cash_a_encaisser} paiements cash à encaisser (${Number(kpi.montant_cash_pending).toLocaleString('fr-FR')} KMF)` });
  if (incidents_ouverts > 0)
    alertes.push({ type: 'danger', message: `${incidents_ouverts} incident(s) non résolu(s)` });

  return {
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
  };
}

// ─── getOrders ────────────────────────────────────────────────────────────

async function getOrders(user, { status, search, limit = 50, offset = 0 }) {
  let where = 'WHERE 1=1';
  const params = [];
  let pi = 1;

  if (user.role !== 'admin') {
    where += ` AND o.relais_id = $${pi}`;
    params.push(user.relais_id);
    pi++;
  }

  if (status) {
    const statuses = status.split(',').map(s => s.trim());
    where += ` AND o.status = ANY($${pi}::text[])`;
    params.push(statuses);
    pi++;
  } else {
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

  return { total: orders.length, orders };
}

// ─── getOrderDetail ───────────────────────────────────────────────────────

// Regex UUID standard — utilisée pour éviter "operator does not exist: text = uuid"
// quand orderId est une référence (ex. "KOM-1234") et non un uuid.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function getOrderDetail(user, orderId) {
  const isUuid = UUID_RE.test(orderId);
  const whereClause = isUuid
    ? 'o.id = $1::uuid OR o.reference = $1'
    : 'o.reference = $1';

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
    WHERE ${whereClause}
  `, [orderId]);

  if (!order) return null;

  // Guard IDOR
  if (user.role !== 'admin' && String(order.relais_id) !== String(user.relais_id)) {
    log.warn(`[RELAY] IDOR bloqué — user ${user.id} (relais ${user.relais_id}) → order ${order.id} (relais ${order.relais_id})`);
    return { forbidden: true };
  }

  const { rows: items } = await db.query(`
    SELECT oi.*, p.name AS produit_nom, p.image_url, p.category
    FROM order_items oi
    JOIN products p ON p.id = oi.product_id
    WHERE oi.order_id = $1
  `, [order.id]);

  const { rows: timeline } = await db.query(`
    SELECT osh.status, osh.note, osh.created_at,
      u.full_name AS changed_by_name, u.role AS changed_by_role
    FROM order_status_history osh
    LEFT JOIN users u ON u.id = osh.changed_by
    WHERE osh.order_id = $1
    ORDER BY osh.created_at ASC
  `, [order.id]);

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
  } catch(e) {}

  let comments = [];
  try {
    const { rows } = await db.query(`
      SELECT * FROM order_comments WHERE order_id = $1 ORDER BY created_at DESC
    `, [order.id]);
    comments = rows;
  } catch(e) {}

  let sms_log = [];
  try {
    const { rows } = await db.query(`
      SELECT event, status, sent_at, message_preview
      FROM sms_log WHERE order_id = $1 ORDER BY sent_at DESC
    `, [order.id]);
    sms_log = rows;
  } catch(e) {}

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

  return {
    order: {
      id: order.id, reference: order.reference, status: order.status,
      pickup_code: order.pickup_code,
      created_at: order.created_at, updated_at: order.updated_at,
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
      nom: order.relais_nom, ile: order.ile,
      adresse: order.relais_adresse, phone: order.relais_phone,
    },
    paiement,
    items: items.map(i => ({
      produit: i.produit_nom, image: i.image_url, category: i.category,
      quantity: Number(i.quantity), prix_kmf: Number(i.price_kmf),
    })),
    timeline,
    incidents,
    comments,
    notifications_envoyees: sms_log,
  };
}

module.exports = { getDashboardKPIs, getOrders, getOrderDetail };
