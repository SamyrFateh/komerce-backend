/**
 * @komerce-arch
 * @role          canonical-unit-purchasing-cutover-comparison
 * @domain        purchasing
 * @layer         service
 * @criticality   high
 * @inputs        legacy_sku_resolution, canonical_unit_resolution
 * @outputs       cutover_parity_status
 * @depends       none
 * @used-by       purchasing cutover reports
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_CANONICAL_UNIT_PURCHASING.md
 * @impact-areas  purchasing, sourcing
 * @version       2026-09
 */
'use strict';

const STATUS = Object.freeze({
  PARITY: 'PARITY', CANONICAL_MORE_PRECISE: 'CANONICAL_MORE_PRECISE',
  LEGACY_ONLY: 'LEGACY_ONLY', CANONICAL_ONLY: 'CANONICAL_ONLY',
  MISMATCH: 'MISMATCH', AMBIGUOUS: 'AMBIGUOUS', BLOCKED: 'BLOCKED',
});

function stable(value) {
  if (value == null) return 'null';
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function compareLegacyCanonicalUnit(legacy, canonical) {
  const legacyReady = Boolean(legacy?.supplier_unit_ref && legacy?.supplier_order_identity);
  if (canonical?.status === 'AMBIGUOUS_UNIT') return { status: STATUS.AMBIGUOUS, blocks_cutover: true };
  const canonicalReady = canonical?.status === 'RESOLVED';
  if (!legacyReady && !canonicalReady) return { status: STATUS.BLOCKED, blocks_cutover: true };
  if (legacyReady && !canonicalReady) return { status: STATUS.LEGACY_ONLY, blocks_cutover: false };
  if (!legacyReady && canonicalReady) return { status: STATUS.CANONICAL_ONLY, blocks_cutover: false };
  const sameRef = String(legacy.supplier_unit_ref) === String(canonical.supplier_unit_ref);
  const sameIdentity = stable(legacy.supplier_order_identity) === stable(canonical.supplier_order_identity);
  if (sameRef && sameIdentity) return { status: STATUS.PARITY, blocks_cutover: false };
  if (sameIdentity && canonical.canonical_unit_id) return { status: STATUS.CANONICAL_MORE_PRECISE, blocks_cutover: false };
  return { status: STATUS.MISMATCH, blocks_cutover: true, same_ref: sameRef, same_identity: sameIdentity };
}

module.exports = { STATUS, compareLegacyCanonicalUnit };
