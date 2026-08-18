/**
 * @komerce-arch
 * @role          economic-config-canonical-bridge
 * @domain        economic-engine
 * @layer         service
 * @criticality   high
 * @inputs        finance_config, legacy_variable_key, computed_projection
 * @outputs       canonical_model_inputs, readonly_legacy_projection, canonical_write_through
 * @depends       db.js
 * @used-by       services/economic-engine-queries.js, services/dashboard-ops-queries.js, utils/eco-bridge.js
 * @db-read       finance_config
 * @db-write      finance_config
 * @db-txn        none
 * @doctrine      finance_config_single_runtime_truth, economic_variables_read_only
 * @impact-areas  economic-engine, dashboard, admin-economic, finance-config
 * @version       2026-08
 */

'use strict';

const db = require('../db');

/**
 * LOT 1A-4 — seules les clés qui pilotent réellement redistribute/Ops sont
 * write-through depuis l'ancienne API. Les autres variables legacy restent
 * visibles pour forensic mais ne sont plus une surface d'écriture runtime.
 */
const LEGACY_RUNTIME_INPUTS = Object.freeze({
  orders_per_month:         { canonical: 'objectif_commandes_mois',  fallback: 100,   min: 0 },
  target_basket_avg:        { canonical: 'target_panier_moyen_kmf',  fallback: 15000, min: 0 },
  hub_monthly_cost_aed:     { canonical: 'hub_monthly_cost_aed',     fallback: 7000,  min: 0 },
  customs_rate_default_pct: { canonical: 'customs_rate_default_pct', fallback: 42,    min: 0, max: 100 },
  mix_rail_a:               { canonical: 'mix_rail_a',               fallback: 60,    min: 0, max: 100 },
  mix_rail_b:               { canonical: 'mix_rail_b',               fallback: 25,    min: 0, max: 100 },
  mix_rail_c:               { canonical: 'mix_rail_c',               fallback: 10,    min: 0, max: 100 },
  mix_rail_d:               { canonical: 'mix_rail_d',               fallback: 5,     min: 0, max: 100 },
  margin_rail_a:            { canonical: 'margin_rail_a',            fallback: 45,    min: 0, max: 100 },
  margin_rail_b:            { canonical: 'margin_rail_b',            fallback: 18,    min: 0, max: 100 },
  margin_rail_c:            { canonical: 'margin_rail_c',            fallback: 35,    min: 0, max: 100 },
  margin_rail_d:            { canonical: 'margin_rail_d',            fallback: 70,    min: 0, max: 100 },
});

const COMPUTED_PROJECTION = Object.freeze({
  total_cost_per_order:     'totalCostPerOrder',
  margin_weighted_avg:      'weightedMargin',
  seuil_rentabilite:        'breakEven',
  safety_ratio:             'safetyRatio',
  margin_pressure:          'marginPressure',
  net_profit_per_order:     'netProfit',
  monthly_breakeven_orders: 'monthlyBreakevenOrders',
});

function numeric(value, fallback) {
  if (value === null || value === undefined || value === '') return Number(fallback);
  const n = Number(value);
  return Number.isFinite(n) ? n : Number(fallback);
}

function optionalNumber(value) {
  if (value === null || value === undefined || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

async function loadFinanceConfig() {
  const { rows } = await db.query('SELECT * FROM finance_config WHERE id = 1');
  if (!rows[0]) {
    const err = new Error('finance_config singleton id=1 absent');
    err.code = 'FINANCE_CONFIG_MISSING';
    throw err;
  }
  return rows[0];
}

function resolveLegacyInput(config, legacyKey) {
  const spec = LEGACY_RUNTIME_INPUTS[legacyKey];
  if (!spec) return undefined;
  return numeric(config?.[spec.canonical], spec.fallback);
}

function buildModelInputs(config) {
  return {
    ordersPerMonth: resolveLegacyInput(config, 'orders_per_month'),
    targetBasket:   resolveLegacyInput(config, 'target_basket_avg'),
    mixA:           resolveLegacyInput(config, 'mix_rail_a'),
    mixB:           resolveLegacyInput(config, 'mix_rail_b'),
    mixC:           resolveLegacyInput(config, 'mix_rail_c'),
    mixD:           resolveLegacyInput(config, 'mix_rail_d'),
    margA:          resolveLegacyInput(config, 'margin_rail_a'),
    margB:          resolveLegacyInput(config, 'margin_rail_b'),
    margC:          resolveLegacyInput(config, 'margin_rail_c'),
    margD:          resolveLegacyInput(config, 'margin_rail_d'),
  };
}

function computedValueFor(row, computed) {
  const field = COMPUTED_PROJECTION[row.key];
  if (!field || computed?.[field] == null) return undefined;
  return numeric(computed[field], 0);
}

function projectLegacyRows(rows, config, computed) {
  return (rows || []).map((row) => {
    const canonicalValue = resolveLegacyInput(config, row.key);
    if (canonicalValue !== undefined) {
      return {
        ...row,
        value_used: canonicalValue,
        source_used: 'finance_config',
        runtime_source: `finance_config.${LEGACY_RUNTIME_INPUTS[row.key].canonical}`,
        legacy_read_only: true,
      };
    }

    const projected = computedValueFor(row, computed);
    if (projected !== undefined) {
      return {
        ...row,
        value_used: projected,
        source_used: 'computed_projection',
        runtime_source: 'economic_engine_projection',
        legacy_read_only: true,
      };
    }

    return {
      ...row,
      runtime_source: 'economic_variables_forensic',
      legacy_read_only: true,
    };
  });
}

function effectiveLegacyWriteValue(body) {
  if (!body || typeof body !== 'object') return undefined;
  if (body.value_used !== undefined) return optionalNumber(body.value_used);
  if (body.source_used === 'supposed' && body.value_supposed !== undefined) return optionalNumber(body.value_supposed);
  if (body.source_used === 'observed' && body.value_observed !== undefined) return optionalNumber(body.value_observed);
  return undefined;
}

async function writeThroughLegacyInput(key, body, updatedBy) {
  const spec = LEGACY_RUNTIME_INPUTS[key];
  if (!spec) {
    return {
      error: 'economic_variable_editor_retired',
      status: 410,
      key,
      source_of_truth: 'finance_config',
      message: 'economic_variables est legacy read-only depuis LOT 1A-4.',
    };
  }

  const value = effectiveLegacyWriteValue(body);
  if (!Number.isFinite(value)) {
    return { error: 'effective_value_required', status: 400, key };
  }
  if (spec.min !== undefined && value < spec.min) {
    return { error: 'value_below_min', status: 400, key, min: spec.min };
  }
  if (spec.max !== undefined && value > spec.max) {
    return { error: 'value_above_max', status: 400, key, max: spec.max };
  }

  const params = [value];
  let auditSql = '';
  if (updatedBy) {
    params.push(updatedBy);
    auditSql = ', updated_by = $2';
  }

  const { rows } = await db.query(
    `UPDATE finance_config
        SET ${spec.canonical} = $1, updated_at = NOW()${auditSql}
      WHERE id = 1
      RETURNING *`,
    params
  );

  if (!rows[0]) {
    return { error: 'finance_config_missing', status: 500, key };
  }

  return {
    key,
    canonical_field: spec.canonical,
    value,
    finance_config: rows[0],
  };
}

module.exports = {
  LEGACY_RUNTIME_INPUTS,
  COMPUTED_PROJECTION,
  numeric,
  optionalNumber,
  loadFinanceConfig,
  resolveLegacyInput,
  buildModelInputs,
  projectLegacyRows,
  effectiveLegacyWriteValue,
  writeThroughLegacyInput,
};
