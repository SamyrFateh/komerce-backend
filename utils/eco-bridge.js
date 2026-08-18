/**
 * @komerce-arch
 * @role          eco-bridge
 * @domain        economic-engine
 * @layer         util
 * @criticality   medium
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db, services/economic-config.js, utils/logger.js
 * @db-write      none
 * @db-read      charges, finance_config
 * @used-by       routes/economic.js, services/economic-engine-queries.js
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  unknown
 * @version       2026-06
 */

/**
 * KOMERCE — Economic Bridge v1.1
 * ═══════════════════════════════
 * Bridge de compatibilité pour les anciennes clés économiques runtime.
 *
 * LOT 1A-4 : lit depuis `finance_config`; `economic_variables` est forensic read-only.
 * Remplace :
 *   - getRuleNumber() pour les paramètres pricing
 *   - getFinanceVal() dans le dashboard (qui était cassé — singleton vs key-value)
 *
 * Utilisé par :
 *   - utils/pricing.js  (calcul CDR 16 étapes)
 *   - routes/dashboard.js (pilotage, hub cost, customs)
 *   - routes/economic-engine.js (redistribute, coherence)
 *
 * Cache mémoire 60s — invalidé après chaque write-through canonique
 */

'use strict';

const db = require('../db');
const economicConfig = require('../services/economic-config');
const log = require('../utils/logger').child({ module: 'eco-bridge' });

// ── Cache ────────────────────────────────────────────────────────────
const CACHE_TTL_MS = 60_000;
let _varsCache = null;
let _varsCacheAt = 0;

/**
 * Load all active economic variables into a key→value map.
 * Priority: value_used > value_supposed > null
 */
async function loadEcoVars() {
  if (_varsCache && Date.now() - _varsCacheAt < CACHE_TTL_MS) {
    return _varsCache;
  }
  try {
    const config = await economicConfig.loadFinanceConfig();
    const map = {};
    for (const key of Object.keys(economicConfig.LEGACY_RUNTIME_INPUTS)) {
      map[key] = economicConfig.resolveLegacyInput(config, key);
    }
    _varsCache = map;
    _varsCacheAt = Date.now();
    return map;
  } catch (err) {
    log.error({ err }, '[ECO-BRIDGE] loadEcoVars error:');
    return _varsCache || {};
  }
}

/**
 * Get a single economic variable by key, with fallback.
 * @param {string} key - The variable key (e.g. 'eur_kmf', 'commission_agent_pct')
 * @param {number} fallback - Default value if not found
 * @returns {Promise<number>}
 */
async function getEcoVar(key, fallback) {
  const vars = await loadEcoVars();
  const val = vars[key];
  return val != null ? val : fallback;
}

/**
 * Get multiple economic variables at once (batch read).
 * @param {Array<{key: string, fallback: number}>} specs
 * @returns {Promise<Object>} key→value map
 */
async function getEcoVars(specs) {
  const vars = await loadEcoVars();
  const result = {};
  for (const { key, fallback } of specs) {
    const val = vars[key];
    result[key] = val != null ? val : fallback;
  }
  return result;
}

/**
 * Invalidate the cache — call after any variable update.
 */
function invalidateEcoCache() {
  _varsCache = null;
  _varsCacheAt = 0;
}

// ── Charges helper ───────────────────────────────────────────────────

let _chargesCache = null;
let _chargesCacheAt = 0;

/**
 * Load active charges with computed cost-per-order.
 * Monthly charges are divided by orders_per_month.
 */
async function loadChargesSummary() {
  if (_chargesCache && Date.now() - _chargesCacheAt < CACHE_TTL_MS) {
    return _chargesCache;
  }
  try {
    const { rows } = await db.query('SELECT * FROM charges WHERE is_active = TRUE');
    const ordersPerMonth = await getEcoVar('orders_per_month', 100);

    let perOrderTotal = 0;
    let monthlyTotal = 0;
    let weeklyTotal = 0;

    for (const c of rows) {
      const amt = Number(c.amount_kmf);
      if (c.recurrence_period === 'per_order') perOrderTotal += amt;
      else if (c.recurrence_period === 'monthly') monthlyTotal += amt;
      else if (c.recurrence_period === 'weekly') weeklyTotal += amt;
    }

    const totalMonthlyFixed = monthlyTotal + Math.round(weeklyTotal * 4.33);
    const monthlyPerOrder = ordersPerMonth > 0
      ? Math.round(totalMonthlyFixed / ordersPerMonth)
      : 0;

    const result = {
      charges: rows,
      per_order_total: perOrderTotal,
      monthly_total: totalMonthlyFixed,
      monthly_per_order: monthlyPerOrder,
      total_cost_per_order: perOrderTotal + monthlyPerOrder,
      orders_per_month: ordersPerMonth,
    };

    _chargesCache = result;
    _chargesCacheAt = Date.now();
    return result;
  } catch (err) {
    log.error({ err }, '[ECO-BRIDGE] loadChargesSummary error:');
    return _chargesCache || {
      charges: [], per_order_total: 0, monthly_total: 0,
      monthly_per_order: 0, total_cost_per_order: 0, orders_per_month: 100,
    };
  }
}

function invalidateChargesCache() {
  _chargesCache = null;
  _chargesCacheAt = 0;
}

module.exports = {
  getEcoVar,
  getEcoVars,
  loadEcoVars,
  loadChargesSummary,
  invalidateEcoCache,
  invalidateChargesCache,
};
