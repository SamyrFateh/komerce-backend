'use strict';

const { mapOptionAxesToDescriptiveRows } = require('../../services/catalog-promotion/axes');

describe('catalog-promotion/axes — mapOptionAxesToDescriptiveRows (PDC-8 Lot 3)', () => {
  test('null ou undefined → tableau vide (source pauvre reste pauvre)', () => {
    expect(mapOptionAxesToDescriptiveRows(null)).toEqual([]);
    expect(mapOptionAxesToDescriptiveRows(undefined)).toEqual([]);
  });

  test('un axe simple produit une ligne descriptive par valeur', () => {
    const rows = mapOptionAxesToDescriptiveRows([
      { key: 'couleur', display_name: 'Couleur', values: ['Rouge', 'Noir'] },
    ]);
    expect(rows).toEqual([
      { variant_type: 'couleur', variant_value: 'Rouge', display_name: 'Couleur', display_order: null },
      { variant_type: 'couleur', variant_value: 'Noir', display_name: 'Couleur', display_order: null },
    ]);
  });

  test('deux axes ne produisent JAMAIS un produit cartésien', () => {
    const rows = mapOptionAxesToDescriptiveRows([
      { key: 'couleur', values: ['Rouge', 'Noir'] },
      { key: 'taille', values: ['M', 'L'] },
    ]);
    // 2 + 2 = 4 lignes descriptives, jamais 2*2=4 combinaisons Rouge×M etc.
    expect(rows).toHaveLength(4);
    expect(rows.map(r => `${r.variant_type}=${r.variant_value}`)).toEqual([
      'couleur=Rouge', 'couleur=Noir', 'taille=M', 'taille=L',
    ]);
    // Vérifie explicitement l'absence de toute clé combinée
    for (const row of rows) {
      expect(row).not.toHaveProperty('couleur');
      expect(row).not.toHaveProperty('taille');
      expect(Object.keys(row).sort()).toEqual(
        ['display_name', 'display_order', 'variant_type', 'variant_value'].sort()
      );
    }
  });

  test('display_name absent de la source → null, jamais fabriqué', () => {
    const rows = mapOptionAxesToDescriptiveRows([{ key: 'taille', values: ['M'] }]);
    expect(rows[0].display_name).toBeNull();
  });

  test('nouvelle valeur ajoutée au replay : la fonction ne recrée pas les existantes (dédoublonnage interne)', () => {
    const rows = mapOptionAxesToDescriptiveRows([
      { key: 'taille', values: ['M', 'M', 'L'] }, // doublon intra-source
    ]);
    expect(rows).toHaveLength(2);
    expect(rows.map(r => r.variant_value)).toEqual(['M', 'L']);
  });

  test('rejette une valeur vide ou non-string', () => {
    expect(() => mapOptionAxesToDescriptiveRows([{ key: 'taille', values: ['', 'M'] }])).toThrow();
    expect(() => mapOptionAxesToDescriptiveRows([{ key: 'taille', values: [42] }])).toThrow();
  });

  test('rejette un axe sans key', () => {
    expect(() => mapOptionAxesToDescriptiveRows([{ values: ['M'] }])).toThrow();
  });

  test('rejette un axe sans values ou values vide', () => {
    expect(() => mapOptionAxesToDescriptiveRows([{ key: 'taille', values: [] }])).toThrow();
    expect(() => mapOptionAxesToDescriptiveRows([{ key: 'taille' }])).toThrow();
  });

  test('rejette option_axes qui ne serait pas un tableau', () => {
    expect(() => mapOptionAxesToDescriptiveRows({ key: 'taille' })).toThrow();
  });

  test('trim des espaces sur key et values', () => {
    const rows = mapOptionAxesToDescriptiveRows([
      { key: '  couleur  ', display_name: '  Couleur  ', values: [' Rouge '] },
    ]);
    expect(rows[0]).toEqual({
      variant_type: 'couleur', variant_value: 'Rouge', display_name: 'Couleur', display_order: null,
    });
  });
});
