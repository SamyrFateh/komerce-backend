/**
 * @komerce-arch
 * @role          dashboard-metrics-costing
 * @domain        dashboard
 * @layer         service
 * @criticality   high
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db, ./_helpers, ../cost-allocation/cost-expectation, ./control-tower (getCAEncaisse, INV-1)
 * @used-by       services/dashboard-metrics/index.js
 * @db-read       order_item_cost_imputations, order_item_real_cost_allocations, orders, markets
 * @db-write      (none)
 * @db-txn        @none
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  dashboard, admin-dashboard, admin-costing
 * @version       2026-06
 */

/**
 * KOMERCE — Dashboard Metrics — Costing (8 KPIs) — Lot C3
 * ════════════════════════════════════════════════════════════════════════
 * Extrait de services/dashboard-metrics.js (1081L) — Lot B/C Refacto.
 *
 * ENUM cost_status (canonique Sprint 1) :
 *   estimated     = snapshot pricing-engine seul, aucun cout reel
 *   partial_real  = couts variables alloues mais types attendus manquants
 *   actual        = tous les types attendus alloues (ex-'complete')
 *   incomplete    = imputation absente / cas pathologique
 *
 * getCAVendu est un alias semantique de getCAEncaisse (INV-1) —
 * dependance volontaire vers control-tower.js, pas de duplication SQL.
 */

'use strict';

const costExpectation = require('../cost-allocation/cost-expectation');

const db = require('../../db');
const {
  buildFiltersClause, buildPreviousPeriod, computeDelta, makeKpi,
  EXPECTED_VARIABLE_COSTS,
} = require('./_helpers');
const { getCAEncaisse } = require('./control-tower');

// ═══════════════════════════════════════════════════════════════════════
// COSTING — 8 KPIs
// ═══════════════════════════════════════════════════════════════════════

async function getCAVendu(filters = {}) {
  const ca = await getCAEncaisse(filters);
  return { ...ca, key: 'ca_vendu', label: 'CA vendu' };
}


// Un coût non observé n'est pas un coût nul : garder NULL jusqu'au contrat KPI.
function nullableKmf(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}


async function getCoutEstime(filters = {}) {
  const { where, params } = buildFiltersClause(filters);
  const sql = `
    WITH order_set AS (
      SELECT o.id FROM orders o
      WHERE ${where} AND o.status NOT IN ('cancelled', 'refunded')
    ),
    by_order AS (
      SELECT os.id,
        COUNT(DISTINCT oi.id)::int AS lines_expected,
        COUNT(DISTINCT oi.id) FILTER (
          WHERE imp.estimated_business_complete_cost_kmf IS NOT NULL
        )::int AS lines_priced,
        SUM(imp.estimated_business_complete_cost_kmf) AS cost_kmf
      FROM order_set os
      LEFT JOIN order_items oi ON oi.order_id = os.id
      LEFT JOIN order_item_cost_imputations imp
        ON imp.order_id = os.id AND imp.order_item_id = oi.id
      GROUP BY os.id
    )
    SELECT
      SUM(cost_kmf) FILTER (
        WHERE lines_expected > 0 AND lines_expected = lines_priced
      )::bigint AS value,
      COUNT(*) FILTER (
        WHERE lines_expected > 0 AND lines_expected = lines_priced
      )::int AS items_with_data,
      COUNT(*)::int AS items_total
    FROM by_order
  `;
  const r = await db.query(sql, params);
  const value = nullableKmf(r.rows[0].value);
  const itemsWithData = Number(r.rows[0].items_with_data) || 0;
  const itemsTotal = Number(r.rows[0].items_total) || 0;

  return makeKpi('cout_estime', 'Coût estimé', value, 'KMF', {
    itemsTotal,
    itemsWithData,
    completeness: itemsTotal === 0 ? 'provisional' : (itemsWithData === itemsTotal ? 'complete' : 'partial'),
    warning: itemsTotal > 0 && itemsWithData < itemsTotal
      ? `${itemsTotal - itemsWithData} commande(s) sans coût estimé complet`
      : null,
  });
}

async function getCoutReel(filters = {}) {
  const { where, params } = buildFiltersClause(filters);
  const sql = `
    SELECT
      SUM(alc.amount_kmf)::bigint AS value,
      COUNT(DISTINCT alc.order_id)::int AS items_with_data,
      (SELECT COUNT(*)::int FROM orders o WHERE ${where} AND o.status NOT IN ('cancelled','refunded')) AS items_total
    FROM order_item_real_cost_allocations alc
    JOIN orders o ON o.id = alc.order_id
    WHERE ${where}
      AND o.status NOT IN ('cancelled', 'refunded')
      AND alc.is_actual = TRUE
  `;
  const r = await db.query(sql, params);
  const value = nullableKmf(r.rows[0].value);
  const itemsWithData = Number(r.rows[0].items_with_data) || 0;
  const itemsTotal = Number(r.rows[0].items_total) || 0;

  return makeKpi('cout_reel', 'Coût réel', value, 'KMF', {
    itemsTotal,
    itemsWithData,
    completeness: itemsTotal === 0 ? 'provisional' : (itemsWithData === itemsTotal ? 'complete' : 'partial'),
    warning: itemsTotal > 0 && itemsWithData < itemsTotal
      ? `Réel partiel : ${itemsWithData}/${itemsTotal} commandes ventilées`
      : null,
  });
}


async function getMargeEstimee(filters = {}) {
  // Marge estimee = CA - cout_estime (sur cmds avec snapshot).
  // Le CA du pourcentage porte sur la MEME population que la marge (cmds estimees) :
  // sinon le % est sous-evalue des que la couverture est < 100 % (audit KPI-3).
  const { where, params } = buildFiltersClause(filters);
  const sql = `
    WITH order_aggs AS (
      SELECT
        o.id,
        o.total_kmf,
        CASE WHEN EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = o.id)
          AND NOT EXISTS (
            SELECT 1 FROM order_items oi
            WHERE oi.order_id = o.id
              AND NOT EXISTS (
                SELECT 1 FROM order_item_cost_imputations imp
                WHERE imp.order_id = o.id AND imp.order_item_id = oi.id
                  AND imp.estimated_business_complete_cost_kmf IS NOT NULL
              )
          )
          THEN (SELECT SUM(imp.estimated_business_complete_cost_kmf)
                FROM order_item_cost_imputations imp WHERE imp.order_id = o.id)
          ELSE NULL
        END AS est_cost
      FROM orders o
      WHERE ${where}
        AND o.payment_status = 'paid'
        AND o.status NOT IN ('cancelled', 'refunded')
    )
    SELECT
      SUM(total_kmf - est_cost)::bigint AS margin_kmf,
      SUM(total_kmf) FILTER (WHERE est_cost IS NOT NULL)::bigint AS revenue_kmf,
      COUNT(*) FILTER (WHERE est_cost IS NOT NULL)::int AS items_with_data,
      COUNT(*)::int AS items_total
    FROM order_aggs
  `;
  const r = await db.query(sql, params);
  const margin = nullableKmf(r.rows[0].margin_kmf);
  const revenue = nullableKmf(r.rows[0].revenue_kmf);
  const itemsWithData = Number(r.rows[0].items_with_data) || 0;
  const itemsTotal = Number(r.rows[0].items_total) || 0;
  const pct = revenue > 0 ? Number(((margin / revenue) * 100).toFixed(2)) : null;

  return makeKpi('marge_estimee', 'Marge estimée', margin, 'KMF', {
    itemsTotal,
    itemsWithData,
    completeness: itemsWithData === itemsTotal && itemsTotal > 0 ? 'complete' : 'partial',
    warning: pct != null ? `${pct}% sur ${itemsWithData}/${itemsTotal} cmds` : null,
  });
}


async function getMargeVariableReelle(filters = {}) {
  // Marge variable reelle = CA - SUM(real allocations cost_type IN variable cost types)
  // Sur cmds qui ont AU MOINS les 5 cost_types variables alloues
  const { where, params } = buildFiltersClause(filters);
  const sql = `
    WITH order_set AS (
      SELECT o.id, o.total_kmf
      FROM orders o
      WHERE ${where}
        AND o.payment_status = 'paid'
        AND o.status NOT IN ('cancelled', 'refunded')
    ),
    orders_with_variable AS (
      SELECT os.id, os.total_kmf,
        (SELECT SUM(amount_kmf) FROM order_item_real_cost_allocations
         WHERE order_id = os.id AND cost_type::text = ANY($${params.length + 1}::text[])) AS variable_real
      FROM order_set os
      WHERE NOT EXISTS (
        SELECT 1 FROM unnest($${params.length + 1}::text[]) AS expected(t)
        WHERE NOT EXISTS (
          SELECT 1 FROM order_item_real_cost_allocations
          WHERE order_id = os.id AND cost_type::text = expected.t
        )
      )
    )
    SELECT
      SUM(total_kmf - variable_real)::bigint AS margin_kmf,
      SUM(total_kmf)::bigint AS revenue_kmf,
      COUNT(*)::int AS items_with_data,
      (SELECT COUNT(*) FROM order_set)::int AS items_total
    FROM orders_with_variable
  `;
  const r = await db.query(sql, [...params, EXPECTED_VARIABLE_COSTS]);
  const margin = nullableKmf(r.rows[0].margin_kmf);
  const revenue = nullableKmf(r.rows[0].revenue_kmf);
  const itemsWithData = Number(r.rows[0].items_with_data) || 0;
  const itemsTotal = Number(r.rows[0].items_total) || 0;
  const pct = revenue > 0 ? Number(((margin / revenue) * 100).toFixed(2)) : null;

  return makeKpi('marge_variable_reelle', 'Marge variable réelle', margin, 'KMF', {
    itemsTotal,
    itemsWithData,
    completeness: itemsTotal === 0 ? 'provisional' : (itemsWithData === itemsTotal ? 'complete' : 'partial'),
    warning: itemsWithData < itemsTotal
      ? `${pct != null ? pct + '% sur ' : ''}${itemsWithData}/${itemsTotal} cmds avec couts variables alloues`
      : null,
  });
}


async function getMargeConsolidee(filters = {}) {
  // Marge consolidee = CA - cout reel total
  // UNIQUEMENT sur cmds avec cost_status='actual'
  // (marge reelle FINALE calculable : commande remise au client, tous les couts applicables
  //  et attendus presents en reel justifie, douane connue ; les charges de structure ne sont
  //  jamais exigees par commande — D1)
  const { where, params } = buildFiltersClause(filters);
  const sql = `
    WITH order_set AS (
      SELECT o.id, o.total_kmf, o.status, o.payment_mode, o.relais_id
      FROM orders o
      WHERE ${where}
        AND o.payment_status = 'paid'
        AND o.status NOT IN ('cancelled', 'refunded')
    ),
    actual_orders AS (
      SELECT os.id, os.total_kmf,
        (SELECT SUM(amount_kmf) FROM order_item_real_cost_allocations
          WHERE order_id = os.id AND is_actual = TRUE AND COALESCE(source, '') <> 'monthly_recalc') AS real_total
      FROM order_set os
      WHERE EXISTS (SELECT 1 FROM order_item_cost_imputations WHERE order_id = os.id)
        AND ${costExpectation.finalMarginReadySql('os')}
    )
    SELECT
      SUM(total_kmf - real_total)::bigint AS margin_kmf,
      SUM(total_kmf)::bigint AS revenue_kmf,
      COUNT(*)::int AS items_with_data,
      (SELECT COUNT(*) FROM order_set)::int AS items_total
    FROM actual_orders
  `;
  const r = await db.query(sql, params);
  const margin = nullableKmf(r.rows[0].margin_kmf);
  const revenue = nullableKmf(r.rows[0].revenue_kmf);
  const itemsWithData = Number(r.rows[0].items_with_data) || 0;
  const itemsTotal = Number(r.rows[0].items_total) || 0;
  const pct = revenue > 0 ? Number(((margin / revenue) * 100).toFixed(2)) : null;

  return makeKpi('marge_consolidee', 'Marge consolidée', margin, 'KMF', {
    itemsTotal,
    itemsWithData,
    completeness: itemsTotal === 0
      ? 'provisional'
      : (itemsWithData === itemsTotal ? 'complete' : 'partial'),
    warning: itemsWithData < itemsTotal
      ? `${pct != null ? pct + '% sur ' : ''}${itemsWithData}/${itemsTotal} commandes finalisées (coûts réels)`
      : null,
  });
}


async function getCmdsCoutIncompletCount(filters = {}) {
  // Count des cmds dont cost_status != 'actual'
  // = cmds sans imputation OU avec couts attendus manquants
  const { where, params } = buildFiltersClause(filters);
  const sql = `
    SELECT COUNT(*)::int AS value
    FROM orders o
    WHERE ${where}
      AND o.status NOT IN ('cancelled', 'refunded')
      AND NOT ${costExpectation.nothingExpectedYetSql('o')}
      AND (
        NOT EXISTS (SELECT 1 FROM order_item_cost_imputations WHERE order_id = o.id)
        OR ${costExpectation.hasMissingExpectedSql('o')}
      )
  `;
  const r = await db.query(sql, params);
  const value = Number(r.rows[0].value) || 0;

  return makeKpi('cmds_cout_incomplet', 'Commandes aux coûts restant à établir', value, 'count', {
    drillTo: '/admin/finance#finance-incomplete-costs',
    warning: value > 0 ? 'Cliquer pour voir le detail' : null,
  });
}

/**
 * Retourne les order_ids correspondant a getCmdsCoutIncompletCount
 * Pour drill-down / table / export.
 */
async function getCmdsCoutIncompletIds(filters = {}, options = {}) {
  const limit = Math.min(1000, options.limit || 200);
  const { where, params } = buildFiltersClause(filters);
  const sql = `
    SELECT o.id, o.reference, o.status, o.payment_status, o.payment_mode::text AS payment_mode, o.total_kmf, o.created_at,
           (SELECT m.code FROM markets m WHERE m.id = o.market_id) AS market_code,
           ${costExpectation.contextColumnsSql('o')},
           ${costExpectation.missingTypesArraySql('o')} AS missing_cost_types,
           EXISTS (SELECT 1 FROM order_item_cost_imputations WHERE order_id = o.id) AS has_imputation
    FROM orders o
    WHERE ${where}
      AND o.status NOT IN ('cancelled', 'refunded')
      AND NOT ${costExpectation.nothingExpectedYetSql('o')}
      AND (
        NOT EXISTS (SELECT 1 FROM order_item_cost_imputations WHERE order_id = o.id)
        OR ${costExpectation.hasMissingExpectedSql('o')}
      )
    ORDER BY o.created_at DESC
    LIMIT $${params.length + 1}
  `;
  const r = await db.query(sql, [...params, limit]);
  return r.rows.map((row) => ({
    ...row,
    cost_explanation: {
      ...costExpectation.describeOrderCosts({
        status: row.status,
        payment_mode: row.payment_mode,
        imported: row.ctx_imported,
        customs_event: row.ctx_customs_event,
        relay_beneficiary: row.ctx_relay_beneficiary,
        hub_route: row.ctx_hub_route,
        hub_route_unknown: row.ctx_hub_route_unknown,
        customs_unknown: row.ctx_customs_unknown,
        missing_cost_types: row.missing_cost_types || [],
      }),
      missing_estimate: row.has_imputation === false,
    },
  }));
}



async function getCoutMoyParCmd(filters = {}) {
  const { where, params } = buildFiltersClause(filters);
  const sql = `
    WITH order_set AS (
      SELECT o.id FROM orders o
      WHERE ${where}
        AND o.payment_status = 'paid'
        AND o.status NOT IN ('cancelled', 'refunded')
    ),
    by_order AS (
      SELECT os.id,
        COUNT(DISTINCT oi.id)::int AS lines_expected,
        COUNT(DISTINCT oi.id) FILTER (
          WHERE imp.estimated_business_complete_cost_kmf IS NOT NULL
        )::int AS lines_priced,
        SUM(imp.estimated_business_complete_cost_kmf) AS cost_kmf
      FROM order_set os
      LEFT JOIN order_items oi ON oi.order_id = os.id
      LEFT JOIN order_item_cost_imputations imp
        ON imp.order_id = os.id AND imp.order_item_id = oi.id
      GROUP BY os.id
    )
    SELECT
      AVG(cost_kmf) FILTER (
        WHERE lines_expected > 0 AND lines_expected = lines_priced
      )::bigint AS value,
      COUNT(*)::int AS items_total,
      COUNT(*) FILTER (
        WHERE lines_expected > 0 AND lines_expected = lines_priced
      )::int AS items_with_data
    FROM by_order
  `;
  const r = await db.query(sql, params);
  const value = nullableKmf(r.rows[0].value);
  const itemsTotal = Number(r.rows[0].items_total) || 0;
  const itemsWithData = Number(r.rows[0].items_with_data) || 0;

  return makeKpi('cout_moy_par_cmd', 'Coût moyen par commande', value, 'KMF', {
    itemsTotal,
    itemsWithData,
    completeness: itemsTotal === 0 ? 'provisional' : (itemsWithData === itemsTotal ? 'complete' : 'partial'),
    warning: itemsTotal > itemsWithData
      ? `Moyenne sur ${itemsWithData}/${itemsTotal} commandes aux coûts connus` : null,
  });
}

module.exports = {
  getCAVendu,
  getCoutEstime,
  getCoutReel,
  getMargeEstimee,
  getMargeVariableReelle,
  getMargeConsolidee,
  getCmdsCoutIncompletCount,
  getCmdsCoutIncompletIds,
  getCoutMoyParCmd,
};
