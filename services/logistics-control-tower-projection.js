/**
 * @komerce-arch
 * @role          logistics-control-tower-market-projection
 * @domain        admin-dashboard
 * @layer         service
 * @criticality   high
 * @inputs        server_resolved_market, projection_limit
 * @outputs       market_scoped_logistics_control_chain_projection
 * @depends       db.js
 * @used-by       future canonical control-tower route
 * @db-read       orders, order_items, parcel_items, parcels, purchase_orders, purchase_lines,
 *                v_purchase_line_progress, hub_purchase_allocations, hub_physical_unit_placements,
 *                hub_physical_units, customs_shipment_parcels, customs_shipments, incidents, signals
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_LOGISTICS_CONTROL_CHAIN.md, dashboard_no_business_recompute,
 *                server_market_scope_is_authority
 * @impact-areas  dashboard, logistics, purchasing, customs, decision-signals
 * @version       2026-10
 */
'use strict';

const db = require('../db');

const STAGES = Object.freeze([
  'ORDER', 'PURCHASING', 'SUPPLIER', 'HUB_RECEIVING', 'HUB_CONTROL',
  'FORWARDER', 'TRANSPORT', 'CUSTOMS', 'RELAY', 'DELIVERED',
]);
const STAGE_RANK = Object.freeze(Object.fromEntries(STAGES.map((stage, index) => [stage, index])));
const HEALTH = Object.freeze({ GREEN: 'GREEN', ORANGE: 'ORANGE', RED: 'RED' });

function positiveInt(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function stageRank(stage) {
  return Object.prototype.hasOwnProperty.call(STAGE_RANK, stage) ? STAGE_RANK[stage] : 0;
}

function earliestStage(stages, fallback = 'ORDER') {
  const valid = (stages || []).filter(stage => Object.prototype.hasOwnProperty.call(STAGE_RANK, stage));
  return valid.length ? valid.reduce((a, b) => stageRank(b) < stageRank(a) ? b : a) : fallback;
}

function stageForParcel(row) {
  const status = String(row?.parcel_status || '').toLowerCase();
  if (status === 'collected') return 'DELIVERED';
  if (status === 'arrived' || status === 'available') return 'RELAY';
  if (row?.customs_cleared_at || row?.customs_confirmed === true) return 'CUSTOMS';
  if (status === 'in_transit') return 'TRANSPORT';
  if (status === 'shipped') return 'FORWARDER';
  if (status === 'draft' || status === 'preparation') return 'HUB_CONTROL';
  return 'ORDER';
}

function stageForHubState(state) {
  switch (String(state || '').toUpperCase()) {
    case 'DISPATCHED': return 'FORWARDER';
    case 'IDENTIFIED':
    case 'QUALITY_CHECKED':
    case 'LOCATED':
    case 'ALLOCATED':
    case 'PICKED':
    case 'PACKED':
    case 'QUARANTINED':
      return 'HUB_CONTROL';
    default:
      return 'HUB_RECEIVING';
  }
}

function stageForPurchaseProgress(row) {
  const status = String(row?.po_status || '').toLowerCase();
  if (status === 'hub_received') return 'HUB_RECEIVING';
  if (['notified', 'confirmed', 'shipped'].includes(status)) return 'SUPPLIER';
  return 'PURCHASING';
}

function severityHealth(severity) {
  const value = String(severity || '').toLowerCase();
  if (['critical', 'urgent', 'high'].includes(value)) return HEALTH.RED;
  if (['warning', 'medium', 'low'].includes(value)) return HEALTH.ORANGE;
  return HEALTH.GREEN;
}

function deriveHealth({ incidents = [], signals = [] } = {}) {
  const rows = [
    ...incidents.map(row => ({
      health: severityHealth(row.severity),
      reason_code: row.reason_code || row.incident_type || 'INCIDENT',
      source: 'incident',
      ref: row.id || null,
    })),
    ...signals.map(row => ({
      health: severityHealth(row.severity),
      reason_code: row.signal_type || 'SIGNAL',
      source: 'signal',
      ref: row.signal_ref || row.id || null,
    })),
  ].filter(row => row.health !== HEALTH.GREEN);
  const rank = value => value === HEALTH.RED ? 2 : value === HEALTH.ORANGE ? 1 : 0;
  rows.sort((a, b) => rank(b.health) - rank(a.health));
  return rows[0] || { health: HEALTH.GREEN, reason_code: null, source: null, ref: null };
}

function allocateSegments(requiredQuantity, item, evidence) {
  const required = Math.max(1, positiveInt(requiredQuantity, 1));
  const segments = [];
  let remaining = required;

  const parcels = [...(evidence.parcels || [])]
    .filter(row => String(row.order_item_id) === String(item.id))
    .sort((a, b) => stageRank(stageForParcel(a)) - stageRank(stageForParcel(b)));

  for (const row of parcels) {
    if (!remaining) break;
    const quantity = Math.min(remaining, positiveInt(row.quantity, 1));
    segments.push({
      stage: stageForParcel(row),
      quantity,
      envelope: {
        type: 'PARCEL', id: row.parcel_id || null,
        reference: row.parcel_reference || null, status: row.parcel_status || null,
      },
    });
    remaining -= quantity;
  }

  const progress = (evidence.purchase || [])
    .filter(row => String(row.order_item_id) === String(item.id) && !row.cancelled);
  const totalReceived = progress.reduce((sum, row) => sum + positiveInt(row.received_quantity), 0);
  const parcelQuantity = required - remaining;
  let hubResidual = Math.max(0, Math.min(required, totalReceived) - parcelQuantity);

  if (remaining && hubResidual) {
    const hubRows = [...(evidence.hub || [])]
      .filter(row => String(row.order_item_id) === String(item.id))
      .sort((a, b) => stageRank(stageForHubState(a.unit_state)) - stageRank(stageForHubState(b.unit_state)));
    const activeHub = hubRows.reduce((sum, row) => sum + positiveInt(row.quantity), 0);
    const physicalResidual = Math.max(0, activeHub - parcelQuantity);
    const physicalQuantity = Math.min(remaining, hubResidual, physicalResidual);

    if (physicalQuantity && hubRows.length) {
      segments.push({
        stage: earliestStage(hubRows.map(row => stageForHubState(row.unit_state)), 'HUB_RECEIVING'),
        quantity: physicalQuantity,
        envelope: { type: 'HUB_UNIT', references: hubRows.map(row => row.unit_reference).filter(Boolean) },
      });
      remaining -= physicalQuantity;
      hubResidual -= physicalQuantity;
    }
    if (remaining && hubResidual) {
      const quantity = Math.min(remaining, hubResidual);
      segments.push({ stage: 'HUB_RECEIVING', quantity, envelope: { type: 'HUB_RECEIPT' } });
      remaining -= quantity;
    }
  }

  if (remaining) {
    const upstream = progress
      .map(row => ({
        row,
        quantity: Math.max(0, positiveInt(row.effective_quantity) - positiveInt(row.received_quantity)),
      }))
      .filter(entry => entry.quantity > 0)
      .sort((a, b) => stageRank(stageForPurchaseProgress(a.row)) - stageRank(stageForPurchaseProgress(b.row)));

    for (const entry of upstream) {
      if (!remaining) break;
      const quantity = Math.min(remaining, entry.quantity);
      segments.push({
        stage: stageForPurchaseProgress(entry.row), quantity,
        envelope: {
          type: 'PURCHASE', purchase_line_id: entry.row.line_id || null,
          purchase_order_id: entry.row.purchase_order_id || null, status: entry.row.po_status || null,
        },
      });
      remaining -= quantity;
    }
  }

  if (remaining) {
    const status = String(evidence.order?.status || '').toLowerCase();
    const isImport = String(item.fulfillment_source || '').toUpperCase() === 'IMPORT';
    const procurementExpected = isImport && !['pending', 'confirmed'].includes(status);
    segments.push({
      stage: procurementExpected ? 'PURCHASING' : 'ORDER',
      quantity: remaining,
      envelope: { type: procurementExpected ? 'PROCUREMENT_GAP' : 'ORDER_ITEM' },
    });
  }
  return segments;
}

function deriveOrderStage({ order, items, purchase, parcels, hub }) {
  return earliestStage(items.map(item => {
    const segments = allocateSegments(item.quantity, item, { order, purchase, parcels, hub });
    return earliestStage(segments.map(segment => segment.stage), 'ORDER');
  }), 'ORDER');
}

function indexBy(rows, key) {
  const map = new Map();
  for (const row of rows || []) {
    if (row?.[key] == null) continue;
    const id = String(row[key]);
    if (!map.has(id)) map.set(id, []);
    map.get(id).push(row);
  }
  return map;
}


async function buildMarketControlTower({ marketId, marketCode = null, limit = 250 } = {}) {
  if (!marketId) throw new Error('control_tower_market_not_resolved');
  const boundedLimit = Math.max(1, Math.min(1000, positiveInt(limit, 250)));

  const { rows: orders } = await db.query(`
    SELECT id, reference, status::text AS status, payment_status::text AS payment_status, created_at
      FROM orders
     WHERE market_id = $1
       AND status::text NOT IN ('cancelled','refunded')
     ORDER BY created_at DESC, id DESC
     LIMIT $2
  `, [marketId, boundedLimit]);

  const scope = { mode: 'market', market: { id: marketId, code: marketCode } };
  if (!orders.length) {
    return { scope, stages: STAGES.map(key => ({ key, orders: [] })), orders: [], generated_at: new Date().toISOString() };
  }

  const orderIds = orders.map(row => row.id);
  const [items, purchase, parcels, hub, incidents, signals] = await Promise.all([
    db.query(`
      SELECT id, order_id, quantity, fulfillment_source
        FROM order_items
       WHERE order_id = ANY($1::uuid[])
       ORDER BY order_id, created_at, id
    `, [orderIds]),
    db.query(`
      SELECT line_id, order_item_id, order_id, purchase_order_id,
             po_status::text AS po_status, effective_quantity, received_quantity,
             cancelled, hub_received_at
        FROM v_purchase_line_progress
       WHERE order_id = ANY($1::uuid[])
    `, [orderIds]),
    db.query(`
      SELECT pi.order_item_id, pi.quantity,
             p.id AS parcel_id, p.reference AS parcel_reference,
             p.status::text AS parcel_status, p.relais_id, p.customs_cleared_at,
             EXISTS (
               SELECT 1
                 FROM customs_shipment_parcels csp
                 JOIN customs_shipments cs ON cs.id = csp.shipment_id
                WHERE csp.parcel_id = p.id
                  AND cs.is_active = TRUE
                  AND cs.status::text = 'confirmed'
             ) AS customs_confirmed
        FROM parcel_items pi
        JOIN parcels p ON p.id = pi.parcel_id
       WHERE p.order_id = ANY($1::uuid[])
         AND p.status::text <> 'cancelled'
    `, [orderIds]),
    db.query(`
      SELECT a.order_id, a.order_item_id, u.id AS unit_id,
             u.reference AS unit_reference, u.unit_type,
             u.state::text AS unit_state, SUM(pl.quantity)::int AS quantity
        FROM hub_purchase_allocations a
        JOIN hub_physical_unit_placements pl ON pl.allocation_id = a.id
        JOIN hub_physical_units u ON u.id = pl.physical_unit_id
       WHERE a.order_id = ANY($1::uuid[])
         AND pl.removed_at IS NULL
       GROUP BY a.order_id, a.order_item_id, u.id, u.reference, u.unit_type, u.state
    `, [orderIds]),
    db.query(`
      SELECT i.id, COALESCE(i.order_id, p.order_id) AS order_id,
             i.incident_type, i.severity,
             COALESCE(i.details->>'reason_code', i.details->>'type', i.incident_type) AS reason_code
        FROM incidents i
        LEFT JOIN parcels p ON p.id = i.parcel_id
       WHERE i.status IN ('open','investigating')
         AND COALESCE(i.order_id, p.order_id) = ANY($1::uuid[])
    `, [orderIds]),
    db.query(`
      SELECT s.id, s.signal_ref, s.signal_type, s.severity,
             CASE
               WHEN s.entity_type = 'order' THEN s.entity_id::text
               WHEN s.entity_type = 'parcel' THEN p.order_id::text
               ELSE NULL
             END AS order_id
        FROM signals s
        LEFT JOIN parcels p
          ON s.entity_type = 'parcel' AND p.id::text = s.entity_id::text
       WHERE s.status IN ('open','acknowledged','snoozed')
         AND s.market_id = $1
         AND s.entity_type IN ('order','parcel')
    `, [marketId]),
  ]);

  const itemsByOrder = indexBy(items.rows, 'order_id');
  const purchaseByOrder = indexBy(purchase.rows, 'order_id');
  const parcelsByItem = indexBy(parcels.rows, 'order_item_id');
  const hubByOrder = indexBy(hub.rows, 'order_id');
  const incidentsByOrder = indexBy(incidents.rows, 'order_id');
  const signalsByOrder = indexBy(signals.rows, 'order_id');

  const projectedOrders = orders.map(order => {
    const orderItems = itemsByOrder.get(String(order.id)) || [];
    const orderPurchase = purchaseByOrder.get(String(order.id)) || [];
    const orderHub = hubByOrder.get(String(order.id)) || [];
    const orderParcels = orderItems.flatMap(item => parcelsByItem.get(String(item.id)) || []);
    const health = deriveHealth({
      incidents: incidentsByOrder.get(String(order.id)) || [],
      signals: signalsByOrder.get(String(order.id)) || [],
    });
    const branches = orderItems.map(item => {
      const segments = allocateSegments(item.quantity, item, {
        order, purchase: orderPurchase,
        parcels: parcelsByItem.get(String(item.id)) || [],
        hub: orderHub,
      });
      return {
        order_item_id: item.id,
        quantity: positiveInt(item.quantity, 1),
        fulfillment_source: item.fulfillment_source || null,
        current_stage: earliestStage(segments.map(segment => segment.stage), 'ORDER'),
        segments,
      };
    });
    return {
      order_id: order.id,
      order_reference: order.reference,
      current_stage: deriveOrderStage({
        order, items: orderItems, purchase: orderPurchase, parcels: orderParcels, hub: orderHub,
      }),
      health: health.health,
      reason_code: health.reason_code,
      reason_source: health.source,
      reason_ref: health.ref,
      branches,
    };
  });

  return {
    scope,
    stages: STAGES.map(key => ({
      key,
      orders: projectedOrders.filter(row => row.current_stage === key).map(row => ({
        order_id: row.order_id,
        order_reference: row.order_reference,
        health: row.health,
        reason_code: row.reason_code,
      })),
    })),
    orders: projectedOrders,
    generated_at: new Date().toISOString(),
  };
}

module.exports = {
  STAGES, STAGE_RANK, HEALTH,
  positiveInt, stageRank, earliestStage,
  stageForParcel, stageForHubState, stageForPurchaseProgress,
  severityHealth, deriveHealth, allocateSegments, deriveOrderStage,
  buildMarketControlTower,
};
