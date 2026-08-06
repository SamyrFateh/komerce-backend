'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * KOMERCE — Fiche produit enrichie, Commit 1 : contrat fournisseur V2 + content.
 *
 * Vérifie l'extension additive de normalized-supplier-product.v2.schema.json :
 * brand, highlights, specifications, sections, materials, care, warnings.
 * Une source pauvre (V2 sans ces champs) doit rester valide. additionalProperties
 * reste strictement respecté.
 */

const { validateNormalizedProduct } = require('../../services/suppliers/normalized-product');

function poorV2(overrides = {}) {
  return {
    schema_version: '2',
    supplier_name: 'Fournisseur Test',
    product_name: 'Produit générique',
    currency: 'AED',
    raw_payload: {},
    ...overrides,
  };
}

describe('normalized-supplier-product V2 — content éditorial (additif)', () => {
  test('source pauvre V2 sans champs éditoriaux reste valide', () => {
    const result = validateNormalizedProduct(poorV2());
    expect(result.valid).toBe(true);
  });

  test('source riche avec tous les champs éditoriaux valide', () => {
    const result = validateNormalizedProduct(
      poorV2({
        brand: 'EliteSport',
        highlights: [{ key: 'grip', label: 'Adhérence renforcée' }],
        specifications: [
          { group: 'Général', key: 'poids', label: 'Poids', value: '320', unit: 'g', display_order: 1 },
        ],
        sections: [{ key: 'histoire', title: 'Notre histoire', type: 'TEXT', text: 'Un savoir-faire.' }],
        materials: ['Textile', 'Caoutchouc'],
        care: ['Nettoyer à sec'],
        warnings: ['Non adapté au terrain synthétique dur'],
      })
    );
    expect(result.valid).toBe(true);
  });

  test('additionalProperties toujours refusées au niveau racine', () => {
    const result = validateNormalizedProduct(poorV2({ unknown_field: 'x' }));
    expect(result.valid).toBe(false);
  });

  test('additionalProperties refusées dans une entrée highlights[]', () => {
    const result = validateNormalizedProduct(
      poorV2({ highlights: [{ label: 'x', unexpected: 'y' }] })
    );
    expect(result.valid).toBe(false);
  });

  test('type de section invalide refusé', () => {
    const result = validateNormalizedProduct(
      poorV2({ sections: [{ key: 'x', title: 'X', type: 'WEIRD' }] })
    );
    expect(result.valid).toBe(false);
  });

  test('specification sans label ni value refusée', () => {
    const result = validateNormalizedProduct(
      poorV2({ specifications: [{ group: 'G', key: 'k' }] })
    );
    expect(result.valid).toBe(false);
  });

  test('materials/care/warnings vides restent valides (source pauvre honnête)', () => {
    const result = validateNormalizedProduct(
      poorV2({ materials: [], care: [], warnings: [] })
    );
    expect(result.valid).toBe(true);
  });
});
