'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const {
  SOURCING_CERTIFICATION_VERSION,
  evaluateSourcingCandidateOutcome,
  certifySourcingBatch,
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

describe('sourcing canonical certification', () => {
  test('certifies an imported candidate only with traceable V2 identity and product link', () => {
    expect(evaluateSourcingCandidateOutcome(imported())).toEqual({
      certification_version: SOURCING_CERTIFICATION_VERSION,
      terminal: true,
      certified: true,
      outcome: 'imported_to_catalog',
      reasons: [],
    });
  });

  test.each([
    [{ state: 'watchlist' }, 'non_terminal_state'],
    [{ product_id: null }, 'catalog_product_link_missing'],
    [{ normalized_source_contract: { schema_version: '1' } }, 'source_contract_v2_missing'],
    [{ raw_payload: null }, 'raw_payload_missing'],
    [{ supplier_product_id: null }, 'supplier_product_id_missing'],
  ])('fails closed on invalid or unfinished sourcing outcome %#', (mutation, reason) => {
    const result = evaluateSourcingCandidateOutcome(imported(mutation));
    expect(result.certified).toBe(false);
    expect(result.reasons).toContain(reason);
  });

  test('quarantine is a valid explicit outcome only when its reason is preserved', () => {
    const good = evaluateSourcingCandidateOutcome(imported({
      state: 'quarantined',
      product_id: null,
      normalized_source_contract: null,
      promotion_status: 'QUARANTINED_LOSSY_MAPPING',
    }));
    expect(good).toMatchObject({ certified: true, terminal: true, outcome: 'quarantined' });

    const bad = evaluateSourcingCandidateOutcome(imported({
      state: 'quarantined',
      product_id: null,
      normalized_source_contract: null,
      promotion_status: null,
      promotion_reasons: [],
      findings: [],
    }));
    expect(bad.certified).toBe(false);
    expect(bad.reasons).toContain('quarantine_reason_missing');
  });

  test('batch certification reconciles imported, quarantine, rejection and duplicate outcomes', () => {
    const out = certifySourcingBatch({
      inputTotal: 5,
      candidates: [
        imported({ supplier_product_id: '1', product_id: 'p1' }),
        imported({
          supplier_product_id: '2',
          state: 'quarantined',
          product_id: null,
          normalized_source_contract: null,
          promotion_status: 'QUARANTINED_UNSUPPORTED_MEDIA',
        }),
        imported({
          supplier_product_id: '3',
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
      input_total: 5,
      certified: 1,
      quarantined: 1,
      rejected: 1,
      duplicates: 1,
      archived: 1,
      unaccounted: 0,
      overflow: 0,
      balanced: true,
    });
  });

  test('unfinished sourcing work remains UNACCOUNTED instead of disappearing', () => {
    const out = certifySourcingBatch({
      inputTotal: 2,
      candidates: [
        imported({ supplier_product_id: '1', product_id: 'p1' }),
        imported({ supplier_product_id: '2', state: 'watchlist', product_id: null }),
      ],
    });
    expect(out.accounting).toMatchObject({
      terminal_total: 1,
      unaccounted: 1,
      balanced: false,
    });
  });
});
