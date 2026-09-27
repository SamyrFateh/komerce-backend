'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

jest.mock('../../db', () => ({
  query: jest.fn(),
  pool: { end: jest.fn() },
}));
jest.mock('../../services/pricing-engine', () => ({ loadGlobalConfig: jest.fn() }));
jest.mock('../../services/supplier-catalog-scanner', () => ({
  normalizeCandidate: jest.fn(),
  scanCandidate: jest.fn(),
}));
jest.mock('../../services/catalog-eligibility', () => ({
  loadActiveExclusions: jest.fn(),
  checkEligibility: jest.fn(),
}));
jest.mock('../../services/sourcing-candidate-actions', () => ({ promoteCandidate: jest.fn() }));
jest.mock('../../scripts/catalog-fr-free-e2e-preparation', () => ({ run: jest.fn() }));
jest.mock('../../services/product-publication-guard', () => ({
  validatePublicationUpdate: jest.fn(() => ({ ok: true })),
}));

const campaign = require('../../scripts/aliexpress-incremental-e2e-200');

describe('AliExpress incremental E2E 200', () => {
  test('has a strict isolated identity and target', () => {
    expect(campaign.SUPPLIER).toBe('AliExpress');
    expect(campaign.WAVE_ID).toBe('incremental-e2e-200-v1');
    expect(campaign.TARGET).toBe(200);
  });

  test('requires explicit staging/test authorization', () => {
    const base = {
      KOMERCE_ENV: 'staging',
      NODE_ENV: 'test',
      DATABASE_URL: 'postgres://test',
      KOMERCE_ALLOW_ALIEXPRESS_INCREMENTAL_E2E_200: '1',
    };
    expect(() => campaign.assertRuntime(base)).not.toThrow();
    expect(() => campaign.assertRuntime({ ...base, KOMERCE_ENV: 'production' })).toThrow(/staging\/test/);
    expect(() => campaign.assertRuntime({ ...base, KOMERCE_ALLOW_ALIEXPRESS_INCREMENTAL_E2E_200: '0' })).toThrow(/requis/);
  });

  test('parses only bounded campaign operations', () => {
    expect(campaign.parseArgs(['--operation=accept', '--output=artifacts/ali-200.json']))
      .toMatchObject({ operation: 'accept' });
    expect(() => campaign.parseArgs(['--operation=publish'])).toThrow(/invalide/);
  });

  test('reads persisted sourcing decisions and test price authority without inventing values', () => {
    const row = {
      scan_result: {
        sourcing_decision: 'test',
        test_price_kmf: 12345.4,
        recommended_price_authority: 'ECONOMIC_REFERENCE_NOT_MARKET_DECISION',
      },
    };
    expect(campaign.decisionOf(row)).toBe('TEST');
    expect(campaign.testPriceOf(row)).toBe(12345);
    expect(campaign.priceAuthorityOf(row)).toBe('ECONOMIC_REFERENCE_NOT_MARKET_DECISION');
  });
});
