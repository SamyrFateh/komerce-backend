'use strict';

/**
 * KOMERCE — Fiche produit enrichie, Commit 1 : contrat public v1 + content.
 *
 * Vérifie l'extension additive du schéma product-detail.v1 :
 *  - un ancien contrat sans `content` reste valide (rétrocompatibilité) ;
 *  - un contrat enrichi complet est valide ;
 *  - `additionalProperties: false` est bien respecté à l'intérieur de `content` ;
 *  - les limites de cardinalité/longueur sont respectées ;
 *  - un `type` de section invalide est refusé ;
 *  - une `provenance` invalide est refusée ;
 *  - un `display_order` négatif est refusé (ordre invalide).
 */

const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const schema = require('../../schemas/catalog/product-detail.v1.schema.json');

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(schema);

function baseDetail(overrides = {}) {
  return {
    contract_version: '1',
    inventory_model: 'LEGACY_VARIANTS',
    product: {
      id: '11111111-1111-4111-8111-111111111111',
      reference: 'ROB-001',
      name: 'Robe Dubaï',
      description: 'Robe fluide',
      category: 'vetements',
      subcategory: 'robes',
    },
    pricing: { price_kmf: 12500, old_price_kmf: null, promo_pct: null },
    media: [],
    option_axes: [],
    sellable_units: [],
    delivery_options: [],
    ...overrides,
  };
}

function fullContent(overrides = {}) {
  return {
    brand: 'EliteSport',
    short_description: 'Chaussure de football haute performance',
    highlights: [{ key: 'grip', label: 'Adhérence renforcée' }],
    specifications: [
      { group: 'Général', key: 'poids', label: 'Poids', value: '320', unit: 'g', display_order: 0 },
    ],
    sections: [
      {
        key: 'histoire',
        title: 'Notre histoire',
        type: 'TEXT',
        text: 'Un savoir-faire artisanal.',
        items: [],
        entries: [],
        display_order: 0,
      },
    ],
    materials: ['Textile', 'Caoutchouc'],
    care: ['Nettoyer à sec'],
    warnings: ['Non adapté au terrain synthétique dur'],
    provenance: { source: 'SUPPLIER', enrichment_version: null, reviewed: false },
    ...overrides,
  };
}

describe('product-detail.v1.schema.json — content (additif)', () => {
  test('ancien contrat SANS content reste valide', () => {
    const detail = baseDetail();
    expect(validate(detail)).toBe(true);
    expect(detail.content).toBeUndefined();
  });

  test('contrat enrichi complet valide', () => {
    const detail = baseDetail({ content: fullContent() });
    expect(validate(detail)).toBe(true);
  });

  test('content avec collections vides reste valide (produit pauvre honnête)', () => {
    const detail = baseDetail({
      content: fullContent({
        brand: null,
        short_description: null,
        highlights: [],
        specifications: [],
        sections: [],
        materials: [],
        care: [],
        warnings: [],
      }),
    });
    expect(validate(detail)).toBe(true);
  });

  test('additionalProperties refusées dans content', () => {
    const detail = baseDetail({ content: fullContent({ unknown_field: 'nope' }) });
    expect(validate(detail)).toBe(false);
    expect(validate.errors.some((e) => e.message.includes('additional properties'))).toBe(true);
  });

  test('additionalProperties refusées dans une entrée sections[]', () => {
    const content = fullContent();
    content.sections[0].unexpected = 'nope';
    const detail = baseDetail({ content });
    expect(validate(detail)).toBe(false);
  });

  test('type de section invalide refusé', () => {
    const content = fullContent();
    content.sections[0].type = 'WEIRD';
    const detail = baseDetail({ content });
    expect(validate(detail)).toBe(false);
  });

  test('provenance.source invalide refusée', () => {
    const content = fullContent({ provenance: { source: 'NOPE', enrichment_version: null, reviewed: false } });
    const detail = baseDetail({ content });
    expect(validate(detail)).toBe(false);
  });

  test('display_order négatif refusé (ordre invalide)', () => {
    const content = fullContent();
    content.specifications[0].display_order = -1;
    const detail = baseDetail({ content });
    expect(validate(detail)).toBe(false);
  });

  test('cardinalité highlights > 12 refusée', () => {
    const content = fullContent({
      highlights: Array.from({ length: 13 }, (_, i) => ({ key: `h${i}`, label: `Point ${i}` })),
    });
    const detail = baseDetail({ content });
    expect(validate(detail)).toBe(false);
  });

  test('brand trop long refusé (> 200 caractères)', () => {
    const content = fullContent({ brand: 'x'.repeat(201) });
    const detail = baseDetail({ content });
    expect(validate(detail)).toBe(false);
  });

  test('warnings vide et materials/care vides ne cassent rien (produit simple)', () => {
    const content = fullContent({ materials: [], care: [], warnings: [] });
    const detail = baseDetail({ content });
    expect(validate(detail)).toBe(true);
  });
});
