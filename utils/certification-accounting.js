/**
 * @komerce-arch
 * @role          certification-batch-accounting
 * @domain        infrastructure
 * @layer         utility
 * @criticality   high
 * @inputs        certification outcome counts
 * @outputs       balanced batch accounting with UNACCOUNTED/OVERFLOW
 * @depends       none
 * @used-by       services/catalog-certification.js, services/sourcing-certification.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      every_input_has_one_explicit_outcome
 * @impact-areas  catalog, sourcing, ci
 * @version       2026-09-v1
 */
'use strict';

const OUTCOME_KEYS = Object.freeze([
  'certified',
  'quarantined',
  'rejected',
  'duplicates',
  'archived',
  'other_terminal',
]);

function nonNegativeInteger(value, label) {
  const n = Number(value ?? 0);
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`CERTIFICATION_ACCOUNTING_INVALID_${String(label || 'COUNT').toUpperCase()}`);
  }
  return n;
}

function reconcileCertificationBatch(input = {}) {
  const inputTotal = nonNegativeInteger(input.input_total, 'input_total');
  const counts = Object.fromEntries(
    OUTCOME_KEYS.map(key => [key, nonNegativeInteger(input[key], key)])
  );
  const terminalTotal = OUTCOME_KEYS.reduce((sum, key) => sum + counts[key], 0);
  const unaccounted = Math.max(0, inputTotal - terminalTotal);
  const overflow = Math.max(0, terminalTotal - inputTotal);

  return {
    input_total: inputTotal,
    ...counts,
    terminal_total: terminalTotal,
    unaccounted,
    overflow,
    balanced: unaccounted === 0 && overflow === 0,
  };
}

module.exports = {
  OUTCOME_KEYS,
  reconcileCertificationBatch,
};
