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
  priceAuthorityOf,
  classifyCandidate,
  EXPECTED_PRICE_AUTHORITY,
} = require('../../scripts/aliexpress-promote-drafts-staging');

describe('AliExpress draft promotion price authority regression', () => {
  it('lit le champ canonique recommended_price_authority', () => {
    const candidate = {
      state: 'scanned',
      product_id: null,
      normalized_source_contract: { schema_version: '2' },
      scan_result: {
        sourcing_decision: 'TEST',
        test_price_kmf: 3500,
        recommended_price_authority: EXPECTED_PRICE_AUTHORITY,
      },
    };

    expect(priceAuthorityOf(candidate)).toBe(EXPECTED_PRICE_AUTHORITY);
    expect(classifyCandidate(candidate)).toMatchObject({
      status: 'promotable',
      price_kmf: 3500,
      price_authority: EXPECTED_PRICE_AUTHORITY,
    });
  });
});