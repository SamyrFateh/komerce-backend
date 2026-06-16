/**
 * @komerce-arch
 * @role          dashboard-dashboard-shared
 * @domain        dashboard
 * @layer         route
 * @criticality   high
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db.js, middleware/auth.js, services/*
 * @used-by       bootstrap/api-routes.js
 * @db-read       @unknown
 * @db-write      @unknown
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  dashboard, admin-dashboard
 * @version       2026-06
 */

'use strict';
/**
 * dashboard-shared.js — Cache mémoire + helpers communs
 * Importé par dashboard-ops, dashboard-finance, dashboard-clients, dashboard-hub
 */

const { getRates }   = require('../utils/rates');
const { getRule }    = require('../utils/rules');

// ── Cache mémoire (TTL configurable via business_rules) ─────────────────────
let _cacheTtlMs = 30_000; // default 30s — rafraîchi depuis DB
const _cache = new Map();

function cached(key) {
  const entry = _cache.get(key);
  if (entry && Date.now() - entry.ts < _cacheTtlMs) return entry.data;
  return null;
}
function setCache(key, data) {
  _cache.set(key, { data, ts: Date.now() });
  if (_cache.size > 100) _cache.delete(_cache.keys().next().value);
}

// ── Helper : taux EUR/KMF dynamique (jamais hardcodé) ───────────────────────
async function getEurKmf() {
  const rates = await getRates();
  return { eur_kmf: rates.eur_kmf, aed_kmf: rates.aed_kmf };
}

// ── Config SLA & Compensations (chargée depuis business_rules) ──────────────
// Fallback = valeurs actuelles hardcodées → zéro régression si DB vide
async function loadDashConfig() {
  const [
    slaWarn, slaLate, slaBlocked, inactive,
    compPrev, compCredit, compDiscount, compRefund, cacheSec,
    fraudReverseCritDays, fraudPendingCritH, fraudPendingWarnH,
    fraudStaleDays, fraudReverseSqlDays,
  ] = await Promise.all([
    getRule('SLA_WARNING_DAYS',           35),
    getRule('SLA_LATE_DAYS',              42),
    getRule('SLA_BLOCKED_DAYS',           56),
    getRule('SLA_INACTIVE_DAYS',           7),
    getRule('COMP_PREVENTIVE_DAYS',       28),
    getRule('COMP_CREDIT_DAYS',           35),
    getRule('COMP_DISCOUNT_DAYS',         42),
    getRule('COMP_REFUND_DAYS',           56),
    getRule('DASHBOARD_CACHE_TTL_SEC',    30),
    getRule('FRAUD_REVERSE_CRITICAL_DAYS', 7),
    getRule('FRAUD_PENDING_CRITICAL_HOURS', 36),
    getRule('FRAUD_PENDING_WARNING_HOURS',  12),
    getRule('FRAUD_STALE_PARCEL_DAYS',    14),
    getRule('FRAUD_REVERSE_SQL_DAYS',      3),
  ]);
  _cacheTtlMs = cacheSec * 1000;
  return {
    SLA_WARNING_DAYS:       slaWarn,
    SLA_LATE_DAYS:          slaLate,
    SLA_BLOCKED_DAYS:       slaBlocked,
    INACTIVE_DAYS:          inactive,
    DELAY_PREVENTIF:        compPrev,
    DELAY_AVOIR:            compCredit,
    DELAY_REMISE:           compDiscount,
    DELAY_REMBOURSEMENT:    compRefund,
    FRAUD_REVERSE_CRIT_DAYS: fraudReverseCritDays,
    FRAUD_PENDING_CRIT_H:   fraudPendingCritH,
    FRAUD_PENDING_WARN_H:   fraudPendingWarnH,
    FRAUD_STALE_DAYS:       fraudStaleDays,
    FRAUD_REVERSE_SQL_DAYS: fraudReverseSqlDays,
  };
}

module.exports = { cached, setCache, getEurKmf, loadDashConfig };
