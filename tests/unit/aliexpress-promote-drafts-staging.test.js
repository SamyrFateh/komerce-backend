'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

jest.mock('../../db', () => ({ query: jest.fn(), getClient: jest.fn(), pool: { end: jest.fn() } }));
jest.mock('../../services/sourcing-candidate-actions', () => ({ promoteCandidate: jest.fn() }));

const {
  EXPECTED_CLEAN,
  FLAG,
  parseArgs,
  assertRuntime,
  classifyCandidate,
  summarizeCandidates,
  EXPECTED_PRICE_AUTHORITY,
} = require('../../scripts/aliexpress-promote-drafts-staging');

function candidate(overrides = {}) {
  return {
    id: 'c1',
    supplier_product_id: '123456789',
    state: 'scanned',
    product_id: null,
    normalized_source_contract: { schema_version: '2', stock_available: 4 },
    scan_result: {
      sourcing_decision: 'TEST',
      test_price_kmf: 12990,
      price_authority: EXPECTED_PRICE_AUTHORITY,
    },
    ...overrides,
  };
}

describe('aliexpress-promote-drafts-staging contract', () => {
  test('500 clean candidates is the frozen staging pool invariant', () => {
    expect(EXPECTED_CLEAN).toBe(500);
  });

  test('defaults to dry-run and bounds batch size', () => {
    expect(parseArgs([])).toEqual({ mode: 'dry-run', limit: 100 });
    expect(parseArgs(['--execute', '--limit=50'])).toEqual({ mode: 'execute', limit: 50 });
    expect(() => parseArgs(['--limit=0'])).toThrow(/entre 1 et 500/i);
    expect(() => parseArgs(['--wat'])).toThrow(/Argument inconnu/);
  });

  test('execute is staging-only and opt-in', () => {
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

    expect(() => assertRuntime({ mode: 'dry-run' }, {
      KOMERCE_ENV: 'production',
      DATABASE_URL: 'postgres://example',
    })).toThrow(/staging requis/i);
  });

  test('only TEST/PRIORITY with V2 + canonical test price authority is promotable', () => {
    expect(classifyCandidate(candidate())).toMatchObject({
      status: 'promotable',
      price_kmf: 12990,
      decision: 'TEST',
    });
    expect(classifyCandidate(candidate({ scan_result: {
      sourcing_decision: 'PRIORITY',
      test_price_kmf: 15000,
      price_authority: EXPECTED_PRICE_AUTHORITY,
    } }))).toMatchObject({ status: 'promotable', decision: 'PRIORITY' });

    expect(classifyCandidate(candidate({ scan_result: {
      sourcing_decision: 'WATCH',
      test_price_kmf: 12990,
      price_authority: EXPECTED_PRICE_AUTHORITY,
    } }))).toEqual({ status: 'blocked', reason: 'decision:WATCH' });

    expect(classifyCandidate(candidate({ normalized_source_contract: { schema_version: '1' } })))
      .toEqual({ status: 'blocked', reason: 'contract_v1' });

    expect(classifyCandidate(candidate({ scan_result: {
      sourcing_decision: 'TEST',
      test_price_kmf: 12990,
      price_authority: 'MARKET_DECISION',
    } }))).toEqual({ status: 'blocked', reason: 'price_authority:MARKET_DECISION' });
  });

  test('already promoted candidate is idempotently skipped', () => {
    expect(classifyCandidate(candidate({ state: 'imported_to_catalog', product_id: 'p1' })))
      .toEqual({ status: 'already_promoted' });
  });

  test('summary exposes decision/refinery distribution rather than hiding blocked products', () => {
    const rows = [
      candidate({ id: '1' }),
      candidate({ id: '2', scan_result: { sourcing_decision: 'WATCH', test_price_kmf: 9000, price_authority: EXPECTED_PRICE_AUTHORITY } }),
      candidate({ id: '3', state: 'imported_to_catalog', product_id: 'p3' }),
    ];
    expect(summarizeCandidates(rows)).toMatchObject({
      clean_total: 3,
      already_promoted: 1,
      promotable: 1,
      blocked: 1,
      blocked_by_reason: { 'decision:WATCH': 1 },
      decisions: { TEST: 2, WATCH: 1 },
      test_price_kmf: { min: 12990, max: 12990 },
    });
  });
});
