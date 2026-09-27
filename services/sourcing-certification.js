/**
 * @komerce-arch
 * @role          sourcing-certification
 * @domain        sourcing
 * @layer         service
 * @criticality   high
 * @inputs        sourcing candidate outcomes and import rejection rows
 * @outputs       versioned provider-independent sourcing certification
 * @depends       utils/certification-accounting.js
 * @used-by       tests/unit/sourcing-certification.test.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      every_sourcing_input_has_an_explicit_traceable_outcome
 * @impact-areas  sourcing, catalog, ci
 * @version       2026-09-v1
 */
'use strict';

const { reconcileCertificationBatch } = require('../utils/certification-accounting');

const SOURCING_CERTIFICATION_VERSION = 'sourcing-certification-v1';
const TERMINAL_STATES = Object.freeze([
  'imported_to_catalog',
  'quarantined',
  'rejected',
  'archived',
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

function evaluateSourcingCandidateOutcome(row = {}) {
  const state = String(row.state || '').trim();
  const reasons = [];

  if (!TERMINAL_STATES.includes(state)) reasons.push('non_terminal_state');
  if (!nonEmpty(row.supplier_name)) reasons.push('supplier_name_missing');
  if (!nonEmpty(row.supplier_product_id)) reasons.push('supplier_product_id_missing');
  if (!hasTrace(row.raw_payload)) reasons.push('raw_payload_missing');

  if (state === 'imported_to_catalog') {
    if (!nonEmpty(row.product_id)) reasons.push('catalog_product_link_missing');
    if (!sourceContractV2(row)) reasons.push('source_contract_v2_missing');
  }

  if (state === 'quarantined') {
    const explicitQuarantine = String(row.promotion_status || '').startsWith('QUARANTINED_')
      || hasTrace(row.promotion_reasons)
      || hasTrace(row.findings);
    if (!explicitQuarantine) reasons.push('quarantine_reason_missing');
  }

  if (state === 'rejected') {
    const explicitReject = nonEmpty(row.rejected_reason)
      || hasTrace(row.promotion_reasons)
      || hasTrace(row.findings);
    if (!explicitReject) reasons.push('rejection_reason_missing');
  }

  return {
    certification_version: SOURCING_CERTIFICATION_VERSION,
    terminal: TERMINAL_STATES.includes(state),
    certified: reasons.length === 0,
    outcome: state || 'unknown',
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
  certified = 0,
  quarantined = 0,
  rejected = 0,
  duplicates = 0,
  archived = 0,
  otherTerminal = 0,
} = {}) {
  return reconcileCertificationBatch({
    input_total: inputTotal,
    certified,
    quarantined,
    rejected,
    duplicates,
    archived,
    other_terminal: otherTerminal,
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
    certified: 0,
    quarantined: 0,
    rejected: 0,
    duplicates: 0,
    archived: 0,
  };

  for (const row of evaluated) {
    if (!row.certification.certified) continue;
    switch (row.certification.outcome) {
      case 'imported_to_catalog':
        counts.certified += 1;
        break;
      case 'quarantined':
        counts.quarantined += 1;
        break;
      case 'rejected':
        counts.rejected += 1;
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
  TERMINAL_STATES,
  evaluateSourcingCandidateOutcome,
  rejectionOutcome,
  reconcileSourcingCounts,
  certifySourcingBatch,
};
