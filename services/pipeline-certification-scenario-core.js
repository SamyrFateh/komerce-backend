/**
 * @komerce-arch
 * @role          pipeline-certification-scenario-core
 * @domain        catalog
 * @layer         service
 * @criticality   high
 * @inputs        deterministic certification scenario observations
 * @outputs       fail-closed scenario verdicts
 * @depends       none
 * @used-by       services/catalog-certification-gate-b.js, services/pipeline-certification-gate-c.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_SOURCING_CATALOG_PIPELINE_CERTIFICATION.md
 * @impact-areas  catalog, sourcing, ci
 * @version       2026-09-v1
 */
'use strict';

function evaluateDeterministicScenario(row = {}, requiredScenarios = []) {
  const reasons = [];
  if (!requiredScenarios.includes(row.id)) reasons.push('unknown_scenario');
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

function certifyScenarioGate({ gate, version, requiredScenarios, scenarios = [] }) {
  const byId = new Map();
  for (const row of scenarios) if (row?.id && !byId.has(row.id)) byId.set(row.id, row);
  const missing = requiredScenarios.filter(id => !byId.has(id));
  const evaluated = [...byId.values()].map(row => evaluateDeterministicScenario(row, requiredScenarios));
  const failed = evaluated.filter(row => !row.pass);
  return { certification_version: version, gate, pass: missing.length === 0 && failed.length === 0,
    required: requiredScenarios.length, observed: evaluated.length, missing, failed, scenarios: evaluated };
}

module.exports = { evaluateDeterministicScenario, certifyScenarioGate };
