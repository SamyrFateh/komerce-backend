/**
 * @komerce-arch
 * @role          order-physical-coverage-service
 * @domain        logistics
 * @layer         service
 * @criticality   critical
 * @inputs        order id, db executor
 * @outputs       couverture physique quantitative par ligne attendue, verdict fail-closed
 * @depends       none
 * @used-by       services/order-status-machine.js
 * @db-read       orders, order_items, v_purchase_line_progress
 * @db-write      none
 * @db-txn        caller-owned
 * @doctrine      physical_coverage_before_preparation, fail_closed_without_physical_proof, single_reception_definition
 * @impact-areas  orders, logistics, purchasing
 * @version       2026-10
 */
'use strict';

/**
 * Une commande réelle (simulation_scope IS NULL) n'entre en `preparation` que si, pour CHAQUE ligne
 * attendue (fulfillment_source ≠ LOCAL_STOCK), la quantité physique utilisable reçue au hub couvre la
 * quantité commandée. « Utilisable » = définition unique de v_purchase_line_progress.received_quantity
 * (placements actifs, hors QUARANTINED/SUPERSEDED et outcome LOST/STOLEN/DESTROYED/DAMAGED_UNUSABLE).
 * Une ligne sans aucune ligne d'achat / PO a une couverture de 0 : refus (jamais d'inférence).
 * Les commandes de simulation (RCT1) ne portent pas de flux physique : hors périmètre du gate.
 */
async function getOrderPhysicalCoverage(executor, orderId) {
  const { rows } = await executor.query(
    `SELECT oi.id AS order_item_id,
            oi.quantity::int AS needed,
            COALESCE(v.rcv, 0)::int AS usable
       FROM orders o
       JOIN order_items oi ON oi.order_id = o.id AND COALESCE(oi.fulfillment_source, '') <> 'LOCAL_STOCK'
       LEFT JOIN LATERAL (
              SELECT SUM(p.received_quantity) FILTER (WHERE NOT p.cancelled) AS rcv
                FROM v_purchase_line_progress p
               WHERE p.order_item_id = oi.id
            ) v ON TRUE
      WHERE o.id = $1 AND o.simulation_scope IS NULL`,
    [orderId]
  );
  const lines = (rows || []).map((r) => ({
    order_item_id: r.order_item_id,
    needed: Number(r.needed),
    usable: Number(r.usable),
    missing: Math.max(0, Number(r.needed) - Number(r.usable)),
  }));
  const uncovered = lines.filter((l) => l.missing > 0);
  return { covered: uncovered.length === 0, lines, uncovered };
}

module.exports = { getOrderPhysicalCoverage };
