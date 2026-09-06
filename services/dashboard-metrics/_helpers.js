/**
 * @komerce-arch
 * @role          dashboard-metrics-helpers
 * @domain        dashboard
 * @layer         service
 * @criticality   high
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       services/cost-allocation/cost-types.js
 * @used-by       control-tower.js, costing.js, logistics.js, workspaces.js (services/dashboard-metrics/*)
 * @db-read       cash_collections, orders, parcels
 * @db-write      (none)
 * @db-txn        @none
 * @doctrine      pricing_market_viability_cost_scope
 * @impact-areas  dashboard, admin-dashboard, pricing
 * @version       2026-09
 */

/**
 * KOMERCE — Dashboard Metrics — Helpers & constantes (Lot C3 / LOT 2C MarketScope)
 * ════════════════════════════════════════════════════════════════════════
 *
 * Les filtres de requête historiques restent inchangés. `market_id` est une
 * extension INTERNE : il n'est jamais lu depuis req.query par les routes
 * dashboard. Il est injecté uniquement après résolution + autorisation
 * serveur du marché ciblé.
 *
 * IMPORTANT : les natures de coûts ne sont pas redéfinies ici. Le dashboard
 * consomme la classification canonique du moteur économique : `hub` est N1
 * variable et `risk_provision` est N2 variable ; seul `fixed_overhead` reste
 * une structure legacy au niveau des allocations commande.
 *
 * Le dashboard conserve temporairement `payment` dans un bucket séparé pour
 * compatibilité de ses requêtes historiques. Cela ne change pas sa nature :
 * `payment` reste N2 variable dans la source canonique cost-types.js.
 */

'use strict';

const {
  VARIABLE_COST_TYPES,
  ORDER_ALLOCATION_STRUCTURE_COST_TYPES,
} = require('../cost-allocation/cost-types');

const ACTIVE_ORDER_STATUSES = Object.freeze([
  'confirmed', 'ordered', 'preparation', 'shipped', 'in_transit', 'available',
]);

const VALID_PAID_STATUSES = Object.freeze(['paid']);

const TRANSIT_PARCEL_STATUSES = Object.freeze([
  'shipped', 'in_transit', 'arrived',
]);

const EXCLUDED_FROM_REVENUE = Object.freeze(['cancelled', 'refunded']);

// Compatibilité dashboard : payment reste séparé dans les requêtes legacy,
// mais la source économique canonique le classe bien dans N2 variable.
const EXPECTED_VARIABLE_COSTS = Object.freeze(
  VARIABLE_COST_TYPES.filter((type) => type !== 'payment')
);
const EXPECTED_FIXED_COSTS = ORDER_ALLOCATION_STRUCTURE_COST_TYPES;
const EXPECTED_PAYMENT_COSTS = Object.freeze(['payment']);
const EXPECTED_ALL_COSTS = Object.freeze([
  ...EXPECTED_VARIABLE_COSTS,
  ...EXPECTED_FIXED_COSTS,
  ...EXPECTED_PAYMENT_COSTS,
]);

// ═══════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════

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
    where.push(`${orderAlias}.status::text = $${i++}`);
    params.push(filters.status);
  }
  if (filters.payment_status) {
    where.push(`${orderAlias}.payment_status::text = $${i++}`);
    params.push(filters.payment_status);
  }

  if (filters.market_id) {
    where.push(`${orderAlias}.market_id = $${i++}`);
    params.push(filters.market_id);
  }

  return { where: where.join(' AND '), params, nextParamIndex: i };
}

function buildSignalMarketClause(filters = {}, signalAlias = 's', startParamIndex = 1) {
  if (!filters.market_id) {
    return { where: '1=1', params: [], nextParamIndex: startParamIndex };
  }

  const marketParam = `$${startParamIndex}`;
  const where = `(
    (${signalAlias}.entity_type = 'order' AND EXISTS (
      SELECT 1 FROM orders scope_o
      WHERE scope_o.id::text = ${signalAlias}.entity_id::text
        AND scope_o.market_id = ${marketParam}
    ))
    OR (${signalAlias}.entity_type = 'parcel' AND EXISTS (
      SELECT 1
      FROM parcels scope_p
      JOIN orders scope_o ON scope_o.id = scope_p.order_id
      WHERE scope_p.id::text = ${signalAlias}.entity_id::text
        AND scope_o.market_id = ${marketParam}
    ))
    OR (${signalAlias}.entity_type = 'cash_collection' AND EXISTS (
      SELECT 1
      FROM cash_collections scope_c
      JOIN orders scope_o ON scope_o.id = scope_c.order_id
      WHERE scope_c.id::text = ${signalAlias}.entity_id::text
        AND scope_o.market_id = ${marketParam}
    ))
  )`;

  return {
    where,
    params: [filters.market_id],
    nextParamIndex: startParamIndex + 1,
  };
}

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
  buildSignalMarketClause,
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
  EXPECTED_ALL_COSTS,
};
