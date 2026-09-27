/**
 * @komerce-arch
 * @role          sourcing-certification
 * @domain        sourcing
 * @layer         service
 * @criticality   high
 * @inputs        sourcing candidate outcomes and import rejection rows
 * @outputs       versioned provider-independent sourcing certification
 * @depends       utils/certification-accounting.js
 * @used-by       services/suppliers/catalog-import-orchestrator.js, services/suppliers/catalog-import-json.js, tests/unit/sourcing-certification.test.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_CERTIFICATION_CATALOGUE_SOURCING.md
 * @impact-areas  sourcing, catalog, ci
 * @version       2026-09-v1
 */
'use strict';

const { reconcileCertificationBatch } = require('../utils/certification-accounting');

const SOURCING_CERTIFICATION_VERSION = 'sourcing-certification-v1';
const READY_DECISIONS = Object.freeze(['TEST', 'PRIORITY']);
const DEFERRED_DECISIONS = Object.freeze(['WATCH', 'AVOID', 'LOSS']);
const LIFECYCLE_TERMINAL_STATES = Object.freeze([
  'imported_to_catalog',
  'quarantined',
  'rejected',
  'archived',
  'watchlist',
]);

function nonEmpty(value) {
  return String(value || '').trim().length > 0;
}

function hasTrace(value) {
  if (value == null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}

function sourceContractV2(row = {}) {
  return String(row?.normalized_source_contract?.schema_version || '') === '2';
}

function sourcingDecision(row = {}) {
  return String(
    row.sourcing_decision
      ?? row?.scan_result?.sourcing_decision
      ?? ''
  ).trim().toUpperCase();
}

function decisionOutcome(decision) {
  const value = String(decision || '').trim().toUpperCase();
  if (READY_DECISIONS.includes(value)) return 'ready_for_refinery';
  if (DEFERRED_DECISIONS.includes(value)) return 'deferred';
  if (value === 'EXCLUDED') return 'rejected';
  return 'unknown';
}

function evaluateSourcingCandidateOutcome(row = {}) {
  const state = String(row.state || '').trim();
  const decision = sourcingDecision(row);
  const reasons = [];
  let outcome = 'non_terminal';

  if (state === 'imported_to_catalog') outcome = 'catalog_imported';
  else if (state === 'quarantined') outcome = 'quarantined';
  else if (state === 'rejected') outcome = 'rejected';
  else if (state === 'archived') outcome = 'archived';
  else if (state === 'watchlist') outcome = 'deferred';
  else if (state === 'scanned' || state === 'test_ready' || state === 'normalized') {
    outcome = decisionOutcome(decision);
  }

  const terminal = outcome !== 'non_terminal' && outcome !== 'unknown';

  if (!terminal) reasons.push('non_terminal_outcome');
  if (!nonEmpty(row.supplier_name)) reasons.push('supplier_name_missing');
  if (!nonEmpty(row.supplier_product_id)) reasons.push('supplier_product_id_missing');
  if (!hasTrace(row.raw_payload)) reasons.push('raw_payload_missing');

  if (outcome === 'catalog_imported') {
    if (!nonEmpty(row.product_id)) reasons.push('catalog_product_link_missing');
    if (!sourceContractV2(row)) reasons.push('source_contract_v2_missing');
  }

  if (outcome === 'ready_for_refinery' && !sourceContractV2(row)) {
    reasons.push('source_contract_v2_missing');
  }

  if (outcome === 'quarantined') {
    const explicitQuarantine = String(row.promotion_status || '').startsWith('QUARANTINED_')
      || hasTrace(row.promotion_reasons)
      || hasTrace(row.findings);
    if (!explicitQuarantine) reasons.push('quarantine_reason_missing');
  }

  if (outcome === 'rejected') {
    const explicitReject = nonEmpty(row.rejected_reason)
      || hasTrace(row.promotion_reasons)
      || hasTrace(row.findings)
      || decision === 'EXCLUDED';
    if (!explicitReject) reasons.push('rejection_reason_missing');
  }

  const outcomeValid = reasons.length === 0;
  const sourcingCertified = outcomeValid
    && (outcome === 'ready_for_refinery' || outcome === 'catalog_imported');

  return {
    certification_version: SOURCING_CERTIFICATION_VERSION,
    terminal,
    outcome_valid: outcomeValid,
    sourcing_certified: sourcingCertified,
    outcome,
    decision: decision || null,
    reasons,
  };
}

function rejectionOutcome(row = {}) {
  return String(row.reason_code || '') === 'DUPLICATE_SUPPLIER_PRODUCT_ID_IN_BATCH'
    ? 'duplicates'
    : 'rejected';
}

function reconcileSourcingCounts({
  inputTotal,
  readyForRefinery = 0,
  quarantined = 0,
  rejected = 0,
  duplicates = 0,
  deferred = 0,
  archived = 0,
  otherTerminal = 0,
} = {}) {
  return reconcileCertificationBatch({
    input_total: inputTotal,
    certified: readyForRefinery,
    quarantined,
    rejected,
    duplicates,
    archived,
    other_terminal: deferred + otherTerminal,
  });
}

function certifySourcingBatch({
  inputTotal,
  candidates = [],
  rejectionRows = [],
} = {}) {
  const evaluated = candidates.map(row => ({
    ...row,
    certification: evaluateSourcingCandidateOutcome(row),
  }));

  const counts = {
    readyForRefinery: 0,
    quarantined: 0,
    rejected: 0,
    duplicates: 0,
    deferred: 0,
    archived: 0,
  };

  for (const row of evaluated) {
    const verdict = row.certification;
    if (!verdict.outcome_valid) continue;
    switch (verdict.outcome) {
      case 'ready_for_refinery':
      case 'catalog_imported':
        counts.readyForRefinery += 1;
        break;
      case 'quarantined':
        counts.quarantined += 1;
        break;
      case 'rejected':
        counts.rejected += 1;
        break;
      case 'deferred':
        counts.deferred += 1;
        break;
      case 'archived':
        counts.archived += 1;
        break;
      default:
        break;
    }
  }

  for (const row of rejectionRows) {
    counts[rejectionOutcome(row)] += 1;
  }

  const accounting = reconcileSourcingCounts({
    inputTotal,
    ...counts,
  });

  return {
    certification_version: SOURCING_CERTIFICATION_VERSION,
    candidates: evaluated,
    rejection_rows: rejectionRows,
    accounting,
  };
}

module.exports = {
  SOURCING_CERTIFICATION_VERSION,
  READY_DECISIONS,
  DEFERRED_DECISIONS,
  LIFECYCLE_TERMINAL_STATES,
  sourcingDecision,
  decisionOutcome,
  evaluateSourcingCandidateOutcome,
  rejectionOutcome,
  reconcileSourcingCounts,
  certifySourcingBatch,
};
