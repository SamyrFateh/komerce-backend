'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const {
  compareProjectedField,
  buildCatalogComparison,
} = require('../../services/sourcing-product-read-comparison');

describe('parallel Product read comparison', () => {
  test('consensus identique = PARITY et différent = MISMATCH', () => {
    const field = { status: 'CONSENSUS', value: 'Komerce Proof', candidates: [] };
    expect(compareProjectedField(field, 'Komerce Proof').status).toBe('PARITY');
    expect(compareProjectedField(field, 'Autre marque').status).toBe('MISMATCH');
  });

  test('conflit préservé accepte une valeur historique issue d une Source', () => {
    const field = {
      status: 'CONFLICT_PRESERVED',
      value: null,
      candidates: [
        { value: 'Nom A', source_ids: ['manual:a'] },
        { value: 'Nom B', source_ids: ['manual:b'] },
      ],
    };
    expect(compareProjectedField(field, 'Nom A').status).toBe('SOURCE_VARIANT_ACCEPTED');
    expect(compareProjectedField(field, 'Nom C').status).toBe('MISMATCH_OUTSIDE_CONFLICT_SET');
  });

  test('absence canonique ne fabrique pas un mismatch', () => {
    expect(compareProjectedField({ status: 'ABSENT', value: null, candidates: [] }, 'legacy').status)
      .toBe('NO_CANONICAL_VALUE');
  });

  test('brouillon historique compatible avec consensus + conflit source', () => {
    const projected = {
      fields: {
        product_name: {
          status: 'CONFLICT_PRESERVED', value: null,
          candidates: [{ value: 'Nom A' }, { value: 'Nom B' }],
        },
        description: { status: 'CONSENSUS', value: 'Description source', candidates: [] },
        source_locale: { status: 'CONSENSUS', value: 'en', candidates: [] },
        weight_kg: { status: 'CONSENSUS', value: 1.25, candidates: [] },
      },
    };
    const historical = {
      product_id: 'p1',
      name: 'Nom enrichi',
      name_source: 'Nom B',
      description_source: 'Description source',
      source_locale: 'en',
      weight_kg: '1.250',
      lifecycle_status: 'candidate',
      is_active: false,
    };

    const result = buildCatalogComparison(projected, historical);
    expect(result.status).toBe('COMPATIBLE');
    expect(result.mismatches).toEqual([]);
    expect(result.fields.product_name.status).toBe('SOURCE_VARIANT_ACCEPTED');
    expect(result.fields.description.status).toBe('PARITY');
    expect(result.fields.weight_kg.status).toBe('PARITY');
    expect(result.is_active).toBe(false);
  });

  test('valeur catalogue extérieure au consensus produit un mismatch explicite', () => {
    const projected = {
      fields: {
        product_name: { status: 'CONSENSUS', value: 'Nom canonique', candidates: [] },
        description: { status: 'ABSENT', value: null, candidates: [] },
        source_locale: { status: 'ABSENT', value: null, candidates: [] },
        weight_kg: { status: 'ABSENT', value: null, candidates: [] },
      },
    };
    const result = buildCatalogComparison(projected, {
      product_id: 'p2', name: 'Nom historique différent', name_source: null,
      description_source: null, source_locale: null, weight_kg: null,
      lifecycle_status: 'candidate', is_active: false,
    });
    expect(result.status).toBe('MISMATCH');
    expect(result.mismatches).toEqual(['product_name']);
  });
});
