/**
 * @komerce-arch
 * @role          financial-journal-projectors
 * @domain        finance
 * @layer         service
 * @criticality   critical
 * @inputs        orders, refunds, supplier_execution_payments, supplier_payment_settlements, order_item_real_cost_allocations, market_settlements
 * @outputs       financial_movements
 * @depends       db, services/financial-journal.js
 * @used-by       finance journal reconciliation, finance projections
 * @db-read       orders, refunds, supplier_execution_payments, supplier_execution_payment_proofs, supplier_payment_settlements, purchase_orders, order_item_real_cost_allocations, market_settlements, markets
 * @db-write      financial_movements, financial_movement_documents
 * @db-txn        caller_provided_client
 * @doctrine      idempotent_projection, sources_stay_authoritative, native_amounts_preserved, not_double_entry, custody_ledger_out_of_scope
 * @impact-areas  finance, accounting
 * @version       2026-11
 *
 * Projecteurs source → journal. Les tables sources restent l'autorité métier ; le journal ne les corrige jamais.
 * Chaque projecteur est rejouable à volonté (clé idempotente) et renvoie { read, created, advanced, replayed, eur_attached, conflicts }.
 * La garde des espèces (cash_custody_*) reste dans son registre dédié : ce n'est pas un mouvement économique.
 */
'use strict';

const journal = require('./financial-journal');

const emptyReport = () => ({ read: 0, created: 0, advanced: 0, replayed: 0, eur_attached: 0, skipped: 0, conflicts: [] });

async function feed(report, client, rows, build) {
  for (const row of rows) {
    report.read += 1;
    try {
      const result = await journal.recordMovement(client, build(row));
      if (result.skipped) report.skipped += 1;
      else report[result.outcome] += 1;
    } catch (error) {
      if (error.code !== 'JOURNAL_MOVEMENT_CONFLICT') throw error;
      report.conflicts.push({ source: row.id, code: error.code });
    }
  }
  return report;
}

const marketFilter = (alias, marketId, params) => {
  if (!marketId) return '';
  params.push(marketId);
  return ` AND ${alias}.market_id = $${params.length}`;
};

// Encaissements : commandes payées (cash réellement reçu, hors avoir wallet qui n'est pas du cash).
async function projectOrderPayments(client, { marketId = null } = {}) {
  const params = [];
  const { rows } = await client.query(
    `SELECT o.id, o.reference, o.market_id, o.total_kmf::text AS total_kmf, o.total_eur::text AS total_eur, o.fx_snapshot,
            o.payment_mode::text AS payment_mode, COALESCE(o.payment_received_at, o.cash_paid_at, o.created_at) AS occurred_at
       FROM orders o
      WHERE o.payment_status IN ('paid', 'refunded') AND o.total_kmf > 0 AND o.simulation_scope IS NULL${marketFilter('o', marketId, params)}
      ORDER BY o.created_at, o.id`, params);
  return feed(emptyReport(), client, rows, row => {
    const snap = row.fx_snapshot || {};
    const market = snap.market && Number(snap.market.amount) > 0 ? snap.market : null;
    const snapEur = snap.eur && Number(snap.eur.amount) > 0 ? snap.eur : null;
    return {
      sourceKind: 'order_payment', sourceId: row.id, direction: 'inflow', category: 'sale', state: 'settled',
      links: { marketId: row.market_id, orderId: row.id },
      amountNative: market ? market.amount : row.total_kmf, currency: market ? market.currency : 'KMF',
      occurredAt: row.occurred_at,
      eur: snapEur ? { amount: snapEur.amount, amount_text: snapEur.amount_text, legs: snapEur.legs || [] }
        : (Number(row.total_eur) > 0 ? { amount: row.total_eur, legs: [] } : null),
      provenance: { source: 'orders', reference: row.reference, origin_kmf: row.total_kmf, payment_mode: row.payment_mode },
    };
  });
}

// Remboursements clients : completed = décaissé, pending = engagé.
async function projectOrderRefunds(client, { marketId = null } = {}) {
  const params = [];
  const { rows } = await client.query(
    `SELECT r.id, r.order_id, r.amount_kmf::text AS amount_kmf, r.amount_eur::text AS amount_eur, r.status, r.refund_type, r.refund_method,
            COALESCE(r.completed_at, r.created_at) AS occurred_at, o.market_id, o.reference
       FROM refunds r JOIN orders o ON o.id = r.order_id
      WHERE r.status IN ('completed', 'pending') AND r.amount_kmf > 0 AND o.simulation_scope IS NULL${marketFilter('o', marketId, params)}
      ORDER BY r.created_at, r.id`, params);
  return feed(emptyReport(), client, rows, row => ({
    sourceKind: 'order_refund', sourceId: row.id, direction: 'outflow', category: 'refund',
    state: row.status === 'completed' ? 'settled' : 'committed',
    links: { marketId: row.market_id, orderId: row.order_id },
    amountNative: row.amount_kmf, currency: 'KMF', occurredAt: row.occurred_at,
    eur: Number(row.amount_eur) > 0 ? { amount: row.amount_eur, legs: [] } : null,
    provenance: { source: 'refunds', reference: row.reference, refund_type: row.refund_type, refund_method: row.refund_method, origin_kmf: row.amount_kmf },
  }));
}

// Paiements fournisseurs : engagement (facet commitment, montant attendu) puis règlements prouvés (append-only).
const SUPPLIER_STATE = Object.freeze({ prepared: 'planned', requested: 'committed', ambiguous: 'committed', succeeded: 'observed' });

async function projectSupplierCommitments(client, { marketId = null } = {}) {
  const params = [];
  const { rows } = await client.query(
    `SELECT p.id, p.purchase_order_id, p.provider, p.expected_amount::text AS expected_amount, p.currency, p.status, p.created_at, p.payment_ref,
            po.market_id, po.supplier_id
       FROM supplier_execution_payments p JOIN purchase_orders po ON po.id = p.purchase_order_id
      WHERE p.status <> 'rejected'${marketFilter('po', marketId, params)}
      ORDER BY p.created_at, p.id`, params);
  return feed(emptyReport(), client, rows, row => ({
    sourceKind: 'supplier_payment', sourceId: row.id, facet: 'commitment', direction: 'outflow', category: 'supplier_purchase',
    state: SUPPLIER_STATE[row.status] || 'planned',
    links: { marketId: row.market_id, purchaseOrderId: row.purchase_order_id, supplierId: row.supplier_id },
    amountNative: row.expected_amount, currency: row.currency, occurredAt: row.created_at,
    provenance: { source: 'supplier_execution_payments', provider: row.provider, payment_ref: row.payment_ref, status: row.status },
  }));
}

async function projectSupplierSettlements(client, { marketId = null } = {}) {
  const params = [];
  const { rows } = await client.query(
    `SELECT s.id, s.kind, s.amount_currency::text AS amount_currency, s.currency, s.amount_kmf::text AS amount_kmf, s.fees_kmf::text AS fees_kmf,
            s.proof_ref, s.recorded_at, p.purchase_order_id, po.market_id, po.supplier_id
       FROM supplier_payment_settlements s
       JOIN supplier_execution_payments p ON p.id = s.supplier_execution_payment_id
       JOIN purchase_orders po ON po.id = p.purchase_order_id
      WHERE true${marketFilter('po', marketId, params)}
      ORDER BY s.recorded_at, s.id`, params);
  const report = emptyReport();
  await feed(report, client, rows, row => ({
    sourceKind: 'supplier_settlement', sourceId: row.id, direction: row.kind === 'payment' ? 'outflow' : 'inflow',
    category: row.kind === 'payment' ? 'supplier_purchase' : 'supplier_refund', state: 'settled',
    links: { marketId: row.market_id, purchaseOrderId: row.purchase_order_id, supplierId: row.supplier_id },
    amountNative: row.amount_currency, currency: row.currency, occurredAt: row.recorded_at,
    documents: [{ kind: 'supplier_payment_proof', ref: row.proof_ref }],
    provenance: { source: 'supplier_payment_settlements', kind: row.kind, origin_kmf: row.amount_kmf },
  }));
  const withFees = rows.filter(row => Number(row.fees_kmf) > 0);
  await feed(report, client, withFees, row => ({
    sourceKind: 'supplier_settlement', sourceId: row.id, facet: 'fees', direction: 'outflow', category: 'payment_fee', state: 'settled',
    links: { marketId: row.market_id, purchaseOrderId: row.purchase_order_id, supplierId: row.supplier_id },
    amountNative: row.fees_kmf, currency: 'KMF', occurredAt: row.recorded_at,
    documents: [{ kind: 'supplier_payment_proof', ref: row.proof_ref }],
    provenance: { source: 'supplier_payment_settlements', origin_kmf: row.fees_kmf },
  }));
  return report;
}

// Coûts réels alloués (fret, douane, relais…) : fait observé, direction « cost » (économique, pas un flux de trésorerie).
async function projectCostAllocations(client, { marketId = null } = {}) {
  const params = [];
  const { rows } = await client.query(
    `SELECT a.id, a.order_id, a.parcel_id, a.shipment_id, a.cost_type, a.amount_kmf::text AS amount_kmf, a.source, a.created_at, o.market_id
       FROM order_item_real_cost_allocations a JOIN orders o ON o.id = a.order_id
      WHERE a.is_actual = true AND a.amount_kmf > 0 AND o.simulation_scope IS NULL${marketFilter('o', marketId, params)}
      ORDER BY a.created_at, a.id`, params);
  return feed(emptyReport(), client, rows, row => ({
    sourceKind: 'cost_allocation', sourceId: row.id, direction: 'cost', category: `cost:${row.cost_type}`, state: 'observed',
    links: { marketId: row.market_id, orderId: row.order_id, parcelId: row.parcel_id, shipmentId: row.shipment_id },
    amountNative: row.amount_kmf, currency: 'KMF', occurredAt: row.created_at,
    provenance: { source: 'order_item_real_cost_allocations', allocation_source: row.source, origin_kmf: row.amount_kmf },
  }));
}

// Règlements marché (attestation centrale) : REQUESTED = engagé, PAID/RECEIVED = décaissé.
async function projectMarketSettlements(client, { marketId = null } = {}) {
  const params = [];
  const { rows } = await client.query(
    `SELECT s.id, s.market_id, s.amount::text AS amount, s.currency, s.status, s.payment_reference,
            COALESCE(s.paid_at, s.requested_at, s.created_at) AS occurred_at
       FROM market_settlements s
      WHERE s.status IN ('REQUESTED', 'PAID', 'RECEIVED')${marketFilter('s', marketId, params)}
      ORDER BY s.created_at, s.id`, params);
  return feed(emptyReport(), client, rows, row => ({
    sourceKind: 'market_settlement', sourceId: row.id, direction: 'outflow', category: 'market_settlement',
    state: row.status === 'REQUESTED' ? 'committed' : 'settled',
    links: { marketId: row.market_id }, amountNative: row.amount, currency: row.currency, occurredAt: row.occurred_at,
    documents: row.payment_reference ? [{ kind: 'payment_reference', ref: row.payment_reference }] : [],
    provenance: { source: 'market_settlements', status: row.status },
  }));
}

const PROJECTORS = Object.freeze({
  order_payments: projectOrderPayments,
  order_refunds: projectOrderRefunds,
  supplier_commitments: projectSupplierCommitments,
  supplier_settlements: projectSupplierSettlements,
  cost_allocations: projectCostAllocations,
  market_settlements: projectMarketSettlements,
});

async function projectAll(client, options = {}) {
  const out = {};
  for (const [name, fn] of Object.entries(PROJECTORS)) out[name] = await fn(client, options);
  return out;
}

module.exports = { PROJECTORS, projectAll, projectOrderPayments, projectOrderRefunds, projectSupplierCommitments,
  projectSupplierSettlements, projectCostAllocations, projectMarketSettlements };
