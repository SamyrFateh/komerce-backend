'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

jest.mock('../../db', () => ({ query: jest.fn(), getClient: jest.fn(), pool: { end: jest.fn() } }));
jest.mock('../../services/sourcing-candidate-actions', () => ({ promoteCandidate: jest.fn() }));

const { promoteCandidate } = require('../../services/sourcing-candidate-actions');
const {
  executeBatch,
  ENRICHMENT_MODE,
  EXPECTED_PRICE_AUTHORITY,
} = require('../../scripts/aliexpress-promote-drafts-staging');

function promotableCandidate() {
  return {
    id: 'c-source-only',
    supplier_product_id: '1005000000000000',
    state: 'scanned',
    product_id: null,
    normalized_source_contract: { schema_version: '2', stock_available: 7 },
    scan_result: {
      sourcing_decision: 'TEST',
      test_price_kmf: 12990,
      price_authority: EXPECTED_PRICE_AUTHORITY,
    },
  };
}

describe('AliExpress promotion — source-only editorial mode', () => {
  beforeEach(() => {
    promoteCandidate.mockReset();
    promoteCandidate.mockResolvedValue({
      product_id: 'p-source-only',
      enrichment: { status: 'source_only', mode: 'source_only' },
    });
  });

  test('le batch demande explicitement source_only et ne dépend donc pas d’un enrichisseur IA', async () => {
    expect(ENRICHMENT_MODE).toBe('source_only');

    const promoted = await executeBatch({ candidates: [promotableCandidate()] }, 100);

    expect(promoteCandidate).toHaveBeenCalledTimes(1);
    expect(promoteCandidate).toHaveBeenCalledWith(
      'c-source-only',
      { price_kmf: 12990, enrichment_mode: 'source_only' },
      null
    );
    expect(promoted).toEqual([
      expect.objectContaining({
        candidate_id: 'c-source-only',
        product_id: 'p-source-only',
        enrichment_status: 'source_only',
      }),
    ]);
  });
});