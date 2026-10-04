/**
 * @komerce-arch
 * @role          supplier-execution-certification
 * @domain        purchasing
 * @layer         service
 * @criticality   high
 * @inputs        deterministic supplier execution certification observations
 * @outputs       SUPPLIER_EXECUTION_CERTIFIED verdict
 * @depends       none
 * @used-by       tests/unit/supplier-execution-certification.test.js, scripts/check-supplier-execution-certification-manifest.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_SUPPLIER_EXECUTION_PERSISTENCE.md
 * @impact-areas  purchasing, supplier-integration, ci
 * @version       2026-10-v1
 */
'use strict';

const CERTIFICATION_VERSION = 'supplier-execution-certified-v1';

const REQUIRED_SCENARIOS = Object.freeze([
  'single_create_persisted',
  'single_duplicate_replay',
  'provider_timeout_after_create',
  'crash_after_provider_response',
  'crash_after_execution_persist',
  'same_order_resume',
  'cross_po_rebind_refused',
  'exact_purchase_line_membership',
  'grouped_two_children_parent',
  'grouped_parent_member_mismatch',
  'grouped_parent_materialized_resume',
  'provider_native_field_isolation',
  'alternate_provider_semantic_mapping',
  'unknown_provider_fact_fail_closed',
]);

const EXPLICITLY_UNPROVEN = Object.freeze([
  'supplier_payment_production',
  'supplier_payment_reconciliation',
  'expected_vs_debited_amount_reconciliation',
  'payment_replay_without_double_debit',
  'b2b_accounting_reconciliation',
]);

function evaluateScenario(row = {}) {
  const reasons = [];
  if (!REQUIRED_SCENARIOS.includes(row.id)) reasons.push('unknown_scenario');
  if (row.network_used === true) reasons.push('network_used');
  if (row.real_charge_possible === true) reasons.push('real_charge_possible');
  if (row.expected_outcome == null || row.actual_outcome == null) reasons.push('outcome_missing');
  if (row.expected_outcome !== row.actual_outcome) reasons.push('outcome_mismatch');
  if (row.provider_secret_exposed === true) reasons.push('provider_secret_exposed');
  if (row.duplicate_supplier_order === true) reasons.push('duplicate_supplier_order');
  if (row.cross_po_rebind === true) reasons.push('cross_po_rebind');
  if (row.canonical_contract_preserved !== true) reasons.push('canonical_contract_not_preserved');
  if (row.replay_safe !== true) reasons.push('replay_not_safe');
  return { id: row.id || null, pass: reasons.length === 0, reasons };
}

function certifySupplierExecution(scenarios = []) {
  const byId = new Map();
  for (const row of scenarios) {
    if (row?.id && !byId.has(row.id)) byId.set(row.id, row);
  }
  const missing = REQUIRED_SCENARIOS.filter(id => !byId.has(id));
  const evaluated = [...byId.values()].map(evaluateScenario);
  const failed = evaluated.filter(x => !x.pass);
  return {
    certification_version: CERTIFICATION_VERSION,
    gate: 'SUPPLIER_EXECUTION_CERTIFIED',
    pass: missing.length === 0 && failed.length === 0,
    required: REQUIRED_SCENARIOS.length,
    observed: evaluated.length,
    missing,
    failed,
    scenarios: evaluated,
    explicitly_unproven: [...EXPLICITLY_UNPROVEN],
  };
}

module.exports = {
  CERTIFICATION_VERSION,
  REQUIRED_SCENARIOS,
  EXPLICITLY_UNPROVEN,
  evaluateScenario,
  certifySupplierExecution,
};
