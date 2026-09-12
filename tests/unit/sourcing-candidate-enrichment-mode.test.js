'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

jest.mock('../../db', () => ({ query: jest.fn(), getClient: jest.fn() }));
jest.mock('../../services/supplier-catalog-scanner', () => ({}));
jest.mock('../../services/pricing-engine', () => ({}));
jest.mock('../../services/catalog-enrichment', () => ({ enrichAndApply: jest.fn() }));
jest.mock('../../services/catalog-candidate-product-service', () => ({ createDraftProductFromSourcingCandidate: jest.fn() }));
jest.mock('../../services/catalog-promotion', () => ({ promoteCatalog: jest.fn() }));

const {
  SourcingCandidateActionError,
  _resolveEnrichmentMode,
} = require('../../services/sourcing-candidate-actions');

describe('sourcing candidate — enrichment_mode', () => {
  test('auto reste la valeur canonique par défaut', () => {
    expect(_resolveEnrichmentMode({})).toBe('auto');
  });

  test('source_only est accepté explicitement', () => {
    expect(_resolveEnrichmentMode({ enrichment_mode: 'source_only' })).toBe('source_only');
    expect(_resolveEnrichmentMode({ enrichment_mode: ' SOURCE_ONLY ' })).toBe('source_only');
  });

  test('un mode inconnu est refusé', () => {
    expect(() => _resolveEnrichmentMode({ enrichment_mode: 'magic' }))
      .toThrow(SourcingCandidateActionError);
  });
});