/**
 * @komerce-arch
 * @role          hub-procurement-dossier
 * @domain        logistics
 * @layer         service
 * @criticality   high
 * @inputs        market_id, optional_supplier_id, order_or_purchase_order_id
 * @outputs       market_procurement_dossier, physical_trace
 * @depends       db
 * @used-by       routes/hub.js
 * @db-read       markets, orders, order_items, products, suppliers, purchase_lines, purchase_orders, v_purchase_line_progress, hub_purchase_allocations, hub_physical_units, hub_physical_unit_placements, international_shipments, international_shipment_hub_units
 * @db-write      (none)
 * @db-txn        @none
 * @doctrine      une décision, une autorité, un enregistrement ; projection en lecture seule, aucune seconde source de vérité
 * @impact-areas  logistics, purchasing, market
 * @version       2026-11
 */

'use strict';

const db = require('../db');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HOUR = 3600 * 1000;
const ISSUED_NOT_SENT_AFTER_H = 24;
const SENT_NOT_CONFIRMED_AFTER_H = 72;

function failure(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

async function resolveMarket(marketRef, q = db) {
  const ref = String(marketRef || '').trim();
  if (!ref) throw failure(400, 'MARKET_REQUIRED', 'Un marché est obligatoire');
  const { rows: [market] } = UUID_RE.test(ref)
    ? await q.query('SELECT id, code, name FROM markets WHERE id = $1', [ref])
    : await q.query('SELECT id, code, name FROM markets WHERE UPPER(code) = UPPER($1)', [ref]);
  if (!market) throw failure(404, 'MARKET_NOT_FOUND', 'Marché introuvable');
  return market;
}

// Étape métier dérivée, jamais stockée.
function poStage(po, totals) {
  if (po.status === 'cancelled') return 'cancelled';
  if (po.status === 'draft') return 'draft';
  if (po.status === 'notified') return po.sent_at ? 'sent' : 'issued_not_sent';
  if (totals.effective > 0 && totals.received >= totals.effective) return 'received';
  if (totals.received > 0) return 'partially_received';
  return 'confirmed';
}

async function getDossier({ marketId, supplierId = null, now = new Date() }, q = db) {
  const { rows: needsRows } = await q.query(`
    SELECT pl.id AS line_id, pl.supplier_id, s.name AS supplier_name, pl.product_sku_id, pl.supplier_sku,
           p.name AS product_name, pl.quantity, oi.order_id, o.reference AS order_ref, pl.order_item_id, pl.created_at
      FROM purchase_lines pl
      JOIN order_items oi ON oi.id = pl.order_item_id
      JOIN orders o ON o.id = oi.order_id
      JOIN suppliers s ON s.id = pl.supplier_id
      LEFT JOIN products p ON p.id = oi.product_id
     WHERE o.market_id = $1 AND pl.purchase_order_id IS NULL AND pl.cancelled_at IS NULL
       AND ($2::uuid IS NULL OR pl.supplier_id = $2::uuid)
     ORDER BY s.name, pl.created_at, pl.id`, [marketId, supplierId]);

  const { rows: poRows } = await q.query(`
    SELECT po.id AS po_id, po.status, po.sent_at, po.sent_channel, po.supplier_order_id, po.supplier_id,
           s.name AS supplier_name, po.procurement_hub_ref, po.created_at, po.updated_at, po.ordered_at,
           pl.id AS line_id, pl.order_item_id, oi.order_id, o.reference AS order_ref, p.name AS product_name,
           pl.product_sku_id, pl.quantity AS ordered, vp.effective_quantity AS effective, vp.received_quantity AS received
      FROM purchase_orders po
      JOIN suppliers s ON s.id = po.supplier_id
      JOIN purchase_lines pl ON pl.purchase_order_id = po.id AND pl.cancelled_at IS NULL
      JOIN v_purchase_line_progress vp ON vp.line_id = pl.id
      JOIN order_items oi ON oi.id = pl.order_item_id
      JOIN orders o ON o.id = oi.order_id
      LEFT JOIN products p ON p.id = oi.product_id
     WHERE o.market_id = $1 AND ($2::uuid IS NULL OR po.supplier_id = $2::uuid)
     ORDER BY po.created_at DESC, po.id, pl.id`, [marketId, supplierId]);

  const lineIds = poRows.map((r) => r.line_id);
  const anomalyByLine = new Map();
  if (lineIds.length) {
    const { rows } = await q.query(`
      SELECT a.purchase_line_id AS line_id, SUM(p.quantity)::int AS qty
        FROM hub_purchase_allocations a
        JOIN hub_physical_unit_placements p ON p.allocation_id = a.id AND p.removed_at IS NULL
        JOIN hub_physical_units u ON u.id = p.physical_unit_id
       WHERE a.purchase_line_id = ANY($1::uuid[]) AND (u.state = 'QUARANTINED' OR u.outcome_type IS NOT NULL)
       GROUP BY a.purchase_line_id`, [lineIds]);
    rows.forEach((r) => anomalyByLine.set(r.line_id, Number(r.qty)));
  }

  const pos = new Map();
  for (const r of poRows) {
    if (!pos.has(r.po_id)) {
      pos.set(r.po_id, {
        id: r.po_id, status: r.status, supplier_id: r.supplier_id, supplier_name: r.supplier_name,
        procurement_hub_ref: r.procurement_hub_ref, sent_at: r.sent_at, sent_channel: r.sent_channel,
        supplier_order_id: r.supplier_order_id, created_at: r.created_at, updated_at: r.updated_at, ordered_at: r.ordered_at,
        lines: [],
      });
    }
    const effective = Number(r.effective || 0);
    const received = Number(r.received || 0);
    pos.get(r.po_id).lines.push({
      line_id: r.line_id, order_id: r.order_id, order_ref: r.order_ref, order_item_id: r.order_item_id,
      product: r.product_name, product_sku_id: r.product_sku_id,
      ordered: Number(r.ordered), confirmed: effective, received, missing: Math.max(effective - received, 0),
      anomaly: anomalyByLine.get(r.line_id) || 0,
    });
  }
  const purchaseOrders = [...pos.values()].map((po) => {
    const totals = po.lines.reduce((t, l) => ({
      effective: t.effective + l.confirmed, received: t.received + l.received,
      missing: t.missing + l.missing, anomaly: t.anomaly + l.anomaly,
    }), { effective: 0, received: 0, missing: 0, anomaly: 0 });
    return { ...po, stage: poStage(po, totals), totals };
  });

  const { rows: receiptRows } = await q.query(`
    SELECT u.id, u.reference, u.external_ref, u.state, u.created_at,
           ARRAY_AGG(DISTINCT a.purchase_order_id) AS po_ids, SUM(p.quantity)::int AS qty
      FROM hub_physical_units u
      JOIN hub_physical_unit_placements p ON p.physical_unit_id = u.id AND p.operation_type = 'RECEIVE'
      JOIN hub_purchase_allocations a ON a.id = p.allocation_id
     WHERE a.market_id = $1 AND u.unit_type = 'SUPPLIER_PACKAGE'
     GROUP BY u.id ORDER BY u.created_at DESC LIMIT 100`, [marketId]);

  const { rows: boxRows } = await q.query(`
    SELECT u.id AS unit_id, u.reference, u.state, u.market_id, sh.reference AS shipment_ref, sh.stage AS shipment_stage,
           a.order_id, o.reference AS order_ref, a.purchase_line_id, p.quantity
      FROM hub_physical_units u
      JOIN hub_physical_unit_placements p ON p.physical_unit_id = u.id AND p.removed_at IS NULL
      JOIN hub_purchase_allocations a ON a.id = p.allocation_id
      JOIN orders o ON o.id = a.order_id
      LEFT JOIN international_shipment_hub_units hs ON hs.physical_unit_id = u.id
      LEFT JOIN international_shipments sh ON sh.id = hs.shipment_id
     WHERE u.unit_type = 'MARKET_PARCEL' AND a.market_id = $1
     ORDER BY u.created_at DESC, u.id`, [marketId]);
  const boxes = new Map();
  for (const r of boxRows) {
    if (!boxes.has(r.unit_id)) {
      boxes.set(r.unit_id, { unit_id: r.unit_id, reference: r.reference, state: r.state, shipment_ref: r.shipment_ref || null,
        shipment_stage: r.shipment_stage || null, contents: [] });
    }
    boxes.get(r.unit_id).contents.push({ order_id: r.order_id, order_ref: r.order_ref, line_id: r.purchase_line_id, qty: Number(r.quantity) });
  }

  // Expéditions encore ouvertes (hub_ready) du marché : cibles de rattachement proposées au Hub, sans ressaisie.
  const { rows: shipmentRows } = await q.query(
    `SELECT s.reference, s.forwarder_name, s.transport_mode,
            (SELECT COUNT(*)::int FROM international_shipment_hub_units h WHERE h.shipment_id = s.id) AS box_count
       FROM international_shipments s WHERE s.market_id = $1 AND s.stage = 'hub_ready'
      ORDER BY s.created_at DESC LIMIT 50`, [marketId]);

  const hoursSince = (date) => (date ? (now.getTime() - new Date(date).getTime()) / HOUR : 0);
  const toHandle = [];
  for (const po of purchaseOrders) {
    if (po.stage === 'issued_not_sent' && hoursSince(po.ordered_at || po.updated_at) > ISSUED_NOT_SENT_AFTER_H) {
      toHandle.push({ kind: 'PO_ISSUED_NOT_SENT', po_id: po.id, supplier_name: po.supplier_name, reason: `Bon émis depuis plus de ${ISSUED_NOT_SENT_AFTER_H} h, envoi non enregistré` });
    }
    if (po.stage === 'sent' && hoursSince(po.sent_at) > SENT_NOT_CONFIRMED_AFTER_H) {
      toHandle.push({ kind: 'PO_SENT_UNCONFIRMED', po_id: po.id, supplier_name: po.supplier_name, reason: `Envoyée depuis plus de ${SENT_NOT_CONFIRMED_AFTER_H} h, sans confirmation` });
    }
    if (['confirmed', 'partially_received'].includes(po.stage) && po.totals.missing > 0 && po.status !== 'draft') {
      toHandle.push({ kind: 'PO_MISSING_QTY', po_id: po.id, supplier_name: po.supplier_name, reason: `${po.totals.missing} unité(s) confirmée(s) non reçue(s)` });
    }
  }
  for (const r of receiptRows) {
    if (r.state === 'QUARANTINED') toHandle.push({ kind: 'UNIT_QUARANTINED', unit_id: r.id, reason: `Colis ${r.reference} en quarantaine` });
  }
  for (const b of boxes.values()) {
    if (['PACKED'].includes(b.state) && !b.shipment_ref) toHandle.push({ kind: 'BOX_UNSHIPPED', unit_id: b.unit_id, reason: `Carton ${b.reference} emballé, sans expédition` });
  }

  const count = (stage) => purchaseOrders.filter((po) => po.stage === stage).length;
  return {
    market_id: marketId,
    generated_at: now.toISOString(),
    kpis: {
      orders_waiting: new Set(needsRows.map((r) => r.order_id)).size,
      lines_open: needsRows.length,
      po_draft: count('draft'),
      po_issued_not_sent: count('issued_not_sent'),
      po_sent_unconfirmed: count('sent'),
      qty_missing: purchaseOrders.reduce((s, po) => s + po.totals.missing, 0),
      qty_anomaly: purchaseOrders.reduce((s, po) => s + po.totals.anomaly, 0),
      boxes_open: [...boxes.values()].filter((b) => !['DISPATCHED'].includes(b.state)).length,
      boxes_unshipped: [...boxes.values()].filter((b) => !b.shipment_ref).length,
    },
    needs: needsRows,
    purchase_orders: purchaseOrders,
    receipts: receiptRows.map((r) => ({ id: r.id, reference: r.reference, external_ref: r.external_ref, state: r.state,
      received_at: r.created_at, po_ids: r.po_ids, qty: Number(r.qty) })),
    boxes: [...boxes.values()],
    open_shipments: shipmentRows,
    to_handle: toHandle,
  };
}

// Filiation complète d'une commande ou d'une PO :
//   commande → order_item → ligne d'achat → PO → réception → allocation → carton → expédition.
async function getTrace({ orderId = null, purchaseOrderId = null, allowedMarketIds = null }, q = db) {
  if (!orderId && !purchaseOrderId) throw failure(400, 'TRACE_KEY_REQUIRED', 'order_id ou po_id est obligatoire');
  for (const [name, value] of [['order_id', orderId], ['po_id', purchaseOrderId]]) {
    if (value && !UUID_RE.test(String(value))) throw failure(400, 'HUB_OPERATOR_UUID_INVALID', `${name} doit être un UUID valide`);
  }
  const { rows } = await q.query(`
    SELECT oi.id AS order_item_id, oi.order_id, o.reference AS order_ref, o.market_id, p.name AS product_name,
           pl.id AS line_id, pl.quantity AS ordered, pl.purchase_order_id, po.status AS po_status, po.sent_at,
           po.sent_channel, po.supplier_order_id,
           a.id AS allocation_id, pu.quantity AS placed, pu.operation_type, pu.removed_at,
           u.id AS unit_id, u.reference AS unit_ref, u.unit_type, u.state AS unit_state, u.external_ref,
           sh.id AS shipment_id, sh.reference AS shipment_ref, sh.stage AS shipment_stage
      FROM purchase_lines pl
      JOIN order_items oi ON oi.id = pl.order_item_id
      JOIN orders o ON o.id = oi.order_id
      LEFT JOIN products p ON p.id = oi.product_id
      LEFT JOIN purchase_orders po ON po.id = pl.purchase_order_id
      LEFT JOIN hub_purchase_allocations a ON a.purchase_line_id = pl.id
      LEFT JOIN hub_physical_unit_placements pu ON pu.allocation_id = a.id
      LEFT JOIN hub_physical_units u ON u.id = pu.physical_unit_id
      LEFT JOIN international_shipment_hub_units hs ON hs.physical_unit_id = u.id
      LEFT JOIN international_shipments sh ON sh.id = hs.shipment_id
     WHERE pl.cancelled_at IS NULL
       AND ($1::uuid IS NULL OR oi.order_id = $1::uuid)
       AND ($2::uuid IS NULL OR pl.purchase_order_id = $2::uuid)
       AND ($3::uuid[] IS NULL OR o.market_id = ANY($3::uuid[]))
     ORDER BY oi.order_id, oi.id, pl.id, pu.placed_at`, [orderId, purchaseOrderId, allowedMarketIds]);

  const items = new Map();
  for (const r of rows) {
    const key = `${r.order_item_id}|${r.line_id}`;
    if (!items.has(key)) {
      items.set(key, {
        order_id: r.order_id, order_ref: r.order_ref, market_id: r.market_id, order_item_id: r.order_item_id,
        product: r.product_name, purchase_line_id: r.line_id, ordered: Number(r.ordered),
        purchase_order: r.purchase_order_id ? { id: r.purchase_order_id, status: r.po_status, sent_at: r.sent_at,
          sent_channel: r.sent_channel, supplier_order_id: r.supplier_order_id } : null,
        placements: [],
      });
    }
    if (r.unit_id) {
      items.get(key).placements.push({
        allocation_id: r.allocation_id, quantity: Number(r.placed), operation: r.operation_type, active: !r.removed_at,
        unit: { id: r.unit_id, reference: r.unit_ref, type: r.unit_type, state: r.unit_state, external_ref: r.external_ref },
        shipment: r.shipment_id ? { id: r.shipment_id, reference: r.shipment_ref, stage: r.shipment_stage } : null,
      });
    }
  }
  return { order_id: orderId, purchase_order_id: purchaseOrderId, chain: [...items.values()] };
}

module.exports = { resolveMarket, getDossier, getTrace, poStage };
