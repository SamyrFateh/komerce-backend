'use strict';

/**
 * @komerce-arch
 * @role          sourcing-certification-gate-a
 * @domain        sourcing
 * @layer         service
 * @criticality   high
 * @inputs        deterministic sourcing torture scenario observations
 * @outputs       SOURCING_CERTIFIED gate verdict
 * @depends       none
 * @used-by       tests/unit/sourcing-certification-gate-a.test.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_SOURCING_CATALOG_PIPELINE_CERTIFICATION.md
 * @impact-areas  sourcing, catalog, ci
 * @version       2026-09-v1
 */

const GATE_A_VERSION = 'sourcing-certified-gate-a-v1';

const REQUIRED_SCENARIOS = Object.freeze([
  'duplicate_same_page',
  'duplicate_across_pages',
  'pages_reordered',
  'repeated_cursor',
  'empty_intermediate_page',
  'partial_response',
  'timeout',
  'http_429',
  'http_5xx',
  'invalid_auth',
  'field_type_drift',
  'supplier_sku_attribute_change',
  'disappears_full_snapshot',
  'disappears_partial_snapshot',
  'archived_product_returns',
  'crash_after_checkpoint',
  'concurrent_imports',
  'unknown_extra_source_fields',
]);

function evaluateScenario(row = {}) {
  const reasons = [];
  if (!REQUIRED_SCENARIOS.includes(row.id)) reasons.push('unknown_scenario');
  if (row.network_used === true) reasons.push('network_used');
  if (row.paid_ai_used === true) reasons.push('paid_ai_used');
  if (row.state_corrupted === true) reasons.push('state_corrupted');
  if (row.duplicate_identity === true) reasons.push('duplicate_identity');
  if (row.silent_loss === true) reasons.push('silent_loss');
  if (row.expected_outcome == null || row.actual_outcome == null) reasons.push('outcome_missing');
  if (row.expected_outcome !== row.actual_outcome) reasons.push('outcome_mismatch');
  if (row.provenance_preserved !== true) reasons.push('provenance_not_preserved');
  return { id: row.id || null, pass: reasons.length === 0, reasons };
}

function certifyGateA(scenarios = []) {
  const byId = new Map();
  for (const row of scenarios) {
    if (row?.id && !byId.has(row.id)) byId.set(row.id, row);
  }
  const missing = REQUIRED_SCENARIOS.filter(id => !byId.has(id));
  const evaluated = [...byId.values()].map(evaluateScenario);
  const failed = evaluated.filter(x => !x.pass);
  return {
    certification_version: GATE_A_VERSION,
    gate: 'SOURCING_CERTIFIED',
    pass: missing.length === 0 && failed.length === 0,
    required: REQUIRED_SCENARIOS.length,
    observed: evaluated.length,
    missing,
    failed,
    scenarios: evaluated,
  };
}

module.exports = { GATE_A_VERSION, REQUIRED_SCENARIOS, evaluateScenario, certifyGateA };
