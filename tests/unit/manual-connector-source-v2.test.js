'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const {
  fetchProducts,
  normalizeFormItem,
} = require('../../services/suppliers/connectors/manual-connector');

function richManualItem(overrides = {}) {
  return {
    product_name: 'Robe Dubaï',
    supplier_product_id: 'ROB-001',
    currency: 'AED',
    source_locale: 'en-AE',
    media: [{
      supplier_media_id: 'scene-brown',
      url: 'https://cdn.example.com/scene-brown.jpg',
      role: 'SCENE',
      option_values: { Couleur: 'Marron' },
    }],
    option_axes: [
      { key: 'Couleur', values: ['Marron', 'Beige'] },
      { key: 'Taille', values: ['M', 'L'] },
    ],
    sellable_units: [
      {
        supplier_sku: 'ROB-MAR-M',
        option_values: { Couleur: 'Marron', Taille: 'M' },
        stock_available: 4,
        media_refs: ['scene-brown'],
      },
      {
        supplier_sku: 'ROB-MAR-L',
        option_values: { Couleur: 'Marron', Taille: 'L' },
        stock_available: 0,
        media_refs: ['scene-brown'],
      },
    ],
    ...overrides,
  };
}

describe('manual rich source — contrat V2', () => {
  test('une saisie riche sans version explicite est promue en V2 et préservée telle quelle', () => {
    const item = richManualItem();
    const normalized = normalizeFormItem(item, 'Manual Dubai');

    expect(normalized.schema_version).toBe('2');
    expect(normalized.source_locale).toBe(item.source_locale);
    expect(normalized.media).toEqual(item.media);
    expect(normalized.option_axes).toEqual(item.option_axes);
    expect(normalized.sellable_units).toEqual(item.sellable_units);
    expect(normalized.raw_payload).toEqual(item);
  });

  test('fetchProducts accepte la structure riche valide sans reconstruire de matrice', () => {
    const item = richManualItem();
    const result = fetchProducts({
      supplier_name: 'Manual Dubai',
      items: [item],
    });

    expect(result.invalid).toEqual([]);
    expect(result.products).toHaveLength(1);
    expect(result.products[0].sellable_units).toHaveLength(2);
    expect(result.products[0].sellable_units.map((unit) => unit.supplier_sku)).toEqual([
      'ROB-MAR-M',
      'ROB-MAR-L',
    ]);
    expect(result.products[0].sellable_units.some((unit) =>
      unit.option_values.Couleur === 'Beige'
    )).toBe(false);
  });

  test('une saisie plate reste V1 compatible et ne reçoit pas de structure artificielle', () => {
    const normalized = normalizeFormItem({
      product_name: 'Savon',
      currency: 'AED',
      stock_available: 12,
    }, 'Manual');

    expect(normalized).not.toHaveProperty('schema_version');
    expect(normalized).not.toHaveProperty('media');
    expect(normalized).not.toHaveProperty('option_axes');
    expect(normalized).not.toHaveProperty('sellable_units');
  });

  test('une version v1 explicitement annoncée avec des champs riches est rejetée, pas promue', () => {
    const result = fetchProducts({
      supplier_name: 'Manual Dubai',
      items: [richManualItem({ schema_version: '1' })],
    });

    expect(result.products).toEqual([]);
    expect(result.invalid).toHaveLength(1);
    expect(result.invalid[0].errors.some((error) => error.includes('champ inconnu hors contrat'))).toBe(true);
  });

  test('une combinaison incomplète remonte un rejet motivé du contrat V2', () => {
    const item = richManualItem({
      sellable_units: [{
        supplier_sku: 'ROB-INCOMPLETE',
        option_values: { Couleur: 'Marron' },
        stock_available: 2,
      }],
    });

    const result = fetchProducts({
      supplier_name: 'Manual Dubai',
      items: [item],
    });

    expect(result.products).toEqual([]);
    expect(result.invalid[0].errors).toContain(
      'sellable_units[0].option_values incomplet : axe "Taille" absent'
    );
  });
});
