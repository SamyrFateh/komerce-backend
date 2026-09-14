'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const {
  SOURCE_FIELD_MAPPING,
  PROTECTED_FIELDS,
  buildReadSeamTrial,
} = require('../../services/catalog-product-read-cutover-trial');

describe('catalog Product read cutover trial', () => {
  const legacy = {
    id: '933a13c1-7bd9-499c-8f55-33f21ec8d9dd',
    product_ref: 'PROOF-CATALOG-1',
    sku: 'PROOF-SKU-1',
    name: 'Nom éditorial public',
    name_source: 'Nom source legacy',
    description: 'Description éditoriale publique',
    description_source: 'Description source legacy',
    source_locale: 'fr',
    category: 'Maison',
    subcategory: 'Test',
    price_kmf: 1000,
    stock: 7,
    image_url: 'https://example.test/product.jpg',
    images: ['https://example.test/product.jpg'],
    weight_kg: 0.3,
    is_active: false,
    lifecycle_status: 'candidate',
    has_variants: false,
    inventory_model: 'LEGACY',
  };

  test('V1 ne mappe que des champs de cuisine source', () => {
    expect(SOURCE_FIELD_MAPPING).toEqual({
      product_name: 'name_source',
      description: 'description_source',
      source_locale: 'source_locale',
    });
    expect(PROTECTED_FIELDS).toEqual(expect.arrayContaining([
      'name', 'description', 'price_kmf', 'stock', 'image_url', 'is_active', 'weight_kg',
    ]));
  });

  test('applique un consensus canonique sans changer le contrat public', () => {
    const projected = {
      canonical_product_id: '171637d7-3403-470b-aaba-ccfa65e45dea',
      source_count: 2,
      projection_status: 'CONSENSUS',
      fields: {
        product_name: { status: 'CONSENSUS', value: 'Nom source canonique', candidates: [] },
        description: { status: 'CONSENSUS', value: 'Description canonique', candidates: [] },
        source_locale: { status: 'CONSENSUS', value: 'en', candidates: [] },
      },
    };

    const result = buildReadSeamTrial(legacy, projected);

    expect(result.status).toBe('SAFE');
    expect(result.summary.canonical_fields_applied).toBe(3);
    expect(result.summary.public_contract_equal).toBe(true);
    expect(result.protected_field_changes).toEqual([]);
    expect(result.decisions.name_source.status).toBe('CANONICAL_CONSENSUS_APPLIED');
    expect(result.decisions.description_source.status).toBe('CANONICAL_CONSENSUS_APPLIED');
    expect(result.decisions.source_locale.status).toBe('CANONICAL_CONSENSUS_APPLIED');
  });

  test('préserve explicitement le legacy en cas de conflit ou absence canonique', () => {
    const projected = {
      canonical_product_id: '171637d7-3403-470b-aaba-ccfa65e45dea',
      source_count: 2,
      projection_status: 'PARTIAL_CONFLICT_PRESERVED',
      fields: {
        product_name: {
          status: 'CONFLICT_PRESERVED',
          value: null,
          candidates: [{ value: 'Nom A' }, { value: 'Nom B' }],
        },
        description: { status: 'ABSENT', value: null, candidates: [] },
        source_locale: { status: 'ABSENT', value: null, candidates: [] },
      },
    };

    const result = buildReadSeamTrial(legacy, projected);

    expect(result.status).toBe('SAFE');
    expect(result.summary.canonical_fields_applied).toBe(0);
    expect(result.summary.conflict_fallbacks).toBe(1);
    expect(result.summary.absent_fallbacks).toBe(2);
    expect(result.decisions.name_source).toMatchObject({
      status: 'LEGACY_FALLBACK_CONFLICT',
      legacy_value: 'Nom source legacy',
      candidate_values: ['Nom A', 'Nom B'],
    });
    expect(result.summary.public_contract_equal).toBe(true);
    expect(result.protected_field_changes).toEqual([]);
  });
});
