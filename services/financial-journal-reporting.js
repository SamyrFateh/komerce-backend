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
 * @db-read       financial_movements, orders, refunds, supplier_payment_settlements, order_item_real_cost_allocations
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

// Même cohorte que le dashboard Finance (CA encaissé) : commandes payées, hors annulées/remboursées, simulations exclues.
async function reconcileWithSources(client, scope = {}) {
  const checks = [];
  const add = (name, journal, source, tolerance = 0) =>
    checks.push({ name, journal: Number(journal), source: Number(source), ok: Math.abs(Number(journal) - Number(source)) <= tolerance });

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

module.exports = { summarize, reconcileWithSources };
