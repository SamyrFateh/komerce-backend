'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const {
  TAXONOMY_TARGETS,
  profileFor,
  buildSlots,
  cartesianAxes,
  buildV2Contract,
  summary,
} = require('../../scripts/showcase-v2-plan');
const manualConnector = require('../../services/suppliers/connectors/manual-connector');

const PRODUCT = {
  name: 'Produit test',
  source_title: 'Original supplier gift box title',
  source_description: 'Original supplier description kept verbatim for lineage.',
  description: 'Description fournisseur de test suffisamment riche.',
  price_kmf: 10000,
  stock: 9,
  image_url: 'https://res.cloudinary.com/fj7utq0g/image/upload/showcase-v2/hero.jpg',
  images: [
    'https://res.cloudinary.com/fj7utq0g/image/upload/showcase-v2/hero.jpg',
    'https://res.cloudinary.com/fj7utq0g/image/upload/showcase-v2/scene.jpg',
  ],
  source: 'commons:123',
  source_url: 'https://commons.wikimedia.org/?curid=123',
  source_attribution: { license: 'CC BY 4.0' },
  source_locale: 'en',
};

describe('showcase-v2-plan', () => {
  test('couvre exactement 500 produits et 350 fiches riches', () => {
    expect(TAXONOMY_TARGETS.reduce((sum, row) => sum + row.count, 0)).toBe(500);
    expect(TAXONOMY_TARGETS.reduce((sum, row) => sum + row.rich, 0)).toBe(350);
    expect(summary()).toMatchObject({ products: 500, rich_products: 350 });
  });

  test('crée des références V2 uniques et couvre les 6 univers métier', () => {
    const slots = buildSlots();
    expect(new Set(slots.map((slot) => slot.product_ref)).size).toBe(500);
    expect(slots[0].product_ref).toBe('SHOWCASE-V2-0001');
    expect(slots.at(-1).product_ref).toBe('SHOWCASE-V2-0500');
    expect(new Set(slots.map((slot) => slot.category))).toEqual(new Set([
      'Mode & Beauté', 'Maison', 'Tech', 'Bricolage', 'Créations personnelles', 'Auto',
    ]));
    expect(summary().subcategories).toHaveLength(21);
  });

  test('attribue des axes métier adaptés aux principaux rayons', () => {
    expect(profileFor('Tech', 'Phones').map((axis) => axis.key)).toEqual(['Couleur', 'Stockage']);
    expect(profileFor('Auto', 'Freinage').map((axis) => axis.key)).toEqual(['Essieu']);
    expect(profileFor('Mode & Beauté', 'Beauté').map((axis) => axis.key)).toEqual(['Teinte']);
    expect(profileFor('Inconnu', 'Inconnu').map((axis) => axis.key)).toEqual(['Format']);
  });

  test('construit le produit cartésien uniquement dans le flux source de test', () => {
    expect(cartesianAxes([
      { key: 'Couleur', values: ['Noir', 'Bleu'] },
      { key: 'Taille', values: ['M', 'L'] },
    ])).toEqual([
      { Couleur: 'Noir', Taille: 'M' },
      { Couleur: 'Noir', Taille: 'L' },
      { Couleur: 'Bleu', Taille: 'M' },
      { Couleur: 'Bleu', Taille: 'L' },
    ]);
  });

  test('produit un contrat V2 riche avec SKU, stock et couture média explicites', () => {
    const slot = buildSlots()[0]; // rich + globalIndex 0 => matrice volontairement incomplète
    const contract = buildV2Contract(PRODUCT, slot);

    expect(contract.schema_version).toBe('2');
    expect(contract.supplier_name).toBe('Komerce Showcase V2');
    expect(contract.option_axes).toHaveLength(2);
    expect(contract.sellable_units).toHaveLength(5); // 2x3, dernière combinaison absente volontairement
    expect(contract.sellable_units.every((unit) => unit.supplier_sku.startsWith('SHOWCASE-V2-0001-SUP-'))).toBe(true);
    expect(contract.sellable_units.every((unit) => unit.currency === 'KMF')).toBe(true);
    expect(contract.media[1].option_values).toEqual({ Couleur: 'Noir' });
    expect(contract.raw_payload.showcase_v2.rich).toBe(true);
  });

  test('préserve la vérité source au bon niveau après passage par le connecteur manuel', () => {
    const slot = buildSlots()[0];
    const contract = buildV2Contract(PRODUCT, slot);
    expect(contract.source_title).toBe(PRODUCT.source_title);
    expect(contract.source_description).toBe(PRODUCT.source_description);

    const normalized = manualConnector.normalizeFormItem(contract, 'Komerce Showcase V2');
    expect(normalized.raw_payload.source_title).toBe(PRODUCT.source_title);
    expect(normalized.raw_payload.source_description).toBe(PRODUCT.source_description);
    expect(normalized.raw_payload.raw_payload.source).toBe(PRODUCT.source);
  });

  test('un slot simple reste honnêtement sans axes ni unités inventées', () => {
    const slot = buildSlots().find((row) => !row.rich);
    const contract = buildV2Contract(PRODUCT, slot);
    expect(contract.option_axes).toBeNull();
    expect(contract.sellable_units).toBeNull();
    expect(contract.stock_available).toBe(9);
  });
});
