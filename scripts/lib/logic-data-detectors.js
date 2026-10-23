'use strict';

/**
 * @komerce-arch
 * @role          readonly-business-invariant-data-detectors
 * @domain        infrastructure
 * @layer         tooling
 * @criticality   high
 * @inputs        pg client inside BEGIN READ ONLY, canonical order/parcel/refund tables
 * @outputs       bounded anomaly-reference samples (not business certification)
 * @depends       db.js, canonical PostgreSQL schema
 * @used-by       scripts/audit-logic.js, tests/unit/logic-data-detectors.test.js
 * @db-read       inventory_items, parcel_items, parcels, orders, order_items, scan_events, users, refunds
 * @db-write      none
 * @db-txn        transaction READ ONLY enforced by caller
 * @doctrine      multi_market_isolation, invariant_executable_non_speculatif
 *
 * Reconstructed from Opus transcript; do not infer a blanket prohibition on
 * multi-order parcels: sharing is allowed within the same market and relay.
 * Matches are ANOMALIES TO VERIFY, not definitive proof of a runtime bug.
 */
const RULES = Object.freeze([
  {
    "rule": "LD-01",
    "category": "DAT",
    "priority": "P1",
    "title": "Inventaire affecté sans appartenance au colis",
    "sql": "SELECT ii.id::text AS ref FROM inventory_items ii WHERE ii.parcel_id IS NOT NULL AND ii.order_item_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM parcel_items pi WHERE pi.parcel_id=ii.parcel_id AND pi.order_item_id=ii.order_item_id) ORDER BY ii.id LIMIT $1"
  },
  {
    "rule": "LD-02a",
    "category": "SEC",
    "priority": "P1",
    "title": "Colis contenant une ligne d un autre marché",
    "sql": "SELECT pi.id::text AS ref FROM parcel_items pi JOIN parcels p ON p.id=pi.parcel_id JOIN orders po ON po.id=p.order_id JOIN order_items oi ON oi.id=pi.order_item_id JOIN orders lo ON lo.id=oi.order_id WHERE po.market_id IS NOT NULL AND lo.market_id IS NOT NULL AND po.market_id<>lo.market_id ORDER BY pi.id LIMIT $1"
  },
  {
    "rule": "LD-02b",
    "category": "LOG",
    "priority": "P1",
    "title": "Ligne dont le relais de commande diffère du colis",
    "sql": "SELECT pi.id::text AS ref FROM parcel_items pi JOIN parcels p ON p.id=pi.parcel_id JOIN order_items oi ON oi.id=pi.order_item_id JOIN orders lo ON lo.id=oi.order_id WHERE COALESCE(p.relais_id,p.relay_id) IS NOT NULL AND lo.relais_id IS NOT NULL AND COALESCE(p.relais_id,p.relay_id)<>lo.relais_id ORDER BY pi.id LIMIT $1"
  },
  {
    "rule": "LD-03",
    "category": "WF",
    "priority": "P1",
    "title": "Appartenance ajoutée après expédition",
    "sql": "SELECT pi.id::text AS ref FROM parcel_items pi JOIN parcels p ON p.id=pi.parcel_id WHERE p.shipped_at IS NOT NULL AND pi.created_at>p.shipped_at ORDER BY pi.id LIMIT $1"
  },
  {
    "rule": "LD-04",
    "category": "WF",
    "priority": "P1",
    "title": "Commande collected avec ligne due non remise",
    "sql": "SELECT o.id::text AS ref FROM orders o WHERE o.status='collected' AND EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id=o.id AND oi.quantity>COALESCE((SELECT SUM(pi.qty_collected) FROM parcel_items pi WHERE pi.order_item_id=oi.id),0)) ORDER BY o.id LIMIT $1"
  },
  {
    "rule": "LD-05",
    "category": "SEC",
    "priority": "P1",
    "title": "Remise par agent hors relais d affectation",
    "sql": "SELECT se.id::text AS ref FROM scan_events se JOIN parcels p ON p.id=se.parcel_id JOIN users u ON u.id=se.scanned_by WHERE se.status='applied' AND se.event_type='customer_collected' AND se.actor_role='relay_agent' AND u.relais_id IS NOT NULL AND COALESCE(p.relais_id,p.relay_id) IS NOT NULL AND u.relais_id<>COALESCE(p.relais_id,p.relay_id) ORDER BY se.id LIMIT $1"
  },
  {
    "rule": "LD-06",
    "category": "FIN",
    "priority": "P1",
    "title": "Remise appliquée sans paiement confirmé (état courant pending)",
    "sql": "SELECT se.id::text AS ref FROM scan_events se JOIN orders o ON o.id=COALESCE(se.order_id,(SELECT p.order_id FROM parcels p WHERE p.id=se.parcel_id)) WHERE se.status='applied' AND se.event_type='customer_collected' AND o.payment_status='pending' ORDER BY se.id LIMIT $1"
  },
  {
    "rule": "LD-07a",
    "category": "FIN",
    "priority": "P2",
    "title": "Remboursement en attente depuis plus de 48 h, rapprochement PSP requis",
    "sql": "SELECT r.id::text AS ref FROM refunds r WHERE r.status='pending' AND r.created_at<CURRENT_TIMESTAMP-INTERVAL '48 hours' ORDER BY r.id LIMIT $1"
  },
  {
    "rule": "LD-07b",
    "category": "FIN",
    "priority": "P1",
    "title": "Commande refunded alors que les remboursements completed restent partiels",
    "sql": "SELECT o.id::text AS ref FROM orders o WHERE o.payment_status='refunded' AND COALESCE((SELECT SUM(r.amount_kmf) FROM refunds r WHERE r.order_id=o.id AND r.status='completed'),0)<o.total_kmf ORDER BY o.id LIMIT $1"
  }
]);

function validateReadOnlySql(sql) {
  const s = String(sql).trim();
  return /^SELECT\b/i.test(s)
    && !/\b(?:INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP|CREATE|MERGE|GRANT|REVOKE|COPY|CALL|DO)\b/i.test(s)
    && !s.includes(';');
}
async function runDataRules(client, options = {}) {
  if (!client || typeof client.query !== 'function') throw new Error('Un client PostgreSQL est requis');
  const sampleSize = options.sampleSize === undefined ? 20 : Number(options.sampleSize);
  if (!Number.isInteger(sampleSize) || sampleSize < 1 || sampleSize > 100) {
    throw new Error('sampleSize doit être un entier compris entre 1 et 100');
  }
  const results = [];
  for (const rule of RULES) {
    if (!validateReadOnlySql(rule.sql)) throw new Error('SQL non sûr pour ' + rule.rule);
    const response = await client.query(rule.sql, [sampleSize + 1]);
    const rows = response.rows || [];
    results.push({
      rule: rule.rule, title: rule.title, category: rule.category, priority: rule.priority,
      status: rows.length ? 'ANOMALIE_DONNEES_A_VERIFIER' : 'AUCUNE_ANOMALIE_DETECTEE',
      samples: rows.slice(0, sampleSize).map(row => String(row.ref)),
      sampleTruncated: rows.length > sampleSize, detectedAtLeast: rows.length,
      exhaustiveCount: false,
    });
  }
  return results;
}
module.exports = { RULES, validateReadOnlySql, runDataRules };
