/**
 * @komerce-arch
 * @role          dashboard-hub-dashboard-queries
 * @domain        dashboard
 * @layer         service
 * @criticality   high
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db, utils/logger.js
 * @used-by       routes/hub-dashboard.js
 * @db-read       order_comments, order_incidents, order_items, orders, parcel_items, parcels, products, relais, scans, users
 * @db-write      none
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change, market_operator_scoping (GAP-1)
 * @impact-areas  dashboard, admin-dashboard, market
 * @version       2026-09
 */

'use strict';

const log = require('../utils/logger').child({ module: 'hub-dashboard-queries' });
const db  = require('../db');

function getMarketScope(authorizedMarkets) {
  const scoped = authorizedMarkets !== null && authorizedMarkets !== undefined;
  return {
    scoped,
    marketIds: scoped ? Array.from(authorizedMarkets) : [],
  };
}

async function getDashboardKPIs({ authorizedMarkets = null } = {}) {
  const { scoped, marketIds } = getMarketScope(authorizedMarkets);
  let ordersData = { to_prepare: 0, in_preparation: 0, shipped_today: 0, shipped_total: 0, urgent: 0, cash_pending: 0, pending: 0, total_active: 0, today: 0 };
  let parcelsData = { draft: 0, preparation: 0, shipped: 0, in_transit: 0, at_relay: 0 };
  let incidentsData = { open: 0, critical: 0 };
  let stockData = { low_stock_count: 0 };

  try {
    const marketClause = scoped ? ' AND market_id = ANY($1::uuid[])' : '';
    const params = scoped ? [marketIds] : [];
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
      WHERE status NOT IN ('cancelled','collected','pending')${marketClause}
    `, params);
    const { rows: [t] } = await db.query(
      `SELECT COUNT(*) AS c FROM orders WHERE created_at >= CURRENT_DATE${marketClause}`,
      params
    );
    ordersData = {
      to_prepare: parseInt(r.to_prepare) || 0,
      in_preparation: parseInt(r.in_preparation) || 0,
      shipped_today: parseInt(r.shipped_today) || 0,
      shipped_total: parseInt(r.shipped_total) || 0,
      urgent: parseInt(r.urgent) || 0,
      cash_pending: parseInt(r.cash_pending) || 0,
      pending: parseInt(r.pending) || 0,
      total_active: parseInt(r.total_active) || 0,
      today: parseInt(t.c) || 0,
    };
  } catch(e) { log.error({ err: e }, '[HUB-DASH] Orders KPI error'); }

  try {
    const params = scoped ? [marketIds] : [];
    const marketWhere = scoped ? 'WHERE o.market_id = ANY($1::uuid[])' : '';
    const { rows: [r] } = await db.query(`
      SELECT
        COUNT(*) FILTER (WHERE p.status = 'draft') AS draft,
        COUNT(*) FILTER (WHERE p.status = 'preparation') AS preparation,
        COUNT(*) FILTER (WHERE p.status = 'shipped') AS shipped,
        COUNT(*) FILTER (WHERE p.status = 'in_transit') AS in_transit,
        COUNT(*) FILTER (WHERE p.status = 'available') AS at_relay
      FROM parcels p
      LEFT JOIN orders o ON o.id = p.order_id
      ${marketWhere}
    `, params);
    parcelsData = {
      draft: parseInt(r.draft) || 0,
      preparation: parseInt(r.preparation) || 0,
      shipped: parseInt(r.shipped) || 0,
      in_transit: parseInt(r.in_transit) || 0,
      at_relay: parseInt(r.at_relay) || 0,
    };
  } catch(e) { log.error({ err: e }, '[HUB-DASH] Parcels KPI error'); }

  try {
    const params = scoped ? [marketIds] : [];
    const marketJoin = scoped ? 'JOIN orders o ON o.id = i.order_id' : '';
    const marketWhere = scoped ? 'WHERE o.market_id = ANY($1::uuid[])' : '';
    const { rows: [r] } = await db.query(`
      SELECT
        COUNT(*) FILTER (WHERE i.status = 'open') AS open_count,
        COUNT(*) FILTER (WHERE i.status = 'open'
          AND (i.priority = 'urgent' OR i.priority = 'high')) AS critical_count
      FROM order_incidents i
      ${marketJoin}
      ${marketWhere}
    `, params);
    incidentsData = {
      open: parseInt(r.open_count) || 0,
      critical: parseInt(r.critical_count) || 0,
    };
  } catch(e) { log.error({ err: e }, '[HUB-DASH] Incidents error'); }

  // Le stock produit n'a pas de dimension market_id. Ne jamais exposer ce
  // compteur global à un market_operator : la forme de réponse reste stable,
  // mais le compteur reste à 0. Admin/agent_hub conservent le comportement historique.
  if (!scoped) {
    try {
      const { rows: [r] } = await db.query(`
        SELECT COUNT(*) AS c FROM products
        WHERE stock IS NOT NULL AND stock <= 2 AND stock >= 0
      `);
      stockData = { low_stock_count: parseInt(r.c) || 0 };
    } catch(e) { log.error({ err: e }, '[HUB-DASH] Stock error'); }
  }

  return { orders: ordersData, parcels: parcelsData, incidents: incidentsData, stock: stockData };
}

async function getQueue(filters = {}, { authorizedMarkets = null } = {}) {
  const { scoped, marketIds } = getMarketScope(authorizedMarkets);
  const { tab = 'to_prepare', search, page = 1, limit = 50 } = filters;
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
  let marketClause = '';
  const params = [];
  let idx = 1;

  if (search) {
    searchClause = `AND (o.reference ILIKE $${idx} OR u.full_name ILIKE $${idx} OR u.phone ILIKE $${idx})`;
    params.push(`%${search}%`);
    idx++;
  }
  if (scoped) {
    marketClause = `AND o.market_id = ANY($${idx}::uuid[])`;
    params.push(marketIds);
    idx++;
  }

  let blockedClause = '';
  if (tab === 'blocked') {
    blockedClause = `AND EXISTS (SELECT 1 FROM order_incidents oi WHERE oi.order_id = o.id AND oi.status = 'open')`;
  }

  const countQ = await db.query(`
    SELECT COUNT(*) FROM orders o
    LEFT JOIN users u ON u.id = o.user_id
    WHERE o.status IN ${statusFilter}
    ${searchClause} ${marketClause} ${blockedClause}
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
      (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) AS items_count,
      (SELECT COALESCE(SUM(oi.quantity), 0) FROM order_items oi WHERE oi.order_id = o.id) AS items_qty,
      (SELECT COUNT(*) FROM parcels p WHERE p.order_id = o.id AND p.status != 'cancelled') AS parcels_count,
      (SELECT COUNT(*) FROM parcel_items pi
       JOIN parcels p ON p.id = pi.parcel_id
       WHERE p.order_id = o.id AND p.status != 'cancelled') AS items_assigned,
      (SELECT COUNT(*) FROM order_incidents inc WHERE inc.order_id = o.id AND inc.status = 'open') AS open_incidents,
      EXTRACT(EPOCH FROM (NOW() - o.created_at)) / 3600 AS age_hours,
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
    ${searchClause} ${marketClause} ${blockedClause}
    ORDER BY
      CASE WHEN o.created_at < NOW() - INTERVAL '48 hours' THEN 0 ELSE 1 END,
      CASE WHEN o.payment_status = 'paid' THEN 0 ELSE 1 END,
      o.created_at ASC
    LIMIT $${idx} OFFSET $${idx + 1}
  `, [...params, safeLimit, offset]);

  return {
    data: rows,
    pagination: { page: safePage, limit: safeLimit, total, pages: Math.ceil(total / safeLimit) },
    tab,
  };
}

async function getOrderDetail(orderId, { authorizedMarkets = null } = {}) {
  const { scoped, marketIds } = getMarketScope(authorizedMarkets);
  const { rows: orderRows } = await db.query(`
    SELECT o.*,
           u.full_name AS client_name, u.phone AS client_phone, u.email AS client_email,
           r.name AS relais_name, r.address AS relais_address, r.phone AS relais_phone,
           r.island AS relais_island
    FROM orders o
    LEFT JOIN users u ON u.id = o.user_id
    LEFT JOIN relais r ON r.id = o.relais_id
    WHERE o.id = $1
  `, [orderId]);

  if (!orderRows.length) return null;
  const order = orderRows[0];
  if (scoped && !authorizedMarkets.has(order.market_id)) return { forbidden: true };

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

  const { rows: timeline } = await db.query(`
    SELECT s.id, s.step, s.scanned_by, s.notes, s.created_at,
           u.full_name AS scanned_by_name
    FROM scans s
    LEFT JOIN users u ON u.id = s.scanned_by
    WHERE s.order_id = $1
    ORDER BY s.created_at ASC
  `, [order.id]);

  const { rows: incidents } = await db.query(`
    SELECT i.*, u.full_name AS reporter_name
    FROM order_incidents i
    LEFT JOIN users u ON u.id = i.reporter_id
    WHERE i.order_id = $1
    ORDER BY i.created_at DESC
  `, [order.id]);

  const { rows: comments } = await db.query(`
    SELECT c.*, u.full_name AS author_name
    FROM order_comments c
    LEFT JOIN users u ON u.id = c.author_id
    WHERE c.order_id = $1
    ORDER BY c.created_at DESC
  `, [order.id]);

  let clientHistory = null;
  if (order.user_id) {
    const historyParams = [order.user_id];
    const historyMarketClause = scoped ? ' AND market_id = ANY($2::uuid[])' : '';
    if (scoped) historyParams.push(marketIds);
    const { rows: ch } = await db.query(`
      SELECT
        COUNT(*) AS total_orders,
        COUNT(*) FILTER (WHERE status = 'collected') AS completed,
        COUNT(*) FILTER (WHERE status = 'cancelled') AS cancelled,
        MIN(created_at) AS first_order
      FROM orders WHERE user_id = $1${historyMarketClause}
    `, historyParams);
    clientHistory = ch[0];
  }

  const payment = {
    mode: order.payment_mode,
    paid: order.payment_status === 'paid',
    total_kmf: order.total_kmf,
    stripe_payment_id: order.stripe_payment_id || null,
    blocking: order.payment_mode === 'cash_relais' && !order.paid,
  };

  return {
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
      all_items_assigned: parcels.reduce((s, p) => s + p.items.length, 0) >= items.length,
    },
  };
}

async function getValidation(orderId, { authorizedMarkets = null } = {}) {
  const { scoped } = getMarketScope(authorizedMarkets);
  const { rows: orderRows } = await db.query(
    'SELECT id, status, payment_mode, payment_status, total_kmf, market_id FROM orders WHERE id = $1',
    [orderId]
  );
  if (!orderRows.length) return null;
  const order = orderRows[0];
  if (scoped && !authorizedMarkets.has(order.market_id)) return { forbidden: true };

  const errors = [];
  const warnings = [];

  const { rows: [itemCount] } = await db.query(
    'SELECT COUNT(*) AS cnt FROM order_items WHERE order_id = $1', [order.id]
  );
  if (parseInt(itemCount.cnt) === 0) errors.push({ code: 'NO_ITEMS', message: 'Commande sans articles' });

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
        item_id: item.id,
      });
    } else if (item.status === 'partial') {
      warnings.push({
        code: 'STOCK_PARTIAL',
        message: `Stock insuffisant: ${item.name} (demandé: ${item.quantity}, dispo: ${item.stock})`,
        item_id: item.id,
      });
    }
  }

  if (order.payment_status !== 'paid' && order.payment_mode !== 'cash_relais') {
    warnings.push({ code: 'UNPAID', message: 'Commande non payée (paiement non cash)' });
  }

  const { rows: parcels } = await db.query(`
    SELECT p.id, p.reference, p.status,
      o.destination_island, o.relais_id
    FROM parcels p
    JOIN orders o ON o.id = p.order_id
    WHERE p.order_id = $1 AND p.status != 'cancelled'
  `, [order.id]);

  for (const p of parcels) {
    if (!p.destination_island && !p.relais_id) {
      errors.push({ code: 'NO_DESTINATION', message: `Colis ${p.reference} sans destination`, parcel_id: p.id });
    }
  }

  const { rows: [assignedCount] } = await db.query(`
    SELECT COUNT(DISTINCT pi.order_item_id) AS cnt
    FROM parcel_items pi
    JOIN parcels p ON p.id = pi.parcel_id
    WHERE p.order_id = $1 AND p.status != 'cancelled'
  `, [order.id]);

  if (parseInt(assignedCount.cnt) < parseInt(itemCount.cnt)) {
    const missing = parseInt(itemCount.cnt) - parseInt(assignedCount.cnt);
    warnings.push({ code: 'ITEMS_NOT_ASSIGNED', message: `${missing} article(s) non assigné(s) à un colis` });
  }

  const { rows: [incCount] } = await db.query(
    "SELECT COUNT(*) AS cnt FROM order_incidents WHERE order_id = $1 AND status = 'open'",
    [order.id]
  );
  if (parseInt(incCount.cnt) > 0) {
    warnings.push({ code: 'OPEN_INCIDENTS', message: `${incCount.cnt} incident(s) ouvert(s) sur cette commande` });
  }

  return {
    order_id: order.id,
    can_prepare: errors.length === 0,
    can_ship: errors.length === 0 && !warnings.some(w => w.code === 'ITEMS_NOT_ASSIGNED'),
    errors,
    warnings,
    checks_passed: errors.length === 0 && warnings.length === 0,
  };
}

module.exports = { getDashboardKPIs, getQueue, getOrderDetail, getValidation };
