'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * product-content-model.test.js
 *
 * Périmètre : product-content-model.js — la seule intelligence de tri /
 * filtrage / regroupement du contenu produit enrichi, partagée par mobile
 * et desktop. Aucun DOM ici : on ne teste que la forme de données produite.
 */

const {
  buildProductContentViewModel,
  shouldOfferReadMore,
  CONTENT_LABELS,
} = require('../../js/view-models/product-content-model.js');

describe('buildProductContentViewModel — produit pauvre', () => {
  test('content absent (undefined) → view-model vide, jamais d’exception', () => {
    const vm = buildProductContentViewModel(undefined);
    expect(vm.hasEnrichedContent).toBe(false);
    expect(vm.highlights).toEqual([]);
    expect(vm.specificationGroups).toEqual([]);
    expect(vm.sections).toEqual([]);
    expect(vm.materials).toEqual([]);
    expect(vm.care).toEqual([]);
    expect(vm.warnings).toEqual([]);
    expect(vm.brand).toBeNull();
    expect(vm.shortDescription).toBeNull();
  });

  test('content null → même comportement que content absent', () => {
    expect(buildProductContentViewModel(null)).toEqual(buildProductContentViewModel(undefined));
  });

  test('content présent mais toutes collections vides → hasEnrichedContent false', () => {
    const vm = buildProductContentViewModel({
      brand: null,
      short_description: null,
      highlights: [],
      specifications: [],
      sections: [],
      materials: [],
      care: [],
      warnings: [],
      provenance: { source: 'SUPPLIER', enrichment_version: null, reviewed: false },
    });
    expect(vm.hasEnrichedContent).toBe(false);
  });
});

describe('buildProductContentViewModel — highlights', () => {
  test('filtre les entrées sans label exploitable', () => {
    const vm = buildProductContentViewModel({
      highlights: [
        { key: 'h1', label: 'Cuir véritable' },
        { key: 'h2', label: '   ' },
        { key: 'h3', label: null },
      ],
    });
    expect(vm.highlights).toEqual([{ key: 'h1', label: 'Cuir véritable' }]);
    expect(vm.hasEnrichedContent).toBe(true);
  });
});

describe('buildProductContentViewModel — specifications groupées', () => {
  test('regroupe par group, trie par display_order au sein du groupe, conserve l’ordre d’apparition des groupes', () => {
    const vm = buildProductContentViewModel({
      specifications: [
        { group: 'Semelle', key: 's2', label: 'Type', value: 'Crampons FG', unit: null, display_order: 2 },
        { group: 'Tige', key: 't1', label: 'Matière', value: 'Cuir synthétique', unit: null, display_order: 1 },
        { group: 'Semelle', key: 's1', label: 'Matière', value: 'TPU', unit: null, display_order: 1 },
      ],
    });

    expect(vm.specificationGroups.map((g) => g.group)).toEqual(['Semelle', 'Tige']);
    expect(vm.specificationGroups[0].items.map((i) => i.key)).toEqual(['s1', 's2']);
  });

  test('spécification sans label ou sans valeur exploitable est ignorée', () => {
    const vm = buildProductContentViewModel({
      specifications: [
        { group: 'A', key: 'k1', label: 'Poids', value: '', unit: 'g', display_order: 0 },
        { group: 'A', key: 'k2', label: '', value: '250', unit: 'g', display_order: 1 },
      ],
    });
    expect(vm.specificationGroups).toEqual([]);
  });

  test('group null → un seul groupe implicite, pas une entrée par spécification', () => {
    const vm = buildProductContentViewModel({
      specifications: [
        { group: null, key: 'k1', label: 'Pointure', value: '42', unit: null, display_order: 0 },
        { group: null, key: 'k2', label: 'Coloris', value: 'Rouge', unit: null, display_order: 1 },
      ],
    });
    expect(vm.specificationGroups).toHaveLength(1);
    expect(vm.specificationGroups[0].group).toBeNull();
    expect(vm.specificationGroups[0].items).toHaveLength(2);
  });
});

describe('buildProductContentViewModel — sections éditoriales', () => {
  test('filtre une section TEXT sans texte, une BULLETS sans items, une KEY_VALUE sans entries', () => {
    const vm = buildProductContentViewModel({
      sections: [
        { key: 'empty-text', title: 'Vide', type: 'TEXT', text: null, items: [], entries: [], display_order: 0 },
        { key: 'empty-bullets', title: 'Vide', type: 'BULLETS', text: null, items: [], entries: [], display_order: 1 },
        { key: 'empty-kv', title: 'Vide', type: 'KEY_VALUE', text: null, items: [], entries: [], display_order: 2 },
      ],
    });
    expect(vm.sections).toEqual([]);
  });

  test('trie les sections par display_order indépendamment de l’ordre source', () => {
    const vm = buildProductContentViewModel({
      sections: [
        { key: 'b', title: 'B', type: 'BULLETS', text: null, items: ['x'], entries: [], display_order: 2 },
        { key: 'a', title: 'A', type: 'BULLETS', text: null, items: ['x'], entries: [], display_order: 1 },
      ],
    });
    expect(vm.sections.map((s) => s.key)).toEqual(['a', 'b']);
  });

  test('offer_read_more vrai seulement pour un texte au-delà du seuil partagé', () => {
    const short = 'Un guide des tailles compact.';
    const long = 'x'.repeat(300);

    const vmShort = buildProductContentViewModel({
      sections: [{ key: 's', title: 'Guide', type: 'TEXT', text: short, items: [], entries: [], display_order: 0 }],
    });
    const vmLong = buildProductContentViewModel({
      sections: [{ key: 's', title: 'Guide', type: 'TEXT', text: long, items: [], entries: [], display_order: 0 }],
    });

    expect(vmShort.sections[0].offer_read_more).toBe(false);
    expect(vmLong.sections[0].offer_read_more).toBe(true);
  });
});

describe('buildProductContentViewModel — materials / care / warnings', () => {
  test('nettoie les chaînes vides ou non-string', () => {
    const vm = buildProductContentViewModel({
      materials: ['Cuir', '  ', null, 'Synthétique'],
      care: ['Nettoyer à sec'],
      warnings: [],
    });
    expect(vm.materials).toEqual(['Cuir', 'Synthétique']);
    expect(vm.care).toEqual(['Nettoyer à sec']);
    expect(vm.warnings).toEqual([]);
  });
});

describe('shouldOfferReadMore', () => {
  test('faux pour un texte court ou absent', () => {
    expect(shouldOfferReadMore('')).toBe(false);
    expect(shouldOfferReadMore(null)).toBe(false);
    expect(shouldOfferReadMore('Description courte.')).toBe(false);
  });

  test('vrai au-delà du seuil partagé', () => {
    expect(shouldOfferReadMore('x'.repeat(221))).toBe(true);
  });
});

describe('CONTENT_LABELS — copy unique partagée mobile/desktop', () => {
  test('expose les 5 libellés attendus', () => {
    expect(CONTENT_LABELS).toEqual({
      highlights: 'Points forts',
      specifications: 'Caractéristiques',
      materials: 'Composition',
      care: 'Entretien',
      warnings: 'À savoir',
    });
  });
});
