'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 *
 * Régression du drift découvert par le canari AliExpress staging :
 * le NormalizedSupplierProduct V2 canonique expose key/group/type, tandis que
 * les tables catalogue utilisent attribute_key/group_key/section_type.
 * La promotion doit traduire le contrat, jamais exiger la forme DB en entrée.
 */

const {
  mapContentToSectionRows,
  mapContentToAttributeRows,
} = require('../../services/catalog-promotion/content');
const { validateForPromotion } = require('../../services/catalog-promotion');

describe('catalog promotion — couture NormalizedSupplierProduct V2 canonique', () => {
  const contract = {
    schema_version: '2',
    highlights: [
      { key: 'leger', label: 'Léger' },
      { key: 'respirant', label: 'Respirant' },
    ],
    specifications: [
      {
        group: 'general',
        key: 'poids',
        label: 'Poids',
        value: '320',
        unit: 'g',
        display_order: 2,
      },
    ],
    sections: [
      {
        key: 'description-detaillee',
        title: 'Description détaillée',
        type: 'TEXT',
        text: 'Produit de test canonique',
        display_order: 3,
      },
      {
        key: 'avantages',
        title: 'Avantages',
        type: 'BULLETS',
        items: ['Léger', 'Simple à utiliser'],
        display_order: 4,
      },
      {
        key: 'dimensions',
        title: 'Dimensions',
        type: 'KEY_VALUE',
        entries: [{ label: 'Largeur', value: '10 cm' }],
        display_order: 5,
      },
    ],
  };

  it('validateForPromotion accepte la forme V2 canonique', () => {
    expect(() => validateForPromotion(contract)).not.toThrow();
  });

  it('traduit highlights/specifications vers les clés DB sans imposer la forme DB au contrat', () => {
    expect(mapContentToAttributeRows(contract)).toEqual([
      {
        kind: 'HIGHLIGHT',
        group_key: '',
        attribute_key: 'leger',
        label: 'Léger',
        value_text: null,
        unit: null,
        display_order: 0,
        source: 'SUPPLIER',
      },
      {
        kind: 'HIGHLIGHT',
        group_key: '',
        attribute_key: 'respirant',
        label: 'Respirant',
        value_text: null,
        unit: null,
        display_order: 1,
        source: 'SUPPLIER',
      },
      {
        kind: 'SPECIFICATION',
        group_key: 'general',
        attribute_key: 'poids',
        label: 'Poids',
        value_text: '320',
        unit: 'g',
        display_order: 2,
        source: 'SUPPLIER',
      },
    ]);
  });

  it('traduit les trois formes de sections V2 vers content_json', () => {
    expect(mapContentToSectionRows(contract)).toEqual([
      {
        section_key: 'description-detaillee',
        title: 'Description détaillée',
        section_type: 'TEXT',
        content_json: { text: 'Produit de test canonique' },
        display_order: 3,
        source: 'SUPPLIER',
      },
      {
        section_key: 'avantages',
        title: 'Avantages',
        section_type: 'BULLETS',
        content_json: { items: ['Léger', 'Simple à utiliser'] },
        display_order: 4,
        source: 'SUPPLIER',
      },
      {
        section_key: 'dimensions',
        title: 'Dimensions',
        section_type: 'KEY_VALUE',
        content_json: { entries: [{ label: 'Largeur', value: '10 cm' }] },
        display_order: 5,
        source: 'SUPPLIER',
      },
    ]);
  });

  it('refuse explicitement une specification sans key, car la DB exige une identité stable', () => {
    expect(() => mapContentToAttributeRows({
      specifications: [{ group: 'general', key: null, label: 'Poids', value: '320' }],
    })).toThrow(/specifications\[\]\.key requis/);
  });
});
