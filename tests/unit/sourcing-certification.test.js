'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const {
  SOURCING_CERTIFICATION_VERSION,
  evaluateSourcingCandidateOutcome,
  certifySourcingBatch,
  decisionOutcome,
} = require('../../services/sourcing-certification');

function imported(overrides = {}) {
  return {
    state: 'imported_to_catalog',
    supplier_name: 'CJdropshipping',
    supplier_product_id: 'CJ-1',
    raw_payload: { source: 'cj' },
    normalized_source_contract: { schema_version: '2' },
    product_id: 'product-1',
    ...overrides,
  };
}

function scanned(overrides = {}) {
  return {
    state: 'scanned',
    supplier_name: 'CJdropshipping',
    supplier_product_id: 'CJ-SCAN-1',
    raw_payload: { source: 'cj' },
    normalized_source_contract: { schema_version: '2' },
    scan_result: { sourcing_decision: 'TEST' },
    ...overrides,
  };
}

describe('sourcing canonical certification', () => {
  test('certifies an imported candidate only with traceable V2 identity and product link', () => {
    expect(evaluateSourcingCandidateOutcome(imported())).toEqual({
      certification_version: SOURCING_CERTIFICATION_VERSION,
      terminal: true,
      outcome_valid: true,
      sourcing_certified: true,
      outcome: 'catalog_imported',
      decision: null,
      reasons: [],
    });
  });

  test('TEST/PRIORITY is the provider-independent ready-for-refinery outcome', () => {
    expect(decisionOutcome('test')).toBe('ready_for_refinery');
    expect(decisionOutcome('PRIORITY')).toBe('ready_for_refinery');

    const verdict = evaluateSourcingCandidateOutcome(scanned());
    expect(verdict).toMatchObject({
      terminal: true,
      outcome_valid: true,
      sourcing_certified: true,
      outcome: 'ready_for_refinery',
      decision: 'TEST',
    });
  });

  test('WATCH is explicit and accounted but not sourcing-certified', () => {
    const verdict = evaluateSourcingCandidateOutcome(scanned({
      scan_result: { sourcing_decision: 'WATCH' },
    }));
    expect(verdict).toMatchObject({
      terminal: true,
      outcome_valid: true,
      sourcing_certified: false,
      outcome: 'deferred',
      decision: 'WATCH',
    });
  });

  test.each([
    [{ state: 'normalized', scan_result: null }, 'non_terminal_outcome'],
    [{ product_id: null }, 'catalog_product_link_missing'],
    [{ normalized_source_contract: { schema_version: '1' } }, 'source_contract_v2_missing'],
    [{ raw_payload: null }, 'raw_payload_missing'],
    [{ supplier_product_id: null }, 'supplier_product_id_missing'],
  ])('fails closed on invalid or unfinished sourcing outcome %#', (mutation, reason) => {
    const result = evaluateSourcingCandidateOutcome(imported(mutation));
    expect(result.outcome_valid).toBe(false);
    expect(result.reasons).toContain(reason);
  });

  test('quarantine is an accountable explicit outcome only when its reason is preserved', () => {
    const good = evaluateSourcingCandidateOutcome(imported({
      state: 'quarantined',
      product_id: null,
      normalized_source_contract: null,
      promotion_status: 'QUARANTINED_LOSSY_MAPPING',
    }));
    expect(good).toMatchObject({
      outcome_valid: true,
      sourcing_certified: false,
      terminal: true,
      outcome: 'quarantined',
    });

    const bad = evaluateSourcingCandidateOutcome(imported({
      state: 'quarantined',
      product_id: null,
      normalized_source_contract: null,
      promotion_status: null,
      promotion_reasons: [],
      findings: [],
    }));
    expect(bad.outcome_valid).toBe(false);
    expect(bad.reasons).toContain('quarantine_reason_missing');
  });

  test('batch certification reconciles ready, deferred, quarantine, rejection and duplicate outcomes', () => {
    const out = certifySourcingBatch({
      inputTotal: 6,
      candidates: [
        scanned({ supplier_product_id: '1' }),
        scanned({ supplier_product_id: '2', scan_result: { sourcing_decision: 'WATCH' } }),
        imported({
          supplier_product_id: '3',
          state: 'quarantined',
          product_id: null,
          normalized_source_contract: null,
          promotion_status: 'QUARANTINED_UNSUPPORTED_MEDIA',
        }),
        imported({
          supplier_product_id: '4',
          state: 'archived',
          product_id: null,
          normalized_source_contract: null,
        }),
      ],
      rejectionRows: [
        { reason_code: 'CONTRACT_SCHEMA_INVALID' },
        { reason_code: 'DUPLICATE_SUPPLIER_PRODUCT_ID_IN_BATCH' },
      ],
    });

    expect(out.accounting).toMatchObject({
      input_total: 6,
      certified: 1,
      quarantined: 1,
      rejected: 1,
      duplicates: 1,
      archived: 1,
      other_terminal: 1,
      unaccounted: 0,
      overflow: 0,
      balanced: true,
    });
  });

  test('unfinished sourcing work remains UNACCOUNTED instead of disappearing', () => {
    const out = certifySourcingBatch({
      inputTotal: 2,
      candidates: [
        scanned({ supplier_product_id: '1' }),
        scanned({ supplier_product_id: '2', scan_result: null }),
      ],
    });
    expect(out.accounting).toMatchObject({
      terminal_total: 1,
      unaccounted: 1,
      balanced: false,
    });
  });
});
