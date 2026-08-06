'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/catalog-public-view.test.js
 * Couvre services/catalog-public-view.js
 *
 * Verrouille l'invariant DOCTRINE_CATALOGUE.md : la boutique ne lit jamais
 * les champs de cuisine (name_source, description_source, source_locale,
 * content_source, enrichment_version...), même si la ligne DB source les
 * porte. Si un futur refactor élargit `PUBLIC_PRODUCT_FIELDS` par erreur ou
 * revient à un `res.json(row)` brut, ce fichier doit rougir.
 */

const {
  PUBLIC_PRODUCT_FIELDS,
  publicProductColumns,
  toPublicProduct,
} = require('../../services/catalog-public-view');

const CUISINE_FIELDS = [
  'name_source',
  'description_source',
  'source_locale',
  'content_source',
  'enrichment_version',
  // Migration 100 (K-3) — la frontière whitelist les masque par défaut,
  // ce test verrouille que ça reste vrai.
  'needs_review',
  'enrichment_confidence',
];

describe('toPublicProduct', () => {
  it('ne renvoie que les champs publiés — les champs de cuisine sont absents', () => {
    const row = {
      id: 'p1',
      name: 'Robe fleurie',
      price_kmf: 15000,
      name_source: 'Floral Dress',
      description_source: 'Original EN description',
      source_locale: 'en',
      content_source: 'ai_enriched',
      enrichment_version: 3,
      needs_review: true,
      enrichment_confidence: 0.62,
    };

    const out = toPublicProduct(row);

    expect(out.id).toBe('p1');
    expect(out.name).toBe('Robe fleurie');
    expect(out.price_kmf).toBe(15000);
    for (const cuisine of CUISINE_FIELDS) {
      expect(out).not.toHaveProperty(cuisine);
    }
  });

  it('propage variants quand présent (champ mémoire, pas colonne DB)', () => {
    const row = { id: 'p1', name: 'T-shirt', variants: { taille: [{ value: 'M' }] } };
    const out = toPublicProduct(row);
    expect(out.variants).toEqual({ taille: [{ value: 'M' }] });
  });

  it("n'ajoute pas variants quand absent de la ligne", () => {
    const row = { id: 'p1', name: 'T-shirt' };
    const out = toPublicProduct(row);
    expect(out).not.toHaveProperty('variants');
  });

  it('ignore silencieusement les champs inconnus hors whitelist et variants', () => {
    const row = { id: 'p1', name: 'X', some_future_internal_flag: true };
    const out = toPublicProduct(row);
    expect(out).not.toHaveProperty('some_future_internal_flag');
  });

  it('null/undefined → renvoyés tels quels (pas de crash sur 404 en amont)', () => {
    expect(toPublicProduct(null)).toBeNull();
    expect(toPublicProduct(undefined)).toBeUndefined();
  });

  it("n'invente pas de champ absent de la ligne (pas de undefined explicite)", () => {
    const out = toPublicProduct({ id: 'p1' });
    expect(Object.keys(out)).toEqual(['id']);
  });
});

describe('publicProductColumns', () => {
  it('génère la liste préfixée alignée sur PUBLIC_PRODUCT_FIELDS', () => {
    const sql = publicProductColumns('p');
    for (const field of PUBLIC_PRODUCT_FIELDS) {
      expect(sql).toContain(`p.${field}`);
    }
    for (const cuisine of CUISINE_FIELDS) {
      expect(sql).not.toContain(`p.${cuisine}`);
    }
  });

  it('respecte l\'alias fourni', () => {
    expect(publicProductColumns('x')).toContain('x.id');
    expect(publicProductColumns('x')).not.toContain('p.id');
  });

  it('utilise l\'alias par défaut "p" si omis', () => {
    expect(publicProductColumns()).toContain('p.id');
  });
});
