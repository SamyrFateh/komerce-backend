'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const {
  parsePrice,
  parseStock,
  normalizeCategoryProposed,
  resolveWeight,
  resolveCurrency,
} = require('../../services/suppliers/source-product-normalizer');
const { FINDINGS } = require('../../services/suppliers/pipeline-constants');

describe('source-product-normalizer', () => {
  test('parse explicitement prix et stock string sans conversion silencieuse', () => {
    expect(parsePrice('12,50 USD')).toMatchObject({ value: 12.5, currency: 'USD', transformed: true });
    expect(parsePrice('12 dollars')).toMatchObject({ value: null, unparsed: true });
    expect(parseStock(' 42 ')).toMatchObject({ value: 42, transformed: true });
    expect(parseStock('4.2')).toMatchObject({ value: null, unparsed: true });
  });

  test('normalise la catégorie comme proposition source uniquement', () => {
    expect(normalizeCategoryProposed('  Beauty  ')).toEqual({ proposed: 'beauty', changed: true });
    expect(normalizeCategoryProposed(null)).toEqual({ proposed: null, changed: false });
  });

  test('n’invente jamais une unité de poids absente du profil', () => {
    const profile = {
      weight: { source_field: 'weight', source_unit: null, target_unit: 'kg' },
    };
    const result = resolveWeight({ weight: 3.5 }, profile);

    expect(result.value).toBeNull();
    expect(result.provenance.basis).toBe('source_unit_unconfirmed');
    expect(result.findings.some(f => f.code === FINDINGS.SOURCE_WEIGHT_UNIT_UNKNOWN)).toBe(true);
  });

  test('convertit le poids seulement avec unité explicitement confirmée', () => {
    const profile = {
      weight: { source_field: 'weight', source_unit: 'g', target_unit: 'kg' },
    };
    const result = resolveWeight({ weight: 750 }, profile);

    expect(result.value).toBeCloseTo(0.75);
    expect(result.provenance.basis).toBe('source_unit_confirmed');
  });

  test('résout la devise source avant le défaut de profil et quarantine une devise interdite', () => {
    const profile = { currency: { allowed: ['USD', 'EUR'], default: 'EUR' } };
    expect(resolveCurrency('USD', profile)).toEqual({ value: 'USD', origin: 'source', quarantined: false });
    expect(resolveCurrency(null, profile)).toEqual({ value: 'EUR', origin: 'import_profile', quarantined: false });
    expect(resolveCurrency('GBP', profile)).toEqual({ value: null, origin: 'source_rejected_by_policy', quarantined: true });
  });
});
