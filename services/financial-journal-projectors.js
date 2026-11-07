/**
 * @komerce-arch
 * @role          financial-journal-projectors
 * @domain        finance
 * @layer         service
 * @criticality   critical
 * @inputs        orders, refunds, supplier_execution_payments, supplier_payment_settlements, order_item_real_cost_allocations, market_settlements, cash_custody_movements, international_shipments, international_shipment_charges, customs_shipments
 * @outputs       financial_movements
 * @depends       db, services/financial-journal.js
 * @used-by       finance journal reconciliation, finance projections
 * @db-read       orders, refunds, supplier_execution_payments, supplier_execution_payment_proofs, supplier_payment_settlements, purchase_orders, order_item_real_cost_allocations, market_settlements, markets, cash_custody_receipts, cash_deposits, customs_shipments, international_shipment_charges, international_shipment_events, international_shipment_hub_units, international_shipments, international_n1_allocation_links
 * @db-write      financial_movements, financial_movement_documents
 * @db-txn        caller_provided_client
 * @doctrine      idempotent_projection, sources_stay_authoritative, native_amounts_preserved, not_double_entry, custody_is_not_revenue, shipment_costs_not_item_allocations
 * @impact-areas  finance, accounting
 * @version       2026-11
 *
 * Projecteurs source → journal. Les tables sources restent l'autorité métier ; le journal ne les corrige jamais.
 * Chaque projecteur est rejouable à volonté (clé idempotente) et renvoie { read, created, advanced, replayed, eur_attached, conflicts }.
 * La garde des espèces reste dans son registre dédié : journalisée en direction custody, jamais comme recette économique.
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

// Incrémental : un fait immuable déjà journalisé avec son EUR n'est pas relu (les états évolutifs et les EUR manquants le sont).
const NOT_JOURNALED = Object.freeze({
  order_payment: " AND NOT EXISTS (SELECT 1 FROM financial_movements fm WHERE fm.movement_key = 'order_payment:' || o.id::text || ':main' AND fm.fx_status <> 'unavailable')",
  order_refund: " AND NOT EXISTS (SELECT 1 FROM financial_movements fm WHERE fm.movement_key = 'order_refund:' || r.id::text || ':main' AND fm.fx_status <> 'unavailable' AND fm.state = 'settled')",
  cost_allocation: " AND NOT EXISTS (SELECT 1 FROM financial_movements fm WHERE fm.movement_key = 'cost_allocation:' || a.id::text || ':main' AND fm.fx_status <> 'unavailable')",
  supplier_settlement: " AND NOT EXISTS (SELECT 1 FROM financial_movements fm WHERE fm.movement_key = 'supplier_settlement:' || s.id::text || ':main' AND fm.fx_status <> 'unavailable')",
});

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
      WHERE o.payment_status IN ('paid', 'refunded') AND o.total_kmf > 0 AND o.simulation_scope IS NULL${NOT_JOURNALED.order_payment}${marketFilter('o', marketId, params)}
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
      WHERE r.status IN ('completed', 'pending') AND r.amount_kmf > 0 AND o.simulation_scope IS NULL${NOT_JOURNALED.order_refund}${marketFilter('o', marketId, params)}
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
      WHERE true${NOT_JOURNALED.supplier_settlement}${marketFilter('po', marketId, params)}
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
  const withFees = rows.filter(row => Number(row.fees_kmf) > 0); // KMF natif : jamais « unavailable » (parité fixe)
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
      WHERE a.is_actual = true AND a.amount_kmf > 0 AND o.simulation_scope IS NULL${NOT_JOURNALED.cost_allocation}${marketFilter('o', marketId, params)}
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


/**
 * L7 — Journal de GARDE : source de vérité = cash_custody_movements (289).
 * Ces écritures n'ont JAMAIS la direction inflow/outflow : transfert entre détenteurs
 * ou dépôt final ne créent ni seconde vente ni nouvel encaissement.
 * L'identité (ref_id, source, holder) est stable au rejeu et pour les contre-écritures.
 * Les pertes décidées ne sont PAS des transferts ; leur traitement économique reste séparé.
 */
async function projectCustodyMovements(client, { marketId = null } = {}) {
  const params = [];
  const { rows } = await client.query(
    `SELECT c.source, c.ref_id, c.deposit_id, c.holder_id, c.market_id,
            c.delta_kmf::text AS delta_kmf, c.occurred_at,
            d.deposit_ref, d.declared_currency, d.declared_amount::text AS declared_amount,
            r.proof_ref, r.proof_url
       FROM cash_custody_movements c
       LEFT JOIN cash_deposits d ON d.id = c.deposit_id
       LEFT JOIN cash_custody_receipts r ON r.id = c.ref_id
      WHERE c.source IN ('TRANSFER_OUT', 'TRANSFER_IN', 'FINAL_CLOSURE')
        AND c.delta_kmf <> 0 AND c.market_id IS NOT NULL${marketFilter('c', marketId, params)}
      ORDER BY c.occurred_at, c.ref_id, c.source`, params);
  return feed(emptyReport(), client, rows, row => ({
    sourceKind: 'cash_custody_movement', sourceId: row.ref_id,
    facet: `${row.source}:${row.holder_id}`,
    direction: 'custody',
    category: row.source === 'FINAL_CLOSURE' ? 'cash_final_deposit'
      : 'cash_custody_transfer',
    state: 'observed',
    links: { marketId: row.market_id },
    amountNative: Math.abs(Number(row.delta_kmf)).toFixed(2), currency: 'KMF',
    occurredAt: row.occurred_at,
    documents: row.proof_ref ? [{ kind: 'cash_custody_receipt', ref: row.proof_ref, url: row.proof_url }] : [],
    provenance: {
      source: 'cash_custody_movements', source_event: row.source,
      holder_user_id: row.holder_id, deposit_id: row.deposit_id, reference: row.deposit_ref,
      delta_sign: Number(row.delta_kmf) < 0 ? -1 : 1,
      declared_currency: row.declared_currency, declared_amount: row.declared_amount,
      economic_inflow: false,
    },
  }));
}

// Fail-closed : ne pas additionner une facture du dossier et une ancienne allocation
// article du MEME dossier. La migration 361 interdit déjà cette double autorité,
// et le journal ne doit pas la réintroduire lors d'une reconstruction de Staging.
async function assertShipmentCostAuthority(client, rows) {
  const ids = [...new Set(rows.map(row => row.shipment_id || row.id).filter(Boolean))];
  if (!ids.length) return;
  // order_item_real_cost_allocations.shipment_id pointe vers customs_shipments,
  // PAS international_shipments. La table des liens porte l'ID international.
  const { rows: checks } = await client.query(
    `SELECT s.id AS shipment_id, COUNT(DISTINCT a.id)::int AS n
       FROM international_shipments s
       JOIN order_item_real_cost_allocations a ON a.is_actual = true
       LEFT JOIN international_n1_allocation_links l ON l.allocation_id = a.id
      WHERE s.id = ANY($1::uuid[])
        AND (a.shipment_id = s.customs_shipment_id OR l.shipment_id = s.id)
      GROUP BY s.id LIMIT 1`, [ids]);
  if (checks.length && Number(checks[0].n) > 0) {
    const error = new Error('Coût expédition et allocation article concurrents : réconciliation requise');
    error.code = 'JOURNAL_SHIPMENT_ITEM_ALLOCATION_CONFLICT';
    throw error;
  }
}

// Les coûts physiques appartiennent au dossier d'expédition (pas aux articles).
// Ne jamais projeter un agrégat de rapprochement en plus de ses factures sources.
async function projectShipmentFreight(client, { marketId = null } = {}) {
  const params = [];
  const { rows } = await client.query(
    `SELECT s.id, s.reference, s.market_id, s.freight_invoice_kmf::text AS amount_kmf,
            s.freight_invoice_ref, COALESCE(ev.occurred_at, s.updated_at) AS occurred_at
       FROM international_shipments s
       LEFT JOIN LATERAL (
         SELECT e.occurred_at FROM international_shipment_events e
          WHERE e.shipment_id = s.id AND e.event_type = 'freight_recorded'
          ORDER BY e.occurred_at DESC LIMIT 1
       ) ev ON true
      WHERE s.freight_invoice_kmf > 0 AND s.freight_invoice_ref IS NOT NULL
        AND EXISTS (SELECT 1 FROM international_shipment_hub_units hu WHERE hu.shipment_id = s.id)
        ${marketFilter('s', marketId, params)}
      ORDER BY s.id`, params);
  await assertShipmentCostAuthority(client, rows);
  return feed(emptyReport(), client, rows, row => ({
    sourceKind: 'shipment_freight', sourceId: row.id,
    direction: 'cost', category: 'cost:shipment_freight', state: 'observed',
    links: { marketId: row.market_id, shipmentId: row.id },
    amountNative: row.amount_kmf, currency: 'KMF', occurredAt: row.occurred_at,
    documents: [{ kind: 'freight_invoice', ref: row.freight_invoice_ref }],
    provenance: { source: 'international_shipments', reference: row.reference,
      invoice_ref: row.freight_invoice_ref, scope: 'shipment', allocation_to_items: false },
  }));
}

async function projectShipmentCharges(client, { marketId = null } = {}) {
  const params = [];
  const { rows } = await client.query(
    `SELECT c.id, c.shipment_id, c.fee_type, c.kind, c.amount_kmf::text AS amount_kmf,
            c.proof_ref, c.recorded_at, s.reference, s.market_id
       FROM international_shipment_charges c
       JOIN international_shipments s ON s.id = c.shipment_id
      WHERE c.amount_kmf > 0
        AND EXISTS (SELECT 1 FROM international_shipment_hub_units hu WHERE hu.shipment_id = s.id)
        ${marketFilter('s', marketId, params)}
      ORDER BY c.recorded_at, c.id`, params);
  await assertShipmentCostAuthority(client, rows);
  return feed(emptyReport(), client, rows, row => ({
    sourceKind: 'shipment_charge', sourceId: row.id,
    direction: row.kind === 'credit' ? 'cost_reversal' : 'cost',
    category: `cost:shipment_${row.fee_type}`, state: 'observed',
    links: { marketId: row.market_id, shipmentId: row.shipment_id },
    amountNative: row.amount_kmf, currency: 'KMF', occurredAt: row.recorded_at,
    documents: row.proof_ref ? [{ kind: 'shipment_cost_proof', ref: row.proof_ref }] : [],
    provenance: { source: 'international_shipment_charges', reference: row.reference,
      fee_type: row.fee_type, kind: row.kind, scope: 'shipment', allocation_to_items: false },
  }));
}

// La déclaration douanière est un fait propre, distinct des factures additionnelles.
// La photographie international_n1_reconciliations n'est PAS une nouvelle dépense.
async function projectShipmentCustoms(client, { marketId = null } = {}) {
  const params = [];
  const { rows } = await client.query(
    `SELECT cs.id, cs.reference AS customs_reference, cs.customs_paid_kmf::text AS amount_kmf,
            cs.declared_at, s.reference, s.id AS shipment_id, s.market_id,
            ev.proof_ref
       FROM international_shipments s
       JOIN customs_shipments cs ON cs.id = s.customs_shipment_id AND cs.market_id = s.market_id
       LEFT JOIN LATERAL (
         SELECT e.proof_ref FROM international_shipment_events e
          WHERE e.shipment_id = s.id AND e.event_type = 'customs_amount_confirmed'
          ORDER BY e.occurred_at DESC LIMIT 1
       ) ev ON true
      WHERE cs.declared_at IS NOT NULL AND cs.customs_paid_kmf > 0
        AND EXISTS (SELECT 1 FROM international_shipment_hub_units hu WHERE hu.shipment_id = s.id)
        ${marketFilter('s', marketId, params)}
      ORDER BY cs.id`, params);
  await assertShipmentCostAuthority(client, rows);
  return feed(emptyReport(), client, rows, row => ({
    sourceKind: 'shipment_customs', sourceId: row.id,
    direction: 'cost', category: 'cost:shipment_customs', state: 'observed',
    links: { marketId: row.market_id, shipmentId: row.shipment_id },
    amountNative: row.amount_kmf, currency: 'KMF',
    occurredAt: row.declared_at,
    documents: row.proof_ref ? [{ kind: 'customs_declaration_proof', ref: row.proof_ref }] : [],
    provenance: { source: 'customs_shipments', reference: row.customs_reference,
      shipment_reference: row.reference, scope: 'shipment', allocation_to_items: false },
  }));
}

const PROJECTORS = Object.freeze({
  order_payments: projectOrderPayments,
  order_refunds: projectOrderRefunds,
  supplier_commitments: projectSupplierCommitments,
  supplier_settlements: projectSupplierSettlements,
  cost_allocations: projectCostAllocations,
  market_settlements: projectMarketSettlements,
  cash_custody: projectCustodyMovements,
  shipment_freight: projectShipmentFreight,
  shipment_charges: projectShipmentCharges,
  shipment_customs: projectShipmentCustoms,
});

async function projectAll(client, options = {}) {
  const out = {};
  for (const [name, fn] of Object.entries(PROJECTORS)) out[name] = await fn(client, options);
  return out;
}

module.exports = { PROJECTORS, projectAll, projectOrderPayments, projectOrderRefunds, projectSupplierCommitments,
  projectSupplierSettlements, projectCostAllocations, projectMarketSettlements,
  projectCustodyMovements, projectShipmentFreight, projectShipmentCharges, projectShipmentCustoms };
