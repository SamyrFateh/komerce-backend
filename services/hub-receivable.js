'use strict';

/**
 * @komerce-arch
 * @role          hub-receivable
 * @domain        hub
 * @layer         service
 * @criticality   medium
 * @inputs        db
 * @outputs       receivable_purchase_orders_read_model
 * @depends       db, v_purchase_line_progress
 * @used-by       routes/scans.js
 * @db-read       v_purchase_line_progress, purchase_orders, purchase_lines, product_suppliers, products, suppliers
 * @db-write      none
 * @doctrine      read_model_minimal_for_hub_reception, no_reception_from_supplier_status, quantities_come_from_server
 * @impact-areas  hub, purchasing
 * @version       2026-10
 *
 * Lecture minimale pour la réception physique Hub : uniquement ce qui permet de renseigner
 * `POST /api/scans/hub/receive` (PO, SKU, quantités). Aucun coût, aucun prix, aucun credential.
 * Le statut fournisseur (p. ex. SHIPPED) est informatif : il ne déclenche ni n'autorise aucune réception.
 */

const db = require('../db');

const RECEIVABLE_SQL = `
  SELECT po.id                         AS purchase_order_id,
         po.status                     AS po_status,
         po.supplier_order_id          AS supplier_order_ref,
         po.created_at                 AS created_at,
         CASE WHEN po.order_id IS NULL THEN 'grouped' ELSE 'historical' END AS shape,
         sup.id                        AS supplier_id,
         sup.name                      AS supplier_name,
         pl.product_sku_id             AS product_sku_id,
         COALESCE(p.name, p2.name, '—') AS product_name,
         SUM(v.effective_quantity)::integer AS expected_quantity,
         SUM(v.received_quantity)::integer  AS received_quantity
    FROM v_purchase_line_progress v
    JOIN purchase_orders po          ON po.id = v.purchase_order_id
    LEFT JOIN purchase_lines pl      ON pl.id = v.line_id
    LEFT JOIN product_suppliers ps   ON ps.id = v.product_supplier_id
    LEFT JOIN products p             ON p.id = ps.product_id
    LEFT JOIN product_skus psk       ON psk.id = pl.product_sku_id
    LEFT JOIN products p2            ON p2.id = psk.product_id
    LEFT JOIN suppliers sup          ON sup.id = po.supplier_id
   WHERE NOT v.cancelled
     AND po.status NOT IN ('draft', 'cancelled')
   GROUP BY po.id, po.status, po.supplier_order_id, po.created_at, po.order_id,
            sup.id, sup.name, pl.product_sku_id, p.name, p2.name
  HAVING SUM(v.effective_quantity) > SUM(v.received_quantity)
   ORDER BY po.created_at ASC, COALESCE(p.name, p2.name) ASC
   LIMIT 500`;

function receptionState(expected, received) {
  if (received <= 0) return 'NOT_RECEIVED';
  return received < expected ? 'PARTIAL' : 'COMPLETE';
}

function project(rows) {
  const byPo = new Map();
  for (const row of rows) {
    const expected = Number(row.expected_quantity);
    const received = Number(row.received_quantity);
    let po = byPo.get(row.purchase_order_id);
    if (!po) {
      po = {
        purchase_order_id: row.purchase_order_id,
        shape: row.shape,
        po_status: row.po_status,
        supplier: { id: row.supplier_id || null, name: row.supplier_name || null },
        supplier_order_ref: row.supplier_order_ref || null,
        lines: [],
      };
      byPo.set(row.purchase_order_id, po);
    }
    po.lines.push({
      product_sku_id: row.product_sku_id || null,
      product_name: row.product_name,
      expected_quantity: expected,
      received_quantity: received,
      remaining_quantity: Math.max(expected - received, 0),
      reception_state: receptionState(expected, received),
    });
  }
  return [...byPo.values()];
}

async function listReceivable(executor = db) {
  const { rows } = await executor.query(RECEIVABLE_SQL);
  return Object.freeze({ generated_at: new Date().toISOString(), purchase_orders: project(rows) });
}

module.exports = { listReceivable, project, receptionState, RECEIVABLE_SQL };
