'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const {
  validateNormalizedProduct,
  buildNormalizedSourceContractSnapshot,
} = require('../../services/suppliers/normalized-product');

function richProduct(overrides = {}) {
  return {
    schema_version: '2',
    supplier_name: 'Dubai Fashion',
    supplier_product_id: 'ROB-001',
    product_name: 'Dubai dress',
    currency: 'AED',
    source_locale: 'en-AE',
    media: [
      {
        supplier_media_id: 'm-brown-scene',
        url: 'https://cdn.example.com/brown-scene.jpg',
        role: 'SCENE',
        option_values: { Couleur: 'Marron' },
        display_order: 1,
      },
      {
        supplier_media_id: 'm-beige-product',
        url: 'https://cdn.example.com/beige.jpg',
        role: 'PRODUCT',
        option_values: { Couleur: 'Beige' },
        display_order: 2,
      },
    ],
    option_axes: [
      { key: 'Couleur', display_name: 'Couleur', values: ['Marron', 'Beige'], display_order: 1 },
      { key: 'Taille', display_name: 'Taille', values: ['S', 'M', 'L'], display_order: 2 },
    ],
    sellable_units: [
      {
        supplier_sku: 'ROB-001-MAR-M',
        option_values: { Couleur: 'Marron', Taille: 'M' },
        stock_available: 4,
        media_refs: ['m-brown-scene'],
      },
      {
        supplier_sku: 'ROB-001-MAR-L',
        option_values: { Couleur: 'Marron', Taille: 'L' },
        stock_available: 0,
        media_refs: ['m-brown-scene'],
      },
      {
        supplier_sku: 'ROB-001-BEI-L',
        option_values: { Couleur: 'Beige', Taille: 'L' },
        stock_available: 3,
        media_refs: ['m-beige-product'],
      },
    ],
    raw_payload: { id: 'ROB-001', supplier_variants: ['...'] },
    ...overrides,
  };
}

describe('NormalizedSupplierProduct v2 contract', () => {
  test('préserve et valide médias, axes et unités vendables explicitement fournis', () => {
    expect(validateNormalizedProduct(richProduct())).toEqual({ valid: true, errors: [] });
  });

  test('V1 historique sans schema_version reste valide', () => {
    expect(validateNormalizedProduct({
      supplier_name: 'Legacy',
      product_name: 'Produit plat',
      currency: 'AED',
      raw_payload: {},
    })).toEqual({ valid: true, errors: [] });
  });

  test('une structure riche sans schema_version ne bascule pas silencieusement en V2', () => {
    const { schema_version, ...withoutVersion } = richProduct();
    const verdict = validateNormalizedProduct(withoutVersion);
    expect(verdict.valid).toBe(false);
    expect(verdict.errors.some((error) => error.includes('champ inconnu hors contrat'))).toBe(true);
  });

  test('une version inconnue est refusée explicitement', () => {
    const verdict = validateNormalizedProduct(richProduct({ schema_version: '3' }));
    expect(verdict.valid).toBe(false);
    expect(verdict.errors).toContain('schema_version non supportée : "3" (versions supportées : 1, 2)');
  });

  test.each([
    ['const', { schema_version: 2 }],
    ['minimum', { stock_available: -1 }],
    ['maximum', { supplier_delay_days: 366 }],
    ['minLength', { source_locale: '' }],
    ['maxLength', { supplier_product_id: 'X'.repeat(129) }],
    ['format', { image_url: 'pas-une-url' }],
    ['type', { raw_payload: null }],
    ['minItems', { option_axes: [{ key: 'Couleur', values: [] }], sellable_units: [] }],
    ['uniqueItems', { option_axes: [{ key: 'Couleur', values: ['Marron', 'Marron'] }], sellable_units: [] }],
    ['maxItems', { media: Array.from({ length: 101 }, (_, i) => ({ url: `https://cdn.example.com/${i}.jpg`, role: 'OTHER' })), sellable_units: [] }],
  ])('humanise et refuse le mot-clé schéma %s', (_keyword, overrides) => {
    expect(validateNormalizedProduct(richProduct(overrides)).valid).toBe(false);
  });

  test('refuse deux axes portant la même clé', () => {
    const product = richProduct({
      option_axes: [
        { key: 'Couleur', values: ['Marron'] },
        { key: 'Couleur', values: ['Beige'] },
      ],
      sellable_units: [],
    });
    const verdict = validateNormalizedProduct(product);
    expect(verdict.valid).toBe(false);
    expect(verdict.errors).toContain('option_axes : axe dupliqué "Couleur"');
  });

  test('refuse deux médias portant la même référence fournisseur', () => {
    const media = richProduct().media[0];
    const product = richProduct({
      media: [media, { ...media, url: 'https://cdn.example.com/duplicate.jpg' }],
      sellable_units: [],
    });
    const verdict = validateNormalizedProduct(product);
    expect(verdict.valid).toBe(false);
    expect(verdict.errors).toContain('media[1] : supplier_media_id dupliqué "m-brown-scene"');
  });

  test('refuse un média associé à un axe inconnu', () => {
    const product = richProduct({
      media: [{
        supplier_media_id: 'm-style',
        url: 'https://cdn.example.com/style.jpg',
        role: 'SCENE',
        option_values: { Style: 'Soirée' },
      }],
      sellable_units: [],
    });
    const verdict = validateNormalizedProduct(product);
    expect(verdict.valid).toBe(false);
    expect(verdict.errors).toContain('media[0].option_values : axe inconnu "Style"');
  });

  test('refuse un SKU dont la combinaison est incomplète', () => {
    const product = richProduct({
      sellable_units: [{
        supplier_sku: 'ROB-INCOMPLETE',
        option_values: { Couleur: 'Marron' },
        stock_available: 1,
      }],
    });
    const verdict = validateNormalizedProduct(product);
    expect(verdict.valid).toBe(false);
    expect(verdict.errors).toContain('sellable_units[0].option_values incomplet : axe "Taille" absent');
  });

  test('refuse des valeurs d’option alors qu’aucun axe n’est déclaré', () => {
    const product = richProduct({
      option_axes: [],
      media: [],
      sellable_units: [{
        supplier_sku: 'ROB-ORPHAN',
        option_values: { Couleur: 'Marron' },
        stock_available: 1,
      }],
    });
    const verdict = validateNormalizedProduct(product);
    expect(verdict.valid).toBe(false);
    expect(verdict.errors).toContain('sellable_units[0].option_values : aucun axe déclaré');
    expect(verdict.errors).toContain('sellable_units[0].option_values : axe inconnu "Couleur"');
  });

  test('refuse une valeur d’option inconnue au lieu de la deviner', () => {
    const product = richProduct({
      sellable_units: [{
        supplier_sku: 'ROB-XL',
        option_values: { Couleur: 'Marron', Taille: 'XL' },
        stock_available: 1,
      }],
    });
    const verdict = validateNormalizedProduct(product);
    expect(verdict.valid).toBe(false);
    expect(verdict.errors).toContain('sellable_units[0].option_values : valeur inconnue Taille="XL"');
  });

  test('refuse deux supplier_sku identiques', () => {
    const first = richProduct().sellable_units[0];
    const product = richProduct({
      sellable_units: [
        first,
        { ...richProduct().sellable_units[2], supplier_sku: first.supplier_sku },
      ],
    });
    const verdict = validateNormalizedProduct(product);
    expect(verdict.valid).toBe(false);
    expect(verdict.errors.some((error) => error.includes('supplier_sku dupliqué'))).toBe(true);
  });

  test('refuse deux unités pour la même combinaison même avec deux références fournisseur', () => {
    const unit = richProduct().sellable_units[0];
    const product = richProduct({
      sellable_units: [
        unit,
        { ...unit, supplier_sku: 'AUTRE-REF' },
      ],
    });
    const verdict = validateNormalizedProduct(product);
    expect(verdict.valid).toBe(false);
    expect(verdict.errors).toContain("sellable_units[1] : combinaison d'options dupliquée");
  });

  test('refuse une référence média inconnue', () => {
    const product = richProduct({
      sellable_units: [{
        supplier_sku: 'ROB-001-MAR-M',
        option_values: { Couleur: 'Marron', Taille: 'M' },
        stock_available: 4,
        media_refs: ['missing-media'],
      }],
    });
    const verdict = validateNormalizedProduct(product);
    expect(verdict.valid).toBe(false);
    expect(verdict.errors).toContain('sellable_units[0].media_refs : média inconnu "missing-media"');
  });

  test('un média peut être associé à un axe partiel mais pas à une valeur inconnue', () => {
    const product = richProduct({
      media: [{
        supplier_media_id: 'm-unknown',
        url: 'https://cdn.example.com/unknown.jpg',
        role: 'SCENE',
        option_values: { Couleur: 'Vert' },
      }],
      sellable_units: [],
    });
    const verdict = validateNormalizedProduct(product);
    expect(verdict.valid).toBe(false);
    expect(verdict.errors).toContain('media[0].option_values : valeur inconnue Couleur="Vert"');
  });

  test('snapshot V2 conserve le contrat normalisé et exclut le raw_payload', () => {
    const product = richProduct();
    const snapshot = buildNormalizedSourceContractSnapshot(product);

    expect(snapshot.schema_version).toBe('2');
    expect(snapshot.media).toEqual(product.media);
    expect(snapshot.option_axes).toEqual(product.option_axes);
    expect(snapshot.sellable_units).toEqual(product.sellable_units);
    expect(snapshot).not.toHaveProperty('raw_payload');
  });

  test('snapshot V2 invalide échoue bruyamment avec un code stable', () => {
    expect(() => buildNormalizedSourceContractSnapshot(richProduct({
      sellable_units: [{
        supplier_sku: 'ROB-BAD',
        option_values: { Couleur: 'Marron' },
      }],
    }))).toThrow('NormalizedSupplierProduct v2 invalide');

    try {
      buildNormalizedSourceContractSnapshot(richProduct({ raw_payload: null }));
      throw new Error('le snapshot invalide aurait dû échouer');
    } catch (err) {
      expect(err.code).toBe('NORMALIZED_SOURCE_CONTRACT_INVALID');
    }
  });

  test('snapshot V1 reste null : aucune richesse inventée', () => {
    expect(buildNormalizedSourceContractSnapshot({
      supplier_name: 'Legacy',
      product_name: 'Produit plat',
      currency: 'AED',
      raw_payload: {},
    })).toBeNull();
  });
});
