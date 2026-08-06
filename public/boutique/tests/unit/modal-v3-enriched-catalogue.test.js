'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const catalogue = require('../fixtures/modal-v3-enriched-catalogue.js');

function unitFor(detail, selection) {
  return (detail.sellable_units || []).find((unit) =>
    Object.entries(selection).every(([key, value]) => unit.option_values[key] === value)
  );
}

describe('catalogue déterministe Product Modal v3', () => {
  test('expose exactement six produits et six identifiants uniques', () => {
    expect(catalogue.cases).toHaveLength(6);
    expect(catalogue.products).toHaveLength(6);
    expect(new Set(catalogue.products.map((product) => product.id)).size).toBe(6);
    expect(new Set(catalogue.products.map((product) => product.product_ref)).size).toBe(6);
  });

  test.each(catalogue.cases)('$key respecte le socle Product Detail v1', ({ detail, expectedAxes }) => {
    expect(detail.contract_version).toBe('1');
    expect(['SIMPLE', 'SKU']).toContain(detail.inventory_model);
    expect(detail.product.id).toBeTruthy();
    expect(detail.product.reference).toBeTruthy();
    expect(detail.product.name).toBeTruthy();
    expect(detail.pricing.price_kmf).toBeGreaterThan(0);
    expect(detail.media.length).toBeGreaterThan(0);
    expect(detail.option_axes).toHaveLength(expectedAxes);
    expect(Array.isArray(detail.delivery_options)).toBe(true);
    expect(detail.content).toBeTruthy();
  });

  test('Golden Elite garde rupture, combinaison inexistante et prix variables', () => {
    const { detail } = catalogue.cases.find((entry) => entry.key === 'elite');
    expect(unitFor(detail, { Couleur: 'Bleu', Taille: '43' }).stock_status).toBe('OUT_OF_STOCK');
    expect(unitFor(detail, { Couleur: 'Noir', Taille: '44' })).toBeUndefined();
    expect(new Set(detail.sellable_units.map((unit) => unit.price_kmf)).size).toBeGreaterThan(1);
  });

  test('le vêtement dense contient des choix omis et une rupture explicite', () => {
    const { detail } = catalogue.cases.find((entry) => entry.key === 'garment');
    expect(unitFor(detail, { Couleur: 'Marron', Taille: 'L' }).stock_status).toBe('OUT_OF_STOCK');
    expect(unitFor(detail, { Couleur: 'Noir', Taille: 'XL' })).toBeUndefined();
    expect(detail.option_axes[1].values).toHaveLength(4);
  });

  test('le meuble éprouve trois axes et une livraison spécialisée', () => {
    const { detail } = catalogue.cases.find((entry) => entry.key === 'furniture');
    expect(detail.option_axes.map((axis) => axis.key)).toEqual(['Dimensions', 'Finition', 'Piètement']);
    expect(detail.delivery_options[0].code).toBe('FREIGHT_HOME');
    expect(detail.content.specifications.length).toBeGreaterThanOrEqual(4);
  });

  test('le produit éditorial est riche tout en restant SIMPLE', () => {
    const { detail } = catalogue.cases.find((entry) => entry.key === 'editorial');
    expect(detail.inventory_model).toBe('SIMPLE');
    expect(detail.option_axes).toEqual([]);
    expect(detail.sellable_units).toEqual([]);
    expect(detail.media).toHaveLength(5);
    expect(detail.content.highlights.length).toBeGreaterThan(0);
    expect(detail.content.specifications.length).toBeGreaterThan(0);
  });

  test('le SKU minimal conserve ses variantes sans dépendre du contenu enrichi', () => {
    const { detail } = catalogue.cases.find((entry) => entry.key === 'sku-minimal');
    expect(detail.inventory_model).toBe('SKU');
    expect(detail.option_axes).toHaveLength(2);
    expect(detail.sellable_units.length).toBeGreaterThan(0);
    expect(detail.content.highlights).toEqual([]);
    expect(detail.content.specifications).toEqual([]);
    expect(detail.content.sections).toEqual([]);
  });

  test('la fixture de stress cumule quatre axes, huit médias et un contenu long', () => {
    const { detail } = catalogue.cases.find((entry) => entry.key === 'stress');
    expect(detail.option_axes).toHaveLength(4);
    expect(detail.media).toHaveLength(8);
    expect(detail.sellable_units.length).toBeGreaterThan(20);
    expect(detail.content.highlights.length).toBeGreaterThanOrEqual(8);
    expect(detail.content.specifications.length).toBeGreaterThanOrEqual(7);
    expect(detail.content.sections.length).toBeGreaterThanOrEqual(2);
  });

  test.each(catalogue.cases.filter((entry) => entry.validSelection))('$key possède une sélection vendable de référence', ({ detail, validSelection }) => {
    const unit = unitFor(detail, validSelection);
    expect(unit).toBeTruthy();
    expect(unit.stock_status).toBe('AVAILABLE');
    expect(unit.available_quantity).toBeGreaterThan(0);
  });

  test.each(catalogue.cases.filter((entry) => entry.issueSelection))('$key possède un scénario de rupture ou incompatibilité', ({ detail, issueSelection }) => {
    const unit = unitFor(detail, issueSelection);
    expect(!unit || unit.stock_status !== 'AVAILABLE' || unit.available_quantity === 0).toBe(true);
  });

  test('les lignes catalogue restent alignées sur les contrats détail', () => {
    for (const product of catalogue.products) {
      const entry = catalogue.getCaseById(product.id);
      expect(entry).toBeTruthy();
      expect(product.name).toBe(entry.detail.product.name);
      expect(product.product_ref).toBe(entry.detail.product.reference);
      expect(product.inventory_model).toBe(entry.detail.inventory_model);
      expect(product.image_url).toBe(entry.detail.media[0].url);
    }
  });
});
