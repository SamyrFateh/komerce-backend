#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          purchase-lines-parity-check
 * @domain        purchasing
 * @layer         script
 * @criticality   high
 * @inputs        purchase_orders, purchase_lines, order_items
 * @outputs       exit_code, rapport_console
 * @depends       db
 * @used-by       npm run purchase-lines:parity
 * @db-read       purchase_orders, purchase_lines, order_items
 * @db-write      @none
 * @db-txn        @none
 * @doctrine      docs/doctrine/DOCTRINE_PROCUREMENT_FULFILLMENT.md
 * @impact-areas  purchasing
 * @version       2026-10
 */

'use strict';

// Contrôle de parité PR 1 : tant que les PO historiques coexistent avec purchase_lines (1 PO = 1 ligne),
// aucune des quatre divergences ci-dessous ne doit exister. Les PO regroupées (order_id NULL, PR 4) n'ont pas
// de parité 1:1 : seules les PO historiques sont comparées, le sur-engagement (I1) vaut pour toutes les lignes. Lecture seule ; exit 1 si une divergence est trouvée.

const CHECKS = [
  {
    code: 'active_po_without_line',
    label: 'PO active rattachée à un order_item sans ligne d\'achat',
    sql: `SELECT po.id FROM purchase_orders po
           WHERE po.order_item_id IS NOT NULL AND po.status <> 'cancelled'
             AND NOT EXISTS (SELECT 1 FROM purchase_lines pl WHERE pl.purchase_order_id = po.id)`,
  },
  {
    code: 'quantity_mismatch',
    label: 'quantité de la ligne différente de la quantité de sa PO',
    sql: `SELECT po.id FROM purchase_orders po JOIN purchase_lines pl ON pl.purchase_order_id = po.id
           WHERE po.order_id IS NOT NULL AND pl.quantity <> po.qty`,
  },
  {
    code: 'cancel_mismatch',
    label: 'PO annulée dont la ligne n\'est pas annulée (ou l\'inverse)',
    sql: `SELECT po.id FROM purchase_orders po JOIN purchase_lines pl ON pl.purchase_order_id = po.id
           WHERE po.order_id IS NOT NULL AND (po.status = 'cancelled') <> (pl.cancelled_at IS NOT NULL)`,
  },
  {
    code: 'overcommitted_item',
    label: 'order_item dont la quantité effective achetée dépasse la quantité commandée',
    sql: `SELECT oi.id FROM order_items oi
            JOIN purchase_lines pl ON pl.order_item_id = oi.id
           GROUP BY oi.id, oi.quantity
          HAVING SUM(purchase_line_effective_quantity(pl.cancelled_at, pl.settled_quantity, pl.confirmed_quantity, pl.quantity)) > oi.quantity`,
  },
];

async function runParityChecks(query) {
  const report = [];
  for (const check of CHECKS) {
    const { rows } = await query(check.sql);
    report.push({ code: check.code, label: check.label, count: rows.length, ids: rows.slice(0, 20).map((r) => r.id) });
  }
  return { ok: report.every((r) => r.count === 0), report };
}

async function main(db = require('../db')) {
  const { ok, report } = await runParityChecks((sql) => db.query(sql));
  for (const r of report) console.log(`${r.count === 0 ? 'OK ' : 'KO '} ${r.code} (${r.count}) — ${r.label}${r.count ? ` ex: ${r.ids.join(',')}` : ''}`);
  return ok ? 0 : 1;
}

if (require.main === module) {
  main().then((code) => process.exit(code)).catch((err) => { console.error(err); process.exit(2); });
}

module.exports = { CHECKS, runParityChecks, main };
