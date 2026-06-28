/**
 * @komerce-arch
 * @role          dashboard-metrics-helpers
 * @domain        dashboard
 * @layer         service
 * @criticality   high
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       @none
 * @used-by       control-tower.js, costing.js, logistics.js, workspaces.js (services/dashboard-metrics/*)
 * @db-read       (none)
 * @db-write      (none)
 * @db-txn        @none
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  dashboard, admin-dashboard
 * @version       2026-06
 */

/**
 * KOMERCE — Dashboard Metrics — Helpers & constantes (Lot C3)
 * ════════════════════════════════════════════════════════════════════════
 *
 * Extrait de services/dashboard-metrics.js (1081L) — Lot B/C Refacto.
 * Contient les briques communes utilisées par tous les groupes de KPIs :
 * filtres SQL, période antérieure, delta, format KPI standard.
 *
 * INVARIANTS GARANTIS (doctrine globale, voir index.js) :
 *   INV-1 : ca_encaisse == ca_vendu (memes filtres)
 *   INV-2 : cmds_actives identique sur Tour de controle et Logistique
 *   INV-3 : colis_transit identique
 *   INV-4 : taux_completude_couts coherent avec cmds_cout_incomplet
 *   INV-5 : cmds_creees_workspace ⊂ cmds_creees
 *   INV-6 : marge hierarchy : items_actual ≤ items_partial ≤ items_estimated
 */

'use strict';

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

function buildFiltersClause(filters = {}, orderAlias = 'o') {
  // AUD-07: orderAlias is an internal constant ('o', 'ord', etc.), never from user input.
  // All filter values are bound via $N params — no SQL injection risk.
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
    where.push(`${orderAlias}.status::text = $${i++}`);
    params.push(filters.status);
  }
  if (filters.payment_status) {
    where.push(`${orderAlias}.payment_status::text = $${i++}`);
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

module.exports = {
  buildFiltersClause,
  buildPreviousPeriod,
  computeDelta,
  makeKpi,
  ACTIVE_ORDER_STATUSES,
  VALID_PAID_STATUSES,
  TRANSIT_PARCEL_STATUSES,
  EXCLUDED_FROM_REVENUE,
  EXPECTED_VARIABLE_COSTS,
  EXPECTED_FIXED_COSTS,
  EXPECTED_PAYMENT_COSTS,
};
