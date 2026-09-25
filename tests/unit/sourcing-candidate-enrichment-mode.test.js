'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

jest.mock('../../db', () => ({ query: jest.fn(), getClient: jest.fn() }));
jest.mock('../../services/supplier-catalog-scanner', () => ({}));
jest.mock('../../services/pricing-engine', () => ({}));
jest.mock('../../services/catalog-candidate-product-service', () => ({ createDraftProductFromSourcingCandidate: jest.fn() }));
jest.mock('../../services/catalog-promotion', () => ({ promoteCatalog: jest.fn() }));

const {
  SourcingCandidateActionError,
  _resolveEnrichmentMode,
} = require('../../services/sourcing-candidate-actions');

describe('sourcing candidate — enrichment_mode', () => {
  test('source_only est la valeur canonique par défaut — aucune API IA implicite', () => {
    expect(_resolveEnrichmentMode({})).toBe('source_only');
  });

  test('source_only est accepté explicitement', () => {
    expect(_resolveEnrichmentMode({ enrichment_mode: 'source_only' })).toBe('source_only');
    expect(_resolveEnrichmentMode({ enrichment_mode: ' SOURCE_ONLY ' })).toBe('source_only');
  });

  test('auto et tout autre mode sont refusés', () => {
    expect(() => _resolveEnrichmentMode({ enrichment_mode: 'auto' }))
      .toThrow(SourcingCandidateActionError);
    expect(() => _resolveEnrichmentMode({ enrichment_mode: 'magic' }))
      .toThrow(SourcingCandidateActionError);
  });
});