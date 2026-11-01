/**
 * @komerce-arch
 * @role          financial-journal-reporting
 * @domain        finance
 * @layer         service
 * @criticality   critical
 * @inputs        market_id, period, financial_movements
 * @outputs       journal_summary, source_reconciliation
 * @depends       services/financial-journal.js
 * @used-by       finance projections, accounting workspace
 * @db-read       financial_movements, orders, refunds, supplier_payment_settlements, supplier_execution_payments, purchase_orders, order_item_real_cost_allocations
 * @db-write      none
 * @db-txn        none
 * @doctrine      single_projection_rules, native_amounts_preserved, eur_never_invented, reconcile_before_validate, not_double_entry
 * @impact-areas  finance, accounting, dashboards
 * @version       2026-11
 *
 * Lecture du journal : agrégats par direction / catégorie / état avec EUR (jamais additionné entre devises natives)
 * et réconciliation explicite avec les tables sources. Un mouvement sans EUR est compté à part, jamais estimé.
 */
'use strict';

function periodClause(alias, { marketId, from, to }, params) {
  const where = [];
  if (marketId) { params.push(marketId); where.push(`${alias}.market_id = $${params.length}`); }
  if (from) { params.push(from); where.push(`${alias}.occurred_at >= $${params.length}`); }
  if (to) { params.push(to); where.push(`${alias}.occurred_at <= $${params.length}`); }
  return where.length ? ` AND ${where.join(' AND ')}` : '';
}

async function summarize(client, scope = {}) {
  const params = [];
  const { rows } = await client.query(
    `SELECT m.direction, m.category, m.state, m.currency,
            COUNT(*)::int AS movements,
            SUM(m.amount_native)::text AS native_total,
            SUM(m.amount_eur) FILTER (WHERE m.amount_eur IS NOT NULL)::text AS eur_total,
            COUNT(*) FILTER (WHERE m.fx_status = 'unavailable')::int AS eur_unavailable
       FROM financial_movements m
      WHERE true${periodClause('m', scope, params)}
      GROUP BY m.direction, m.category, m.state, m.currency
      ORDER BY m.direction, m.category, m.state, m.currency`, params);
  const eurUnavailable = rows.reduce((total, row) => total + row.eur_unavailable, 0);
  return {
    rows,
    eur_total_known: rows.reduce((total, row) => total + (row.eur_total == null ? 0 : Number(row.eur_total)), 0),
    eur_unavailable_movements: eurUnavailable,
    eur_complete: eurUnavailable === 0,
  };
}

// Vue de pilotage : lignes catégorie × état, EUR connus additionnés (jamais entre natifs), natifs conservés par devise.
async function projection(client, scope = {}) {
  const base = await summarize(client, scope);
  const grouped = new Map();
  for (const row of base.rows) {
    const key = `${row.direction}|${row.category}|${row.state}`;
    const line = grouped.get(key) || {
      direction: row.direction, category: row.category, label: categoryLabel(row.category),
      state: row.state, state_label: stateLabel(row.state), movements: 0, eur_total: 0, eur_unavailable: 0, native: [],
    };
    line.movements += row.movements;
    line.eur_total = Math.round((line.eur_total + (row.eur_total == null ? 0 : Number(row.eur_total))) * 100) / 100;
    line.eur_unavailable += row.eur_unavailable;
    line.native.push({ currency: row.currency, total: row.native_total });
    grouped.set(key, line);
  }
  const params = [];
  const remaining = (await client.query(
    `WITH per_po AS (
       SELECT m.purchase_order_id, m.currency,
              SUM(m.amount_native) FILTER (WHERE m.facet = 'commitment' AND m.source_kind = 'supplier_payment') AS committed,
              SUM(m.amount_native) FILTER (WHERE m.facet = 'main' AND m.source_kind = 'supplier_settlement' AND m.direction = 'outflow') AS settled
         FROM financial_movements m
        WHERE m.purchase_order_id IS NOT NULL AND m.category = 'supplier_purchase'${periodClause('m', { marketId: scope.marketId }, params)}
        GROUP BY m.purchase_order_id, m.currency)
     SELECT currency, SUM(GREATEST(COALESCE(committed, 0) - COALESCE(settled, 0), 0))::text AS remaining_native
       FROM per_po GROUP BY currency HAVING SUM(GREATEST(COALESCE(committed, 0) - COALESCE(settled, 0), 0)) > 0
      ORDER BY currency`, params)).rows;
  const freshness = (await client.query('SELECT MAX(created_at) AS last_projected_at, COUNT(*)::int AS total FROM financial_movements')).rows[0];
  return {
    basis: 'financial_movements',
    period_basis: 'occurred_at',
    lines: [...grouped.values()],
    supplier_remaining_native: remaining,
    eur_unavailable_movements: base.eur_unavailable_movements,
    eur_complete: base.eur_complete,
    last_projected_at: freshness.last_projected_at,
    journal_empty: freshness.total === 0,
  };
}

// Libellés métier : seule source (les écrans Finance et Comptabilité les lisent, ne les redéfinissent pas).
const CATEGORY_LABELS = Object.freeze({
  sale: 'Encaissements clients', refund: 'Remboursements clients', supplier_purchase: 'Achats fournisseurs',
  supplier_refund: 'Remboursements fournisseurs', payment_fee: 'Frais de paiement', market_settlement: 'Règlements marché',
});
const STATE_LABELS = Object.freeze({ planned: 'Prévu', committed: 'Engagé', observed: 'Constaté', settled: 'Réglé', reversed: 'Annulé' });
const categoryLabel = category => (String(category).startsWith('cost:') ? `Coût réel · ${String(category).slice(5)}` : (CATEGORY_LABELS[category] || category));
const stateLabel = state => STATE_LABELS[state] || state;

const CHECK_LABELS = Object.freeze({
  order_payments_origin_kmf: 'Encaissements : journal ↔ commandes payées (KMF)',
  order_refunds_kmf: 'Remboursements : journal ↔ table des remboursements (KMF)',
  cost_allocations_kmf: 'Coûts réels : journal ↔ allocations de coûts (KMF)',
  supplier_settlements_native: 'Règlements fournisseurs : journal ↔ règlements prouvés (natif)',
  movements_without_provenance: 'Mouvements sans provenance (doit être 0)',
});

const MOVEMENT_STATES = new Set(['planned', 'committed', 'observed', 'settled', 'reversed']);

// Journal : lecture paginée, filtrable. Référence métier lisible issue de la provenance (jamais d'identifiant brut seul).
async function listMovements(client, scope = {}) {
  const params = [];
  let where = periodClause('m', scope, params);
  if (scope.state && MOVEMENT_STATES.has(scope.state)) { params.push(scope.state); where += ` AND m.state = $${params.length}`; }
  if (scope.direction && ['inflow', 'outflow', 'cost'].includes(scope.direction)) { params.push(scope.direction); where += ` AND m.direction = $${params.length}`; }
  const limit = Math.min(Math.max(parseInt(scope.limit, 10) || 50, 1), 200);
  const offset = Math.max(parseInt(scope.offset, 10) || 0, 0);
  const total = (await client.query(`SELECT COUNT(*)::int AS n FROM financial_movements m WHERE true${where}`, params)).rows[0].n;
  params.push(limit, offset);
  const { rows } = await client.query(
    `SELECT m.id, m.source_kind, m.facet, m.direction, m.category, m.state, m.amount_native::text AS amount_native, m.currency,
            m.amount_eur::text AS amount_eur, m.fx_status, m.occurred_at, m.provenance->>'reference' AS reference,
            m.order_id, m.purchase_order_id, m.shipment_id, m.parcel_id, m.supplier_id, m.relais_id,
            (SELECT COUNT(*)::int FROM financial_movement_documents d WHERE d.movement_id = m.id) AS documents
       FROM financial_movements m
      WHERE true${where}
      ORDER BY m.occurred_at DESC, m.id
      LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
  return { total, limit, offset, rows: rows.map(row => ({ ...row, label: categoryLabel(row.category), state_label: stateLabel(row.state) })) };
}

// Pièces : toutes les pièces rattachées + les décaissements réglés SANS pièce (anomalie à traiter).
async function listDocuments(client, scope = {}) {
  const params = [];
  const where = periodClause('m', scope, params);
  const documents = (await client.query(
    `SELECT d.doc_kind, d.doc_ref, d.doc_url, m.id AS movement_id, m.category, m.state, m.amount_native::text AS amount_native, m.currency, m.occurred_at
       FROM financial_movement_documents d JOIN financial_movements m ON m.id = d.movement_id
      WHERE true${where} ORDER BY m.occurred_at DESC LIMIT 200`, params)).rows;
  const missing = (await client.query(
    `SELECT m.id AS movement_id, m.category, m.amount_native::text AS amount_native, m.currency, m.occurred_at, m.provenance->>'reference' AS reference
       FROM financial_movements m
      WHERE m.direction = 'outflow' AND m.state = 'settled' AND m.category IN ('supplier_purchase', 'market_settlement', 'payment_fee')
        AND NOT EXISTS (SELECT 1 FROM financial_movement_documents d WHERE d.movement_id = m.id)${where}
      ORDER BY m.occurred_at DESC LIMIT 200`, params)).rows;
  const labelled = row => ({ ...row, label: categoryLabel(row.category) });
  return { documents: documents.map(labelled), missing_documents: missing.map(labelled) };
}

// Même cohorte que le dashboard Finance (CA encaissé) : commandes payées, hors annulées/remboursées, simulations exclues.
async function reconcileWithSources(client, scope = {}) {
  const checks = [];
  const add = (name, journal, source, tolerance = 0) =>
    checks.push({ name, label: CHECK_LABELS[name] || name, journal: Number(journal), source: Number(source), ok: Math.abs(Number(journal) - Number(source)) <= tolerance });

  const pay = (await client.query(
    `SELECT COALESCE(SUM((m.provenance->>'origin_kmf')::numeric), 0)::text AS journal_kmf,
            (SELECT COALESCE(SUM(o.total_kmf), 0)::text FROM orders o
              WHERE o.payment_status IN ('paid','refunded') AND o.total_kmf > 0 AND o.simulation_scope IS NULL
                ${scope.marketId ? `AND o.market_id = $1` : ''}) AS source_kmf,
            COUNT(*)::int AS n
       FROM financial_movements m WHERE m.source_kind = 'order_payment' ${scope.marketId ? `AND m.market_id = $1` : ''}`,
    scope.marketId ? [scope.marketId] : [])).rows[0];
  add('order_payments_origin_kmf', pay.journal_kmf, pay.source_kmf);

  const ref = (await client.query(
    `SELECT COALESCE(SUM(m.amount_native), 0)::text AS journal_kmf,
            (SELECT COALESCE(SUM(r.amount_kmf), 0)::text FROM refunds r JOIN orders o ON o.id = r.order_id
              WHERE r.status IN ('completed','pending') AND r.amount_kmf > 0 AND o.simulation_scope IS NULL
                ${scope.marketId ? `AND o.market_id = $1` : ''}) AS source_kmf
       FROM financial_movements m WHERE m.source_kind = 'order_refund' ${scope.marketId ? `AND m.market_id = $1` : ''}`,
    scope.marketId ? [scope.marketId] : [])).rows[0];
  add('order_refunds_kmf', ref.journal_kmf, ref.source_kmf);

  const cost = (await client.query(
    `SELECT COALESCE(SUM(m.amount_native), 0)::text AS journal_kmf,
            (SELECT COALESCE(SUM(a.amount_kmf), 0)::text FROM order_item_real_cost_allocations a JOIN orders o ON o.id = a.order_id
              WHERE a.is_actual = true AND a.amount_kmf > 0 AND o.simulation_scope IS NULL
                ${scope.marketId ? `AND o.market_id = $1` : ''}) AS source_kmf
       FROM financial_movements m WHERE m.source_kind = 'cost_allocation' ${scope.marketId ? `AND m.market_id = $1` : ''}`,
    scope.marketId ? [scope.marketId] : [])).rows[0];
  add('cost_allocations_kmf', cost.journal_kmf, cost.source_kmf);

  const sup = (await client.query(
    `SELECT COALESCE(SUM(m.amount_native), 0)::text AS journal_native,
            (SELECT COALESCE(SUM(s.amount_currency), 0)::text FROM supplier_payment_settlements s
               JOIN supplier_execution_payments p ON p.id = s.supplier_execution_payment_id
               JOIN purchase_orders po ON po.id = p.purchase_order_id
              WHERE true ${scope.marketId ? `AND po.market_id = $1` : ''}) AS source_native
       FROM financial_movements m WHERE m.source_kind = 'supplier_settlement' AND m.facet = 'main' ${scope.marketId ? `AND m.market_id = $1` : ''}`,
    scope.marketId ? [scope.marketId] : [])).rows[0];
  // Montants natifs de devises différentes sommés ici uniquement pour la preuve d'égalité exacte source/journal (jamais affichés).
  add('supplier_settlements_native', sup.journal_native, sup.source_native);

  const orphans = (await client.query(
    `SELECT COUNT(*)::int AS n FROM financial_movements m
      WHERE jsonb_typeof(m.provenance) <> 'object' OR m.provenance->>'source' IS NULL`)).rows[0].n;
  add('movements_without_provenance', orphans, 0);

  return { ok: checks.every(check => check.ok), checks };
}

module.exports = { summarize, projection, listMovements, listDocuments, reconcileWithSources };
