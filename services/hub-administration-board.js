/**
 * @komerce-arch
 * @role          hub-administration-board-reader
 * @domain        purchasing
 * @layer         service
 * @criticality   high
 * @inputs        canonical market procurement dossiers, supplier payment evidence
 * @outputs       all-market PO administration read model
 * @depends       db, services/hub-procurement-dossier.js
 * @used-by       routes/hub.js
 * @db-read       markets, orders, purchase_orders, purchase_lines, supplier_execution_payments
 * @db-write      none
 * @db-txn        none
 * @doctrine      one_po_one_supplier_one_market, supplier_payment_authorization_distinct_from_debit
 * @impact-areas  purchasing, hub, admin-dashboard
 * @version       2026-11-v1
 */
'use strict';

const db = require('../db');
const dossier = require('./hub-procurement-dossier');

const number = value => Math.max(0, Number(value) || 0);

// Fold a market dossier into unique supplier PO cards. An old cross-market PO
// stays labeled as such; we never silently assign its lines to one market.
function gatherPurchaseOrders(marketsAndDossiers) {
  const pos = new Map();
  for (const { market, payload } of marketsAndDossiers) {
    for (const po of payload.purchase_orders || []) {
      let entry = pos.get(po.id);
      if (!entry) {
        entry = {
          id: po.id, supplier: po.supplier_name || 'Fournisseur non renseigné',
          status: po.status, stage: po.stage, sent_at: po.sent_at || null,
          sent_channel: po.sent_channel || null,
          created_at: po.created_at || null,
          markets: new Set(), orders: new Set(), lineIds: new Set(),
          expected: 0, received: 0, anomalies: 0,
        };
        pos.set(po.id, entry);
      }
      entry.markets.add(market.code);
      // The same line may be projected more than once in a legacy dossier.
      for (const line of po.lines || []) {
        if (entry.lineIds.has(line.line_id)) continue;
        entry.lineIds.add(line.line_id);
        if (line.order_id) entry.orders.add(line.order_id);
        entry.expected += number(line.confirmed || line.ordered);
        entry.received += number(line.received);
        entry.anomalies += number(line.anomaly);
      }
    }
  }
  return [...pos.values()].map(po => ({
    id: po.id, supplier: po.supplier, status: po.status, stage: po.stage,
    sent_at: po.sent_at, sent_channel: po.sent_channel, created_at: po.created_at,
    market: [...po.markets].sort().join(' · '),
    multi_market_legacy: po.markets.size > 1,
    order_count: po.orders.size,
    expected: po.expected, received: po.received, anomalies: po.anomalies,
    // No canonical director commitment approval fact is present in these dossiers.
    // "not recorded" is not the same as "rejected" or "pending".
    commitment_authorization: 'Non tracée',
    payment_authorization: 'Non tracée',
    payment_evidence: 'Aucune preuve de débit',
    payment_count: 0, verified_debit_count: 0,
  })).sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')) || a.id.localeCompare(b.id));
}

function attachPaymentEvidence(orders, evidenceRows) {
  const byPO = new Map((evidenceRows || []).map(row => [String(row.purchase_order_id), row]));
  return orders.map(po => {
    const row = byPO.get(String(po.id));
    const payments = number(row && row.payment_count);
    const verified = number(row && row.verified_debit_count);
    return {
      ...po,
      payment_count: payments,
      verified_debit_count: verified,
      payment_evidence: !payments ? 'Aucune preuve de débit' :
        !verified ? 'Débit à rapprocher' :
          verified < payments ? 'Débit partiellement vérifié' : 'Débit constaté',
    };
  });
}

async function getAdministrationBoard(query = db,
  dossierReader = (marketId) => dossier.getDossier({marketId}, query)) {
  const {rows: markets} = await query.query(
    'SELECT id, code, name FROM markets WHERE is_active = TRUE ORDER BY code'
  );
  const result = [];
  for (const market of markets) {
    result.push({ market, payload: await dossierReader(market.id) });
  }
  const pos = gatherPurchaseOrders(result);
  const ids = pos.map(po => po.id);
  const { rows: evidence } = ids.length ? await query.query(
    `SELECT purchase_order_id, COUNT(*)::int AS payment_count,
             COUNT(*) FILTER (WHERE real_debit_verified IS TRUE)::int AS verified_debit_count
        FROM supplier_execution_payments
       WHERE purchase_order_id = ANY($1::uuid[])
       GROUP BY purchase_order_id`, [ids]
  ) : { rows: [] };
  const purchaseOrders = attachPaymentEvidence(pos, evidence);
  return {
    scope: 'HUB_ADMINISTRATION_GLOBAL',
    markets: markets.map(m => m.code),
    approval_trace_available: false,
    kpis: {
      purchase_orders: purchaseOrders.length,
      drafts: purchaseOrders.filter(p => p.stage === 'draft').length,
      to_send: purchaseOrders.filter(p => p.stage === 'issued_not_sent').length,
      supplier_waiting: purchaseOrders.filter(p => p.stage === 'sent').length,
      payment_to_reconcile: purchaseOrders.filter(p => p.payment_count > p.verified_debit_count).length,
    },
    purchase_orders: purchaseOrders,
  };
}

module.exports = { gatherPurchaseOrders, attachPaymentEvidence, getAdministrationBoard };
