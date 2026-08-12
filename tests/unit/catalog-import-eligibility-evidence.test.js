'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

jest.mock('../../db', () => ({ query: jest.fn(), getClient: jest.fn() }));
jest.mock('../../services/supplier-catalog-scanner', () => ({}));
jest.mock('../../services/pricing-engine', () => ({}));
jest.mock('../../utils/rules', () => ({ getRuleNumber: jest.fn() }));
jest.mock('../../services/suppliers/catalog-import-json', () => ({ importJsonCatalog: jest.fn() }));

const {
  eligibilityMatchLabel,
  eligibilityReason,
  automaticRejectedReason,
} = require('../../services/suppliers/catalog-import-orchestrator');

describe('catalog import eligibility evidence', () => {
  const verdict = {
    layer: 'absolute',
    label: 'Armes et imitations',
    legal_note: 'Douane Comores — prohibition',
    match: { type: 'keyword', value: 'gun' },
  };

  test('formate la preuve exacte du match', () => {
    expect(eligibilityMatchLabel(verdict)).toBe('keyword="gun"');
  });

  test('inclut la preuve et la base légale dans la raison de scan', () => {
    expect(eligibilityReason(verdict)).toBe(
      'Armes et imitations — keyword="gun" — Douane Comores — prohibition'
    );
  });

  test('rend le rejected_reason immédiatement auditable', () => {
    expect(automaticRejectedReason(verdict)).toBe(
      '[auto-exclusion] Armes et imitations [keyword="gun"]'
    );
  });

  test('reste compatible avec une ancienne règle sans preuve', () => {
    const legacy = { label: 'Exclusion historique', legal_note: null };
    expect(eligibilityMatchLabel(legacy)).toBeNull();
    expect(eligibilityReason(legacy)).toBe('Exclusion historique');
    expect(automaticRejectedReason(legacy)).toBe('[auto-exclusion] Exclusion historique');
  });
});
