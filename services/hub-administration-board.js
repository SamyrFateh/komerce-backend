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
 * @db-read       hub_authorization_grants, markets, orders, purchase_order_authorizations, purchase_orders, purchase_lines, supplier_execution_payments, users
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
    // Décisions de la directrice (P04) : projetées depuis purchase_order_authorizations par attachAuthorizations.
    // Sans décision, l'état est « À valider » / « À autoriser » : jamais déduit du statut de la PO.
    commitment_authorization: 'À valider',
    payment_authorization: 'À autoriser',
    commitment_decision: null,
    payment_decision: null,
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

const dateLabel = value => value ? new Date(value).toISOString().slice(0, 10) : '';
const decisionOf = row => row && {
  decided_by: row.decided_by, decided_by_name: row.decided_by_name || null, decided_at: row.decided_at,
  amount: Number(row.amount), currency: row.currency, proof_ref: row.proof_ref,
};

/** Rattache les décisions tracées de la directrice ; l'autorisation de paiement n'est proposée qu'après l'engagement. */
function attachAuthorizations(orders, rows) {
  const byPO = new Map();
  for (const row of rows || []) {
    const entry = byPO.get(String(row.purchase_order_id)) || {};
    entry[row.authorization_type] = decisionOf(row);
    byPO.set(String(row.purchase_order_id), entry);
  }
  return orders.map(po => {
    const found = byPO.get(String(po.id)) || {};
    const commitment = found.purchase_commitment || null;
    const payment = found.supplier_payment || null;
    return {
      ...po,
      commitment_decision: commitment,
      payment_decision: payment,
      commitment_authorization: commitment ? 'Validé · ' + dateLabel(commitment.decided_at) : 'À valider',
      payment_authorization: payment ? 'Autorisé · ' + dateLabel(payment.decided_at) :
        commitment ? 'À autoriser' : 'Après engagement',
    };
  });
}

async function getAdministrationBoard(query = db,
  dossierReader = (marketId) => dossier.getDossier({marketId}, query), viewerId = null) {
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
  const { rows: decisions } = ids.length ? await query.query(
    `SELECT a.purchase_order_id, a.authorization_type, a.decided_by, a.decided_at, a.amount, a.currency, a.proof_ref,
            u.full_name AS decided_by_name
       FROM purchase_order_authorizations a LEFT JOIN users u ON u.id = a.decided_by
      WHERE a.purchase_order_id = ANY($1::uuid[])`, [ids]
  ) : { rows: [] };
  const { rows: grants } = viewerId ? await query.query(
    `SELECT authorization_type FROM hub_authorization_grants WHERE user_id = $1 AND revoked_at IS NULL`, [viewerId]
  ) : { rows: [] };
  const purchaseOrders = attachAuthorizations(attachPaymentEvidence(pos, evidence), decisions);
  return {
    scope: 'HUB_ADMINISTRATION_GLOBAL',
    markets: markets.map(m => m.code),
    approval_trace_available: true,
    viewer_grants: {
      purchase_commitment: grants.some(g => g.authorization_type === 'purchase_commitment'),
      supplier_payment: grants.some(g => g.authorization_type === 'supplier_payment'),
    },
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

module.exports = { gatherPurchaseOrders, attachPaymentEvidence, attachAuthorizations, getAdministrationBoard };
