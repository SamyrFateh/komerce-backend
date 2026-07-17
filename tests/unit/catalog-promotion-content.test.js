'use strict';

/**
 * tests/unit/catalog-promotion-content.test.js
 *
 * Couvre services/catalog-promotion/content.js (Lot Content) : fonctions pures de
 * projection du contenu éditorial V2 (brand, short_description, highlights[],
 * specifications[], sections[], materials, care, warnings) vers les formes DB
 * (product_content_profile / product_content_sections / product_attributes).
 *
 * Ce module ne touche jamais la DB — voir tests/unit/catalog-promotion-content-db.test.js
 * pour l'écriture idempotente réelle (override manuel, désactivation, ré-promotion).
 */

const {
  mapContentToProfileRow,
  mapContentToSectionRows,
  mapContentToAttributeRows,
} = require('../../services/catalog-promotion/content');

describe('catalog-promotion/content — mapContentToProfileRow', () => {
  it('projette brand + short_description tels quels, trim appliqué', () => {
    const row = mapContentToProfileRow({ brand: '  Nike  ', short_description: '  Une robe légère  ' });
    expect(row).toEqual({
      brand: 'Nike',
      short_description: 'Une robe légère',
      source: 'SUPPLIER',
      enrichment_version: null,
      reviewed: false,
    });
  });

  it('champs éditoriaux absents -> profil tout-null, source par défaut SUPPLIER', () => {
    const row = mapContentToProfileRow({});
    expect(row).toEqual({
      brand: null,
      short_description: null,
      source: 'SUPPLIER',
      enrichment_version: null,
      reviewed: false,
    });
  });

  it('chaîne vide ou blanche traitée comme absente (jamais une chaîne vide en DB)', () => {
    const row = mapContentToProfileRow({ brand: '   ', short_description: '' });
    expect(row.brand).toBeNull();
    expect(row.short_description).toBeNull();
  });

  it('options.source / enrichmentVersion / reviewed respectés (ex. AI_ENRICHED)', () => {
    const row = mapContentToProfileRow({ brand: 'Nike' }, { source: 'AI_ENRICHED', enrichmentVersion: 'v3', reviewed: true });
    expect(row).toEqual({
      brand: 'Nike',
      short_description: null,
      source: 'AI_ENRICHED',
      enrichment_version: 'v3',
      reviewed: true,
    });
  });

  it('rejette un contract non-objet', () => {
    expect(() => mapContentToProfileRow(null)).toThrow(/contract requis/);
  });

  it('rejette un brand non-string', () => {
    expect(() => mapContentToProfileRow({ brand: 42 })).toThrow(/valeur textuelle attendue/);
  });
});

describe('catalog-promotion/content — mapContentToSectionRows', () => {
  it('aucun champ éditorial -> tableau vide', () => {
    expect(mapContentToSectionRows({})).toEqual([]);
  });

  it('projette une section custom avec display_order fourni', () => {
    const rows = mapContentToSectionRows({
      sections: [
        { section_key: 'guide-taille', title: 'Guide des tailles', section_type: 'KEY_VALUE', content: { entries: [{ label: '42', value: 'EU 42' }] }, display_order: 5 },
      ],
    });
    expect(rows).toEqual([
      { section_key: 'guide-taille', title: 'Guide des tailles', section_type: 'KEY_VALUE', content_json: { entries: [{ label: '42', value: 'EU 42' }] }, display_order: 5, source: 'SUPPLIER' },
    ]);
  });

  it('display_order absent -> index positionnel (jamais fabriqué au hasard)', () => {
    const rows = mapContentToSectionRows({
      sections: [
        { section_key: 'a', content: 'A' },
        { section_key: 'b', content: 'B' },
      ],
    });
    expect(rows[0].display_order).toBe(0);
    expect(rows[1].display_order).toBe(1);
  });

  it('section_type absent -> défaut TEXT', () => {
    const rows = mapContentToSectionRows({ sections: [{ section_key: 'a', content: 'A' }] });
    expect(rows[0].section_type).toBe('TEXT');
  });

  it('rejette un section_type invalide', () => {
    expect(() => mapContentToSectionRows({ sections: [{ section_key: 'a', section_type: 'VIDEO', content: 'x' }] }))
      .toThrow(/section_type invalide/);
  });

  it('rejette un section_key dupliqué', () => {
    expect(() => mapContentToSectionRows({ sections: [{ section_key: 'a', content: '1' }, { section_key: 'a', content: '2' }] }))
      .toThrow(/section_key dupliqué/);
  });

  it('rejette une section custom utilisant une clé réservée (materials/care/warnings)', () => {
    expect(() => mapContentToSectionRows({ sections: [{ section_key: 'materials', content: 'x' }] }))
      .toThrow(/réservé/);
    expect(() => mapContentToSectionRows({ sections: [{ section_key: 'care', content: 'x' }] }))
      .toThrow(/réservé/);
    expect(() => mapContentToSectionRows({ sections: [{ section_key: 'warnings', content: 'x' }] }))
      .toThrow(/réservé/);
  });

  it('materials/care/warnings projetés en sections réservées BULLETS, après les sections custom', () => {
    const rows = mapContentToSectionRows({
      sections: [{ section_key: 'guide-taille', content: 'x' }],
      materials: ['100% coton'],
      care: ['Lavage à 30°C'],
      warnings: ['Ne pas repasser'],
    });
    expect(rows).toEqual([
      { section_key: 'guide-taille', title: null, section_type: 'TEXT', content_json: 'x', display_order: 0, source: 'SUPPLIER' },
      { section_key: 'materials', title: 'Matériaux', section_type: 'BULLETS', content_json: { items: ['100% coton'] }, display_order: 1, source: 'SUPPLIER' },
      { section_key: 'care', title: 'Entretien', section_type: 'BULLETS', content_json: { items: ['Lavage à 30°C'] }, display_order: 2, source: 'SUPPLIER' },
      { section_key: 'warnings', title: 'Avertissements', section_type: 'BULLETS', content_json: { items: ['Ne pas repasser'] }, display_order: 3, source: 'SUPPLIER' },
    ]);
  });

  it('materials/care/warnings absents ou vides -> aucune section réservée générée', () => {
    const rows = mapContentToSectionRows({ materials: null, care: [], warnings: undefined });
    expect(rows).toEqual([]);
  });

  it('rejette un section_key vide', () => {
    expect(() => mapContentToSectionRows({ sections: [{ section_key: '  ', content: 'x' }] }))
      .toThrow(/section_key requis/);
  });

  it('rejette sections non-tableau', () => {
    expect(() => mapContentToSectionRows({ sections: 'oops' })).toThrow(/tableau ou null/);
  });
});

describe('catalog-promotion/content — mapContentToAttributeRows', () => {
  it('aucun champ éditorial -> tableau vide', () => {
    expect(mapContentToAttributeRows({})).toEqual([]);
  });

  it('projette highlights[] avec attribute_key ordinal stable (h1, h2, ...)', () => {
    const rows = mapContentToAttributeRows({ highlights: ['Léger', 'Respirant'] });
    expect(rows).toEqual([
      { kind: 'HIGHLIGHT', group_key: '', attribute_key: 'h1', label: 'Léger', value_text: null, unit: null, display_order: 0, source: 'SUPPLIER' },
      { kind: 'HIGHLIGHT', group_key: '', attribute_key: 'h2', label: 'Respirant', value_text: null, unit: null, display_order: 1, source: 'SUPPLIER' },
    ]);
  });

  it('rejette un highlight vide', () => {
    expect(() => mapContentToAttributeRows({ highlights: ['  '] })).toThrow(/highlights.*invalide/);
  });

  it('projette specifications[] avec group_key par défaut "general" et label replié sur attribute_key', () => {
    const rows = mapContentToAttributeRows({
      specifications: [{ attribute_key: 'poids', value: 500, unit: 'g' }],
    });
    expect(rows).toEqual([
      { kind: 'SPECIFICATION', group_key: 'general', attribute_key: 'poids', label: 'poids', value_text: '500', unit: 'g', display_order: 0, source: 'SUPPLIER' },
    ]);
  });

  it('rejette une specification sans attribute_key ou sans value', () => {
    expect(() => mapContentToAttributeRows({ specifications: [{ value: '500' }] })).toThrow(/attribute_key requis/);
    expect(() => mapContentToAttributeRows({ specifications: [{ attribute_key: 'poids' }] })).toThrow(/value requis/);
  });

  it('rejette un attribut dupliqué (même triplet kind/group_key/attribute_key)', () => {
    expect(() => mapContentToAttributeRows({
      specifications: [
        { group_key: 'dimensions', attribute_key: 'poids', value: 500 },
        { group_key: 'dimensions', attribute_key: 'poids', value: 600 },
      ],
    })).toThrow(/attribut dupliqué/);
  });

  it('deux groupes différents peuvent partager le même attribute_key sans collision', () => {
    const rows = mapContentToAttributeRows({
      specifications: [
        { group_key: 'dimensions', attribute_key: 'largeur', value: 10, unit: 'cm' },
        { group_key: 'emballage', attribute_key: 'largeur', value: 30, unit: 'cm' },
      ],
    });
    expect(rows).toHaveLength(2);
    expect(rows[0].group_key).toBe('dimensions');
    expect(rows[1].group_key).toBe('emballage');
  });

  it('highlights et specifications combinés, display_order indépendant par kind', () => {
    const rows = mapContentToAttributeRows({
      highlights: ['Léger'],
      specifications: [{ attribute_key: 'poids', value: 500 }],
    });
    expect(rows.map((r) => r.kind)).toEqual(['HIGHLIGHT', 'SPECIFICATION']);
    expect(rows[0].display_order).toBe(0);
    expect(rows[1].display_order).toBe(0);
  });

  it('rejette highlights/specifications non-tableau', () => {
    expect(() => mapContentToAttributeRows({ highlights: 'oops' })).toThrow(/tableau ou null/);
    expect(() => mapContentToAttributeRows({ specifications: 'oops' })).toThrow(/tableau ou null/);
  });
});
