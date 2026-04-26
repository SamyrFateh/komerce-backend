/**
 * KOMERCE — Dashboard Metrics Service (Sprint 1)
 * ════════════════════════════════════════════════════════════════════════
 *
 * DOCTRINE :
 *   Centralise les definitions canoniques des KPIs dashboard.
 *   Chaque KPI a UNE source de verite. Si deux vues affichent le meme
 *   KPI, elles appellent la meme fonction ici. Pas de SQL inline ailleurs.
 *
 * INVARIANTS GARANTIS :
 *   INV-1 : ca_encaisse == ca_vendu (memes filtres)
 *   INV-2 : cmds_actives identique sur Tour de controle et Logistique
 *   INV-3 : colis_transit identique
 *   INV-4 : taux_completude_couts coherent avec cmds_cout_incomplet
 *   INV-5 : cmds_creees_workspace ⊂ cmds_creees
 *   INV-6 : marge hierarchy : items_actual ≤ items_partial ≤ items_estimated
 *
 * ENUM cost_status (canonique Sprint 1) :
 *   estimated     = snapshot pricing-engine seul, aucun cout reel
 *   partial_real  = couts variables alloues mais types attendus manquants
 *   actual        = tous les types attendus alloues (ex-'complete')
 *   incomplete    = imputation absente / cas pathologique
 *
 * cmds_actives = status IN (confirmed, ordered, preparation, shipped, in_transit, available)
 *   (PAS pending, PAS collected, PAS cancelled, PAS refunded)
 */

'use strict';

const db = require('../db');

// ═══════════════════════════════════════════════════════════════════════
// CONSTANTES DOCTRINE
// ═══════════════════════════════════════════════════════════════════════

const ACTIVE_ORDER_STATUSES = Object.freeze([
  'confirmed', 'ordered', 'preparation', 'shipped', 'in_transit', 'available',
]);

const VALID_PAID_STATUSES = Object.freeze(['paid']);

const TRANSIT_PARCEL_STATUSES = Object.freeze([
  'shipped', 'in_transit', 'arrived',
]);

const EXCLUDED_FROM_REVENUE = Object.freeze(['cancelled', 'refunded']);

// Cost types attendus pour qu'une commande soit 'actual'
const EXPECTED_VARIABLE_COSTS = Object.freeze([
  'product_purchase', 'freight', 'customs', 'local_distribution', 'relay',
]);
const EXPECTED_FIXED_COSTS = Object.freeze([
  'hub', 'risk_provision', 'fixed_overhead',
]);
const EXPECTED_PAYMENT_COSTS = Object.freeze(['payment']);

// ═══════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════

/**
 * Construit la clause WHERE SQL depuis les filtres communs.
 * Tous les KPIs utilisent ce builder pour la coherence.
 *
 * @param {object} filters - { from, to, island, relais_id, status, payment_status }
 * @param {string} orderAlias - alias de la table orders (default 'o')
 * @returns {{where: string, params: Array, nextParamIndex: number}}
 */
function buildFiltersClause(filters = {}, orderAlias = 'o') {
  const where = ['1=1'];
  const params = [];
  let i = 1;

  if (filters.from) {
    where.push(`${orderAlias}.created_at >= $${i++}`);
    params.push(filters.from);
  }
  if (filters.to) {
    where.push(`${orderAlias}.created_at <= $${i++}`);
    params.push(filters.to);
  }
  if (filters.island) {
    where.push(`${orderAlias}.destination_island = $${i++}`);
    params.push(filters.island);
  }
  if (filters.relais_id) {
    where.push(`${orderAlias}.relais_id = $${i++}`);
    params.push(filters.relais_id);
  }
  if (filters.status) {
    where.push(`${orderAlias}.status = $${i++}`);
    params.push(filters.status);
  }
  if (filters.payment_status) {
    where.push(`${orderAlias}.payment_status = $${i++}`);
    params.push(filters.payment_status);
  }

  return { where: where.join(' AND '), params, nextParamIndex: i };
}

/**
 * Calcule la periode anterieure de meme duree pour comparaison delta.
 * Si filters.from = 2026-04-01 et filters.to = 2026-04-30,
 * retourne { from: 2026-03-02, to: 2026-04-01 } (29 jours avant).
 */
function buildPreviousPeriod(filters) {
  if (!filters.from || !filters.to) return null;

  const from = new Date(filters.from);
  const to = new Date(filters.to);
  if (isNaN(from) || isNaN(to)) return null;

  const durationMs = to.getTime() - from.getTime();
  if (durationMs <= 0) return null;

  return {
    ...filters,
    from: new Date(from.getTime() - durationMs).toISOString(),
    to: new Date(from.getTime()).toISOString(),
  };
}

/**
 * Calcule un delta entre valeur courante et anterieure.
 */
function computeDelta(currentValue, previousValue, vsPeriodLabel) {
  if (previousValue == null || previousValue === 0) {
    return {
      value: null,
      unit: '%',
      direction: 'flat',
      vs_period: vsPeriodLabel,
      is_comparable: false,
    };
  }
  const diff = currentValue - previousValue;
  const pct = (diff / Math.abs(previousValue)) * 100;
  return {
    value: Number(pct.toFixed(2)),
    unit: '%',
    direction: pct > 0 ? 'up' : (pct < 0 ? 'down' : 'flat'),
    vs_period: vsPeriodLabel,
    is_comparable: true,
  };
}

function _round(n) { return n != null && !isNaN(n) ? Math.round(Number(n)) : null; }

/**
 * Format standardise pour un KPI.
 */
function makeKpi(key, label, value, unit, options = {}) {
  return {
    key,
    label,
    value,
    unit,
    delta: options.delta || null,
    data_quality: {
      completeness: options.completeness || 'complete',
      items_total: options.itemsTotal != null ? options.itemsTotal : null,
      items_with_data: options.itemsWithData != null ? options.itemsWithData : null,
      warning: options.warning || null,
    },
    drill_to: options.drillTo || null,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// TOUR DE CONTROLE — 8 KPIs
// ═══════════════════════════════════════════════════════════════════════

async function getCAEncaisse(filters = {}) {
  const { where, params } = buildFiltersClause(filters);
  const sql = `
    SELECT COALESCE(SUM(o.total_kmf), 0)::bigint AS value,
           COUNT(*)::int AS items_total
    FROM orders o
    WHERE ${where}
      AND o.payment_status = 'paid'
      AND o.status NOT IN ('cancelled', 'refunded')
  `;
  const r = await db.query(sql, params);
  const value = Number(r.rows[0].value) || 0;
  const itemsTotal = Number(r.rows[0].items_total) || 0;

  // Delta vs periode anterieure
  let delta = null;
  const prev = buildPreviousPeriod(filters);
  if (prev) {
    const prevQuery = buildFiltersClause(prev);
    const prevSql = `
      SELECT COALESCE(SUM(o.total_kmf), 0)::bigint AS value
      FROM orders o
      WHERE ${prevQuery.where}
        AND o.payment_status = 'paid'
        AND o.status NOT IN ('cancelled', 'refunded')
    `;
    const prevR = await db.query(prevSql, prevQuery.params);
    delta = computeDelta(value, Number(prevR.rows[0].value), 'periode precedente');
  }

  return makeKpi('ca_encaisse', 'CA encaissé', value, 'KMF', {
    delta,
    itemsTotal,
    itemsWithData: itemsTotal,
    completeness: 'complete',
    drillTo: '/admin/costing',
  });
}

async function getCmdsCreees(filters = {}) {
  const { where, params } = buildFiltersClause(filters);
  const sql = `SELECT COUNT(*)::int AS value FROM orders o WHERE ${where}`;
  const r = await db.query(sql, params);
  const value = Number(r.rows[0].value) || 0;

  let delta = null;
  const prev = buildPreviousPeriod(filters);
  if (prev) {
    const prevQuery = buildFiltersClause(prev);
    const prevR = await db.query(`SELECT COUNT(*)::int AS value FROM orders o WHERE ${prevQuery.where}`, prevQuery.params);
    delta = computeDelta(value, Number(prevR.rows[0].value), 'periode precedente');
  }

  return makeKpi('cmds_creees', 'Commandes créées', value, 'count', {
    delta,
    drillTo: '/admin/orders-logistics',
  });
}

async function getCmdsActives(filters = {}) {
  // Definition canonique : status IN (confirmed, ordered, preparation, shipped, in_transit, available)
  // PAS pending (paiement non valide)
  // PAS collected (livre)
  // PAS cancelled, refunded
  const { where, params } = buildFiltersClause(filters);
  const sql = `
    SELECT COUNT(*)::int AS value
    FROM orders o
    WHERE ${where}
      AND o.status = ANY($${params.length + 1}::text[])
  `;
  const r = await db.query(sql, [...params, ACTIVE_ORDER_STATUSES]);
  const value = Number(r.rows[0].value) || 0;

  return makeKpi('cmds_actives', 'Commandes actives', value, 'count', {
    drillTo: '/admin/orders-logistics?status=active',
  });
}

async function getColisEnTransit(filters = {}) {
  // colis transit : shipped | in_transit | arrived
  // Filtres orders applicables si parcel.order_id pertinent
  const { where, params } = buildFiltersClause(filters, 'o');
  const sql = `
    SELECT COUNT(DISTINCT p.id)::int AS value
    FROM parcels p
    JOIN orders o ON o.id = p.order_id
    WHERE ${where}
      AND p.status = ANY($${params.length + 1}::text[])
  `;
  const r = await db.query(sql, [...params, TRANSIT_PARCEL_STATUSES]);
  const value = Number(r.rows[0].value) || 0;

  return makeKpi('colis_transit', 'Colis en transit', value, 'count', {
    drillTo: '/admin/orders-logistics?parcel_status=in_transit',
  });
}

async function getAlertesCritiques(filters = {}) {
  // Alertes non resolues, level critical (ou elevated tres impactant)
  const sql = `
    SELECT COUNT(*)::int AS value
    FROM alerts
    WHERE level IN ('critical', 'elevated')
      AND resolved_at IS NULL
      ${filters.from ? 'AND created_at >= $1' : ''}
      ${filters.to   ? `AND created_at <= $${filters.from ? 2 : 1}` : ''}
  `;
  const params = [];
  if (filters.from) params.push(filters.from);
  if (filters.to)   params.push(filters.to);

  const r = await db.query(sql, params);
  const value = Number(r.rows[0].value) || 0;

  return makeKpi('alertes_critiques', 'Alertes critiques', value, 'count', {
    drillTo: '/admin/alerts?level=critical',
    warning: value > 10 ? 'Beaucoup d\'alertes non resolues' : null,
  });
}

async function getCmdsBloquees(filters = {}) {
  // Commandes payees mais bloquees (paid_but_stock_blocked dans notes)
  const { where, params } = buildFiltersClause(filters);
  const sql = `
    SELECT COUNT(*)::int AS value
    FROM orders o
    WHERE ${where}
      AND o.payment_status = 'paid'
      AND o.notes ILIKE '%paid_but_stock_blocked%'
      AND o.status NOT IN ('cancelled', 'refunded', 'collected')
  `;
  const r = await db.query(sql, params);
  const value = Number(r.rows[0].value) || 0;

  return makeKpi('cmds_bloquees', 'Commandes bloquées', value, 'count', {
    drillTo: '/admin/orders-logistics?anomalie=stock_blocked',
    warning: value > 0 ? `${value} commande(s) payée(s) sans stock` : null,
  });
}

async function getTauxCompletudeScans(filters = {}) {
  // Ratio parcels avec >=1 scan / parcels in transit ou apres
  const { where, params } = buildFiltersClause(filters, 'o');
  const sql = `
    WITH transit_parcels AS (
      SELECT p.id
      FROM parcels p
      JOIN orders o ON o.id = p.order_id
      WHERE ${where}
        AND p.status = ANY($${params.length + 1}::text[])
    )
    SELECT
      (SELECT COUNT(*) FROM transit_parcels)::int AS items_total,
      (SELECT COUNT(DISTINCT s.order_id)
       FROM scans s
       WHERE s.order_id IN (SELECT order_id FROM parcels WHERE id IN (SELECT id FROM transit_parcels)))::int AS items_with_data
  `;
  const r = await db.query(sql, [...params, [...TRANSIT_PARCEL_STATUSES, 'available', 'collected']]);
  const itemsTotal = Number(r.rows[0].items_total) || 0;
  const itemsWithData = Number(r.rows[0].items_with_data) || 0;
  const value = itemsTotal > 0 ? Number(((itemsWithData / itemsTotal) * 100).toFixed(2)) : null;

  return makeKpi('taux_completude_scans', 'Taux complétude scans', value, '%', {
    itemsTotal,
    itemsWithData,
    completeness: itemsTotal > 0 ? 'complete' : 'provisional',
    warning: value != null && value < 80 ? 'Taux de scans bas' : null,
  });
}

async function getTauxCompletudeCouts(filters = {}) {
  // Ratio cmds avec cost_status='actual' / total cmds
  const { where, params } = buildFiltersClause(filters);
  const sql = `
    WITH order_set AS (
      SELECT o.id FROM orders o
      WHERE ${where}
        AND o.status NOT IN ('cancelled', 'refunded')
    ),
    actual_orders AS (
      SELECT os.id
      FROM order_set os
      WHERE EXISTS (SELECT 1 FROM order_item_cost_imputations WHERE order_id = os.id)
        AND NOT EXISTS (
          SELECT 1 FROM unnest($${params.length + 1}::text[]) AS expected(t)
          WHERE NOT EXISTS (
            SELECT 1 FROM order_item_real_cost_allocations alc
            WHERE alc.order_id = os.id AND alc.cost_type = expected.t
          )
        )
    )
    SELECT
      (SELECT COUNT(*) FROM order_set)::int AS items_total,
      (SELECT COUNT(*) FROM actual_orders)::int AS items_with_data
  `;
  const expectedAll = [...EXPECTED_VARIABLE_COSTS, ...EXPECTED_FIXED_COSTS, ...EXPECTED_PAYMENT_COSTS];
  const r = await db.query(sql, [...params, expectedAll]);
  const itemsTotal = Number(r.rows[0].items_total) || 0;
  const itemsWithData = Number(r.rows[0].items_with_data) || 0;
  const value = itemsTotal > 0 ? Number(((itemsWithData / itemsTotal) * 100).toFixed(2)) : null;

  return makeKpi('taux_completude_couts', 'Taux complétude coûts', value, '%', {
    itemsTotal,
    itemsWithData,
    completeness: itemsTotal > 0 ? (itemsWithData === itemsTotal ? 'complete' : 'partial') : 'provisional',
    warning: value != null && value < 50 ? 'Beaucoup de commandes sans cout consolide' : null,
    drillTo: '/admin/costing?cost_status=incomplete',
  });
}

// ═══════════════════════════════════════════════════════════════════════
// COSTING — 8 KPIs
// ═══════════════════════════════════════════════════════════════════════

// CA vendu = alias semantique de ca_encaisse (INV-1)
async function getCAVendu(filters = {}) {
  const ca = await getCAEncaisse(filters);
  return { ...ca, key: 'ca_vendu', label: 'CA vendu' };
}

async function getCoutEstime(filters = {}) {
  const { where, params } = buildFiltersClause(filters);
  const sql = `
    SELECT
      COALESCE(SUM(imp.estimated_business_complete_cost_kmf), 0)::bigint AS value,
      COUNT(DISTINCT imp.order_id)::int AS items_with_data,
      (SELECT COUNT(*)::int FROM orders o WHERE ${where} AND o.status NOT IN ('cancelled','refunded')) AS items_total
    FROM order_item_cost_imputations imp
    JOIN orders o ON o.id = imp.order_id
    WHERE ${where}
      AND o.status NOT IN ('cancelled', 'refunded')
  `;
  // Note : on duplique les params pour les 2 clauses where
  const r = await db.query(sql, [...params, ...params]);
  const value = Number(r.rows[0].value) || 0;
  const itemsWithData = Number(r.rows[0].items_with_data) || 0;
  const itemsTotal = Number(r.rows[0].items_total) || 0;

  return makeKpi('cout_estime', 'Coût estimé', value, 'KMF', {
    itemsTotal,
    itemsWithData,
    completeness: itemsWithData === itemsTotal && itemsTotal > 0 ? 'complete' : 'partial',
    warning: itemsTotal > 0 && itemsWithData < itemsTotal
      ? `${itemsTotal - itemsWithData} commande(s) sans snapshot pricing-engine`
      : null,
  });
}

async function getCoutReel(filters = {}) {
  const { where, params } = buildFiltersClause(filters);
  const sql = `
    SELECT
      COALESCE(SUM(alc.amount_kmf), 0)::bigint AS value,
      COUNT(DISTINCT alc.order_id)::int AS items_with_data,
      (SELECT COUNT(*)::int FROM orders o WHERE ${where} AND o.status NOT IN ('cancelled','refunded')) AS items_total
    FROM order_item_real_cost_allocations alc
    JOIN orders o ON o.id = alc.order_id
    WHERE ${where}
      AND o.status NOT IN ('cancelled', 'refunded')
      AND alc.is_actual = TRUE
  `;
  const r = await db.query(sql, [...params, ...params]);
  const value = Number(r.rows[0].value) || 0;
  const itemsWithData = Number(r.rows[0].items_with_data) || 0;
  const itemsTotal = Number(r.rows[0].items_total) || 0;

  return makeKpi('cout_reel', 'Coût réel', value, 'KMF', {
    itemsTotal,
    itemsWithData,
    completeness: itemsTotal === 0 ? 'provisional' : (itemsWithData === itemsTotal ? 'complete' : 'partial'),
    warning: itemsTotal > 0 && itemsWithData < itemsTotal
      ? `Reel partiel : ${itemsWithData}/${itemsTotal} commandes ventilees`
      : null,
  });
}

async function getMargeEstimee(filters = {}) {
  // Marge estimee = CA - cout_estime (sur cmds avec snapshot)
  const { where, params } = buildFiltersClause(filters);
  const sql = `
    WITH order_aggs AS (
      SELECT
        o.id,
        o.total_kmf,
        COALESCE((SELECT SUM(estimated_business_complete_cost_kmf) FROM order_item_cost_imputations WHERE order_id = o.id), NULL) AS est_cost
      FROM orders o
      WHERE ${where}
        AND o.payment_status = 'paid'
        AND o.status NOT IN ('cancelled', 'refunded')
    )
    SELECT
      COALESCE(SUM(total_kmf - est_cost), 0)::bigint AS margin_kmf,
      COALESCE(SUM(total_kmf), 0)::bigint AS revenue_kmf,
      COUNT(*) FILTER (WHERE est_cost IS NOT NULL)::int AS items_with_data,
      COUNT(*)::int AS items_total
    FROM order_aggs
  `;
  const r = await db.query(sql, params);
  const margin = Number(r.rows[0].margin_kmf) || 0;
  const revenue = Number(r.rows[0].revenue_kmf) || 0;
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
         WHERE order_id = os.id AND cost_type = ANY($${params.length + 1}::text[])) AS variable_real
      FROM order_set os
      WHERE NOT EXISTS (
        SELECT 1 FROM unnest($${params.length + 1}::text[]) AS expected(t)
        WHERE NOT EXISTS (
          SELECT 1 FROM order_item_real_cost_allocations
          WHERE order_id = os.id AND cost_type = expected.t
        )
      )
    )
    SELECT
      COALESCE(SUM(total_kmf - variable_real), 0)::bigint AS margin_kmf,
      COALESCE(SUM(total_kmf), 0)::bigint AS revenue_kmf,
      COUNT(*)::int AS items_with_data,
      (SELECT COUNT(*) FROM order_set)::int AS items_total
    FROM orders_with_variable
  `;
  const r = await db.query(sql, [...params, EXPECTED_VARIABLE_COSTS]);
  const margin = Number(r.rows[0].margin_kmf) || 0;
  const revenue = Number(r.rows[0].revenue_kmf) || 0;
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
  // (toutes les categories attendues alloues : variables + fixes + payment)
  const { where, params } = buildFiltersClause(filters);
  const expectedAll = [...EXPECTED_VARIABLE_COSTS, ...EXPECTED_FIXED_COSTS, ...EXPECTED_PAYMENT_COSTS];
  const sql = `
    WITH order_set AS (
      SELECT o.id, o.total_kmf
      FROM orders o
      WHERE ${where}
        AND o.payment_status = 'paid'
        AND o.status NOT IN ('cancelled', 'refunded')
    ),
    actual_orders AS (
      SELECT os.id, os.total_kmf,
        (SELECT SUM(amount_kmf) FROM order_item_real_cost_allocations WHERE order_id = os.id) AS real_total
      FROM order_set os
      WHERE EXISTS (SELECT 1 FROM order_item_cost_imputations WHERE order_id = os.id)
        AND NOT EXISTS (
          SELECT 1 FROM unnest($${params.length + 1}::text[]) AS expected(t)
          WHERE NOT EXISTS (
            SELECT 1 FROM order_item_real_cost_allocations
            WHERE order_id = os.id AND cost_type = expected.t
          )
        )
    )
    SELECT
      COALESCE(SUM(total_kmf - real_total), 0)::bigint AS margin_kmf,
      COALESCE(SUM(total_kmf), 0)::bigint AS revenue_kmf,
      COUNT(*)::int AS items_with_data,
      (SELECT COUNT(*) FROM order_set)::int AS items_total
    FROM actual_orders
  `;
  const r = await db.query(sql, [...params, expectedAll]);
  const margin = Number(r.rows[0].margin_kmf) || 0;
  const revenue = Number(r.rows[0].revenue_kmf) || 0;
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
      ? `${pct != null ? pct + '% sur ' : ''}${itemsWithData}/${itemsTotal} cmds finalisees (cost_status=actual)`
      : null,
  });
}

async function getCmdsCoutIncompletCount(filters = {}) {
  // Count des cmds dont cost_status != 'actual'
  // = cmds sans imputation OU avec couts attendus manquants
  const { where, params } = buildFiltersClause(filters);
  const expectedAll = [...EXPECTED_VARIABLE_COSTS, ...EXPECTED_FIXED_COSTS, ...EXPECTED_PAYMENT_COSTS];
  const sql = `
    SELECT COUNT(*)::int AS value
    FROM orders o
    WHERE ${where}
      AND o.status NOT IN ('cancelled', 'refunded')
      AND (
        NOT EXISTS (SELECT 1 FROM order_item_cost_imputations WHERE order_id = o.id)
        OR EXISTS (
          SELECT 1 FROM unnest($${params.length + 1}::text[]) AS expected(t)
          WHERE NOT EXISTS (
            SELECT 1 FROM order_item_real_cost_allocations
            WHERE order_id = o.id AND cost_type = expected.t
          )
        )
      )
  `;
  const r = await db.query(sql, [...params, expectedAll]);
  const value = Number(r.rows[0].value) || 0;

  return makeKpi('cmds_cout_incomplet', 'Commandes coût incomplet', value, 'count', {
    drillTo: '/admin/costing?cost_status=incomplete,partial_real,estimated',
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
  const expectedAll = [...EXPECTED_VARIABLE_COSTS, ...EXPECTED_FIXED_COSTS, ...EXPECTED_PAYMENT_COSTS];
  const sql = `
    SELECT o.id, o.reference, o.status, o.payment_status, o.total_kmf, o.created_at
    FROM orders o
    WHERE ${where}
      AND o.status NOT IN ('cancelled', 'refunded')
      AND (
        NOT EXISTS (SELECT 1 FROM order_item_cost_imputations WHERE order_id = o.id)
        OR EXISTS (
          SELECT 1 FROM unnest($${params.length + 1}::text[]) AS expected(t)
          WHERE NOT EXISTS (
            SELECT 1 FROM order_item_real_cost_allocations
            WHERE order_id = o.id AND cost_type = expected.t
          )
        )
      )
    ORDER BY o.created_at DESC
    LIMIT $${params.length + 2}
  `;
  const r = await db.query(sql, [...params, expectedAll, limit]);
  return r.rows;
}

async function getCoutMoyParCmd(filters = {}) {
  const { where, params } = buildFiltersClause(filters);
  const sql = `
    WITH order_set AS (
      SELECT o.id
      FROM orders o
      WHERE ${where}
        AND o.payment_status = 'paid'
        AND o.status NOT IN ('cancelled', 'refunded')
    )
    SELECT
      COALESCE(AVG(
        (SELECT COALESCE(SUM(estimated_business_complete_cost_kmf), 0)
         FROM order_item_cost_imputations WHERE order_id = os.id)
      ), 0)::bigint AS value,
      COUNT(*)::int AS items_total
    FROM order_set os
  `;
  const r = await db.query(sql, params);
  const value = Number(r.rows[0].value) || 0;
  const itemsTotal = Number(r.rows[0].items_total) || 0;

  return makeKpi('cout_moy_par_cmd', 'Coût moyen par commande', value, 'KMF', {
    itemsTotal,
    itemsWithData: itemsTotal,
    completeness: itemsTotal > 0 ? 'complete' : 'provisional',
  });
}

// ═══════════════════════════════════════════════════════════════════════
// LOGISTICS — 8 KPIs (alias + nouveaux)
// ═══════════════════════════════════════════════════════════════════════

async function getCmdsAujourdhui(filters = {}) {
  const sql = `
    SELECT COUNT(*)::int AS value
    FROM orders o
    WHERE o.created_at >= CURRENT_DATE
      AND o.created_at < CURRENT_DATE + INTERVAL '1 day'
  `;
  const r = await db.query(sql);
  const value = Number(r.rows[0].value) || 0;

  // Delta vs hier
  const ySql = `
    SELECT COUNT(*)::int AS value
    FROM orders o
    WHERE o.created_at >= CURRENT_DATE - INTERVAL '1 day'
      AND o.created_at < CURRENT_DATE
  `;
  const yR = await db.query(ySql);
  const delta = computeDelta(value, Number(yR.rows[0].value), 'hier');

  return makeKpi('cmds_aujourdhui', 'Commandes aujourd\'hui', value, 'count', { delta });
}

async function getPaiementsEnAttente(filters = {}) {
  const { where, params } = buildFiltersClause(filters);
  const sql = `
    SELECT COUNT(*)::int AS value
    FROM orders o
    WHERE ${where}
      AND o.payment_status = 'pending'
      AND o.status NOT IN ('cancelled', 'refunded')
  `;
  const r = await db.query(sql, params);
  const value = Number(r.rows[0].value) || 0;

  return makeKpi('paiements_en_attente', 'Paiements en attente', value, 'count', {
    drillTo: '/admin/orders-logistics?payment_status=pending',
  });
}

async function getColisPreparation(filters = {}) {
  const { where, params } = buildFiltersClause(filters, 'o');
  const sql = `
    SELECT COUNT(DISTINCT p.id)::int AS value
    FROM parcels p
    JOIN orders o ON o.id = p.order_id
    WHERE ${where}
      AND p.status = 'preparation'
  `;
  const r = await db.query(sql, params);
  const value = Number(r.rows[0].value) || 0;
  return makeKpi('colis_preparation', 'Colis préparation', value, 'count');
}

// Alias pour INV-3
async function getColisTransit(filters) { return getColisEnTransit(filters); }

async function getDisponiblesRelais(filters = {}) {
  const { where, params } = buildFiltersClause(filters, 'o');
  const sql = `
    SELECT COUNT(DISTINCT p.id)::int AS value
    FROM parcels p
    JOIN orders o ON o.id = p.order_id
    WHERE ${where}
      AND p.status = 'available'
  `;
  const r = await db.query(sql, params);
  const value = Number(r.rows[0].value) || 0;
  return makeKpi('disponibles_relais', 'Disponibles relais', value, 'count', {
    drillTo: '/admin/orders-logistics?parcel_status=available',
  });
}

async function getRetardsCritiques(filters = {}) {
  const { where, params } = buildFiltersClause(filters, 'o');
  const sql = `
    SELECT COUNT(DISTINCT p.id)::int AS value
    FROM parcels p
    JOIN orders o ON o.id = p.order_id
    WHERE ${where}
      AND p.shipped_at IS NOT NULL
      AND p.shipped_at < NOW() - INTERVAL '14 days'
      AND p.status NOT IN ('available', 'collected', 'cancelled')
  `;
  const r = await db.query(sql, params);
  const value = Number(r.rows[0].value) || 0;

  return makeKpi('retards_critiques', 'Retards critiques', value, 'count', {
    warning: value > 0 ? `${value} colis en retard de plus de 14 jours` : null,
  });
}

async function getTauxCollecteRelais(filters = {}) {
  // Ratio collected / (available + collected) sur la periode
  const { where, params } = buildFiltersClause(filters, 'o');
  const sql = `
    SELECT
      COUNT(*) FILTER (WHERE p.status = 'collected')::int AS collected,
      COUNT(*) FILTER (WHERE p.status IN ('available', 'collected'))::int AS available_or_collected
    FROM parcels p
    JOIN orders o ON o.id = p.order_id
    WHERE ${where}
  `;
  const r = await db.query(sql, params);
  const collected = Number(r.rows[0].collected) || 0;
  const total = Number(r.rows[0].available_or_collected) || 0;
  const value = total > 0 ? Number(((collected / total) * 100).toFixed(2)) : null;

  return makeKpi('taux_collecte_relais', 'Taux collecte relais', value, '%', {
    itemsTotal: total,
    itemsWithData: collected,
    completeness: total > 0 ? 'complete' : 'provisional',
  });
}

// ═══════════════════════════════════════════════════════════════════════
// WORKSPACES — 8 KPIs
// ═══════════════════════════════════════════════════════════════════════

async function getWorkspacesActifs(filters = {}) {
  const sql = `
    SELECT COUNT(*)::int AS value
    FROM collective_workspaces
    WHERE status IN ('conception', 'finalization_review', 'payment_pending')
      ${filters.from ? 'AND created_at >= $1' : ''}
      ${filters.to ? `AND created_at <= $${filters.from ? 2 : 1}` : ''}
  `;
  const params = [];
  if (filters.from) params.push(filters.from);
  if (filters.to)   params.push(filters.to);

  const r = await db.query(sql, params);
  const value = Number(r.rows[0].value) || 0;
  return makeKpi('workspaces_actifs', 'Workspaces actifs', value, 'count', {
    drillTo: '/admin/event-workspaces?status=active',
  });
}

async function getSessionsOuvertes(filters = {}) {
  const sql = `
    SELECT COUNT(*)::int AS value
    FROM collective_payment_sessions
    WHERE status = 'open'
      AND (expires_at IS NULL OR expires_at > NOW())
  `;
  const r = await db.query(sql);
  const value = Number(r.rows[0].value) || 0;
  return makeKpi('sessions_ouvertes', 'Sessions paiement ouvertes', value, 'count');
}

async function getTauxCompletion(filters = {}) {
  // Ratio orders crees / sessions lancees (sur periode)
  const sql = `
    SELECT
      (SELECT COUNT(*)::int FROM collective_workspaces
       WHERE order_id IS NOT NULL
         ${filters.from ? 'AND created_at >= $1' : ''}
         ${filters.to ? `AND created_at <= $${filters.from ? 2 : 1}` : ''}
      ) AS items_with_data,
      (SELECT COUNT(*)::int FROM collective_payment_sessions
       WHERE 1=1
         ${filters.from ? 'AND created_at >= $1' : ''}
         ${filters.to ? `AND created_at <= $${filters.from ? 2 : 1}` : ''}
      ) AS items_total
  `;
  const params = [];
  if (filters.from) params.push(filters.from);
  if (filters.to)   params.push(filters.to);

  const r = await db.query(sql, params);
  const itemsTotal = Number(r.rows[0].items_total) || 0;
  const itemsWithData = Number(r.rows[0].items_with_data) || 0;
  const value = itemsTotal > 0 ? Number(((itemsWithData / itemsTotal) * 100).toFixed(2)) : null;

  return makeKpi('taux_completion', 'Taux complétion', value, '%', {
    itemsTotal,
    itemsWithData,
    completeness: itemsTotal > 0 ? 'complete' : 'provisional',
  });
}

async function getMontantTotalEvenements(filters = {}) {
  const sql = `
    SELECT COALESCE(SUM(cart_total_kmf), 0)::bigint AS value
    FROM collective_workspaces
    WHERE status NOT IN ('cancelled', 'archived')
      ${filters.from ? 'AND created_at >= $1' : ''}
      ${filters.to ? `AND created_at <= $${filters.from ? 2 : 1}` : ''}
  `;
  const params = [];
  if (filters.from) params.push(filters.from);
  if (filters.to)   params.push(filters.to);

  const r = await db.query(sql, params);
  const value = Number(r.rows[0].value) || 0;
  return makeKpi('montant_total_evenements', 'Montant total événements', value, 'KMF');
}

async function getSessionsSansCommande(filters = {}) {
  const sql = `
    SELECT COUNT(*)::int AS value
    FROM collective_payment_sessions
    WHERE status = 'ended'
      AND order_id IS NULL
      ${filters.from ? 'AND ended_at >= $1' : ''}
      ${filters.to ? `AND ended_at <= $${filters.from ? 2 : 1}` : ''}
  `;
  const params = [];
  if (filters.from) params.push(filters.from);
  if (filters.to)   params.push(filters.to);

  const r = await db.query(sql, params);
  const value = Number(r.rows[0].value) || 0;
  return makeKpi('sessions_sans_commande', 'Sessions terminées sans commande', value, 'count', {
    warning: value > 0 ? 'Sessions a relancer eventuellement' : null,
  });
}

async function getCmdsCreeesWorkspace(filters = {}) {
  const { where, params } = buildFiltersClause(filters);
  const sql = `
    SELECT COUNT(*)::int AS value
    FROM orders o
    WHERE ${where}
      AND o.collective_workspace_id IS NOT NULL
  `;
  const r = await db.query(sql, params);
  const value = Number(r.rows[0].value) || 0;
  return makeKpi('cmds_creees_workspace', 'Commandes créées (workspace)', value, 'count', {
    drillTo: '/admin/orders-logistics?origin=workspace',
  });
}

async function getPanierMoyEvenement(filters = {}) {
  const sql = `
    SELECT COALESCE(AVG(cart_total_kmf), 0)::bigint AS value,
           COUNT(*)::int AS items_total
    FROM collective_workspaces
    WHERE status NOT IN ('cancelled', 'archived')
      ${filters.from ? 'AND created_at >= $1' : ''}
      ${filters.to ? `AND created_at <= $${filters.from ? 2 : 1}` : ''}
  `;
  const params = [];
  if (filters.from) params.push(filters.from);
  if (filters.to)   params.push(filters.to);

  const r = await db.query(sql, params);
  const value = Number(r.rows[0].value) || 0;
  const itemsTotal = Number(r.rows[0].items_total) || 0;

  return makeKpi('panier_moy_evenement', 'Panier moyen événement', value, 'KMF', {
    itemsTotal,
    completeness: itemsTotal > 0 ? 'complete' : 'provisional',
  });
}

async function getParticipantsMoy(filters = {}) {
  // Moyenne du nombre de participants par workspace
  const sql = `
    SELECT COALESCE(AVG(participant_count), 0)::numeric AS value,
           COUNT(*)::int AS items_total
    FROM (
      SELECT
        cw.id,
        (SELECT COUNT(DISTINCT participant_label)
         FROM collective_workspace_intentions
         WHERE workspace_id = cw.id) AS participant_count
      FROM collective_workspaces cw
      WHERE cw.status NOT IN ('cancelled', 'archived')
        ${filters.from ? 'AND cw.created_at >= $1' : ''}
        ${filters.to ? `AND cw.created_at <= $${filters.from ? 2 : 1}` : ''}
    ) sub
  `;
  const params = [];
  if (filters.from) params.push(filters.from);
  if (filters.to)   params.push(filters.to);

  let r;
  try {
    r = await db.query(sql, params);
  } catch (err) {
    // collective_workspace_intentions n'existe peut-etre pas selon schema
    return makeKpi('participants_moy', 'Participants moyens', null, 'count', {
      completeness: 'provisional',
      warning: 'Donnees indisponibles : ' + err.message,
    });
  }
  const value = Number(Number(r.rows[0].value).toFixed(2));
  const itemsTotal = Number(r.rows[0].items_total) || 0;

  return makeKpi('participants_moy', 'Participants moyens', value, 'count', {
    itemsTotal,
    completeness: itemsTotal > 0 ? 'complete' : 'provisional',
  });
}

// ═══════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════

module.exports = {
  // Helpers
  buildFiltersClause,
  buildPreviousPeriod,
  computeDelta,
  makeKpi,

  // Constantes
  ACTIVE_ORDER_STATUSES,
  TRANSIT_PARCEL_STATUSES,
  EXPECTED_VARIABLE_COSTS,
  EXPECTED_FIXED_COSTS,
  EXPECTED_PAYMENT_COSTS,

  // Tour de controle (8)
  getCAEncaisse,
  getCmdsCreees,
  getCmdsActives,
  getColisEnTransit,
  getAlertesCritiques,
  getCmdsBloquees,
  getTauxCompletudeScans,
  getTauxCompletudeCouts,

  // Costing (8)
  getCAVendu,
  getCoutEstime,
  getCoutReel,
  getMargeEstimee,
  getMargeVariableReelle,
  getMargeConsolidee,
  getCmdsCoutIncompletCount,
  getCmdsCoutIncompletIds,
  getCoutMoyParCmd,

  // Logistics (8)
  getCmdsAujourdhui,
  getPaiementsEnAttente,
  getColisPreparation,
  getColisTransit,
  getDisponiblesRelais,
  getRetardsCritiques,
  getTauxCollecteRelais,
  // getTauxCompletudeScans deja exporte

  // Workspaces (8)
  getWorkspacesActifs,
  getSessionsOuvertes,
  getTauxCompletion,
  getMontantTotalEvenements,
  getSessionsSansCommande,
  getCmdsCreeesWorkspace,
  getPanierMoyEvenement,
  getParticipantsMoy,
};
