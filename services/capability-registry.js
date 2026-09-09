/**
 * @komerce-arch
 * @role          market-delegation-capability-registry
 * @domain        market
 * @layer         service
 * @criticality   high
 * @inputs        capability_registry
 * @outputs       capability_reference, autonomy_rate, ceiling_validation
 * @depends       config/market-delegation-capabilities.js
 * @used-by       market-delegation-service, CI
 * @db-read       capability_registry
 * @db-write      none
 * @db-txn        caller-owned
 * @doctrine      market_delegation_capability_ceiling
 * @impact-areas  market, authorization, delegation
 * @version       2026-09
 */
'use strict';

const { CAPABILITIES, autonomyStats } = require('../config/market-delegation-capabilities');

function requireExecutor(executor) {
  if (!executor || typeof executor.query !== 'function') {
    throw new TypeError('capability-registry: executor.query requis');
  }
  return executor;
}

function byName(name) {
  return CAPABILITIES.find(item => item.capability === name) || null;
}

function validateRegistry(rows = CAPABILITIES) {
  const names = new Set();
  const errors = [];
  for (const row of rows) {
    if (!row || !row.capability) { errors.push('capability_missing'); continue; }
    if (names.has(row.capability)) errors.push(`duplicate:${row.capability}`);
    names.add(row.capability);
    if (row.authority_scope === 'GROUP' && row.delegation_mode !== 'CENTRAL_ONLY') {
      errors.push(`group_must_be_central_only:${row.capability}`);
    }
    if (row.class === 'BOUNDARY' && row.authority_scope !== 'GROUP') {
      errors.push(`boundary_must_be_group:${row.capability}`);
    }
  }
  const stats = autonomyStats(rows);
  return { ok: errors.length === 0, errors, stats };
}

async function listCapabilities(executor, { className = null } = {}) {
  const db = requireExecutor(executor);
  const params = [];
  let where = '';
  if (className) {
    params.push(className);
    where = ' WHERE class = $1';
  }
  const { rows } = await db.query(
    `SELECT capability, class, domain, authority_scope, delegation_mode, requires_audit, status
       FROM capability_registry${where}
      ORDER BY class, domain, capability`, params
  );
  return rows;
}

async function autonomyRate(executor) {
  const { rows } = await requireExecutor(executor).query(
    `SELECT COUNT(*) FILTER (WHERE status = 'LIVE')::int AS live,
            COUNT(*)::int AS total
       FROM capability_registry
      WHERE class = 'DELEGATION'`
  );
  const live = Number(rows[0]?.live || 0);
  const total = Number(rows[0]?.total || 0);
  return { live, total, rate: total ? live / total : 0 };
}

async function validateCeilingCapabilities(executor, capabilities) {
  const requested = [...new Set((capabilities || []).map(String))];
  if (!requested.length) return { ok: true, invalid: [] };
  const { rows } = await requireExecutor(executor).query(
    `SELECT capability
       FROM capability_registry
      WHERE capability = ANY($1::text[])
        AND authority_scope = 'MARKET'
        AND delegation_mode = 'DELEGABLE'`,
    [requested]
  );
  const allowed = new Set(rows.map(row => row.capability));
  const invalid = requested.filter(name => !allowed.has(name));
  return { ok: invalid.length === 0, invalid };
}

module.exports = {
  CAPABILITIES,
  byName,
  validateRegistry,
  listCapabilities,
  autonomyRate,
  validateCeilingCapabilities,
};
