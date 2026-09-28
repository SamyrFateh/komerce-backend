'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

jest.mock('../../db', () => ({
  query: jest.fn(),
  getClient: jest.fn(),
  pool: { end: jest.fn() },
}));

jest.mock('../../services/sourcing-candidate-actions', () => ({
  promoteCandidate: jest.fn(),
}));

const {
  FLAG,
  EXPECTED_PRICE_AUTHORITY,
  normalizeRunRef,
  parseArgs,
  assertRuntime,
  classifyCandidate,
  summarizeCandidates,
  executeBatch,
} = require('../../scripts/aliexpress-promote-run-staging');

const { promoteCandidate } = require('../../services/sourcing-candidate-actions');

function candidate(overrides = {}) {
  return {
    id: 'c1',
    import_id: 'i1',
    supplier_name: 'AliExpress',
    supplier_product_id: '100000000001',
    product_name: 'Produit',
    state: 'scanned',
    product_id: null,
    raw_payload: { source: true },
    normalized_source_contract: { schema_version: '2' },
    scan_result: {
      sourcing_decision: 'TEST',
      test_price_kmf: 12990,
      price_authority: EXPECTED_PRICE_AUTHORITY,
    },
    ...overrides,
  };
}

describe('aliexpress-promote-run-staging contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    promoteCandidate.mockResolvedValue({ product_id: 'p1' });
  });

  test('requires one exact KIR run and bounded limit', () => {
    expect(normalizeRunRef('kir-000004')).toBe('KIR-000004');
    expect(() => normalizeRunRef('KIR-4')).toThrow(/KIR-000000/);
    expect(parseArgs(['--run-ref=KIR-000004', '--limit=15']))
      .toEqual({ mode: 'dry-run', limit: 15, runRef: 'KIR-000004' });
    expect(() => parseArgs(['--run-ref=KIR-000004', '--limit=101'])).toThrow(/1 et 100/);
  });

  test('execute is staging-only and explicit opt-in', () => {
    expect(() => assertRuntime({ mode: 'dry-run' }, {
      KOMERCE_ENV: 'staging',
      DATABASE_URL: 'postgres://example',
    })).not.toThrow();

    expect(() => assertRuntime({ mode: 'execute' }, {
      KOMERCE_ENV: 'staging',
      DATABASE_URL: 'postgres://example',
    })).toThrow(new RegExp(FLAG));

    expect(() => assertRuntime({ mode: 'execute' }, {
      KOMERCE_ENV: 'staging',
      DATABASE_URL: 'postgres://example',
      [FLAG]: '1',
    })).not.toThrow();
  });

  test('only SOURCING_CERTIFIED TEST/PRIORITY rows are promotable', () => {
    expect(classifyCandidate(candidate())).toMatchObject({
      status: 'promotable',
      price_kmf: 12990,
      decision: 'TEST',
    });

    expect(classifyCandidate(candidate({
      scan_result: {
        sourcing_decision: 'PRIORITY',
        test_price_kmf: 15000,
        price_authority: EXPECTED_PRICE_AUTHORITY,
      },
    }))).toMatchObject({ status: 'promotable', decision: 'PRIORITY' });

    expect(classifyCandidate(candidate({
      id: 'watch',
      scan_result: {
        sourcing_decision: 'WATCH',
        test_price_kmf: 9000,
        price_authority: EXPECTED_PRICE_AUTHORITY,
      },
    }))).toMatchObject({
      status: 'not_certified',
      decision: 'WATCH',
      reason: 'outcome:deferred',
    });

    expect(classifyCandidate(candidate({
      id: 'rejected',
      state: 'rejected',
      rejected_reason: 'douane',
      scan_result: { sourcing_decision: 'EXCLUDED' },
    }))).toMatchObject({
      status: 'not_certified',
      reason: 'outcome:rejected',
    });
  });

  test('certified row without explicit temporary price evidence is fail-closed', () => {
    expect(classifyCandidate(candidate({
      scan_result: {
        sourcing_decision: 'TEST',
        test_price_kmf: null,
        price_authority: EXPECTED_PRICE_AUTHORITY,
      },
    }))).toEqual({ status: 'blocked', reason: 'test_price_missing' });

    expect(classifyCandidate(candidate({
      scan_result: {
        sourcing_decision: 'TEST',
        test_price_kmf: 12990,
        price_authority: 'MARKET_DECISION',
      },
    }))).toEqual({ status: 'blocked', reason: 'price_authority:MARKET_DECISION' });
  });

  test('summary exposes certified, deferred/rejected and blocked outcomes without loss', () => {
    const rows = [
      candidate({ id: '1' }),
      candidate({
        id: '2',
        scan_result: {
          sourcing_decision: 'PRIORITY',
          test_price_kmf: 15000,
          price_authority: EXPECTED_PRICE_AUTHORITY,
        },
      }),
      candidate({
        id: '3',
        scan_result: {
          sourcing_decision: 'WATCH',
          test_price_kmf: 9000,
          price_authority: EXPECTED_PRICE_AUTHORITY,
        },
      }),
      candidate({
        id: '4',
        state: 'rejected',
        rejected_reason: 'douane',
        scan_result: { sourcing_decision: 'EXCLUDED' },
      }),
    ];

    expect(summarizeCandidates(rows)).toMatchObject({
      run_total: 4,
      certified_total: 2,
      promotable: 2,
      not_certified: 2,
      blocked: 0,
      by_decision: {
        TEST: 1,
        PRIORITY: 1,
        WATCH: 1,
        EXCLUDED: 1,
      },
    });
  });

  test('executeBatch calls only canonical promoteCandidate for promotable certified rows', async () => {
    const before = {
      candidates: [
        candidate({ id: 'certified' }),
        candidate({
          id: 'deferred',
          scan_result: {
            sourcing_decision: 'WATCH',
            test_price_kmf: 9000,
            price_authority: EXPECTED_PRICE_AUTHORITY,
          },
        }),
      ],
    };

    const promoted = await executeBatch(before, 15);

    expect(promoteCandidate).toHaveBeenCalledTimes(1);
    expect(promoteCandidate).toHaveBeenCalledWith('certified', {
      price_kmf: 12990,
      enrichment_mode: 'source_only',
    }, null);
    expect(promoted).toHaveLength(1);
  });
});
