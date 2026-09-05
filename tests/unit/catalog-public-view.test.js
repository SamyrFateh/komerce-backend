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
 * porte. Verrouille aussi la frontière d'exposition publique : les fixtures
 * SHOWCASE-V2 et médias inline synthétiques ne doivent jamais rejoindre la
 * Boutique réelle.
 */

const {
  PUBLIC_CATALOG_EXCLUDED_REF_PREFIXES,
  PUBLIC_PRODUCT_FIELDS,
  isSyntheticPublicMediaUrl,
  isExcludedPublicProductRef,
  isPublicCatalogProduct,
  publicCatalogVisibilitySql,
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

describe('public catalog visibility', () => {
  it('exclut explicitement le namespace des 500 fixtures SHOWCASE-V2', () => {
    expect(PUBLIC_CATALOG_EXCLUDED_REF_PREFIXES).toContain('SHOWCASE-V2-');
    expect(isExcludedPublicProductRef('SHOWCASE-V2-0273')).toBe(true);
    expect(isExcludedPublicProductRef('CJ-REAL-TECH-001')).toBe(false);
    expect(isExcludedPublicProductRef('GOLDEN-ELITE-PRO')).toBe(false);
  });

  it('classe tout data:image comme média synthétique', () => {
    expect(isSyntheticPublicMediaUrl('data:image/svg+xml;base64,PHN2Zz4=')).toBe(true);
    expect(isSyntheticPublicMediaUrl('data:image/png;base64,AAAA')).toBe(true);
    expect(isSyntheticPublicMediaUrl('https://cdn.example.com/product.jpg')).toBe(false);
    expect(isSyntheticPublicMediaUrl('/images/golden.jpg')).toBe(false);
  });

  it('ne publie qu’un produit actif, hors fixtures, avec vrai hero', () => {
    expect(isPublicCatalogProduct({
      is_active: true,
      product_ref: 'CJ-REAL-TECH-001',
      image_url: 'https://cdn.example.com/product.jpg',
    })).toBe(true);

    expect(isPublicCatalogProduct({
      is_active: true,
      product_ref: 'SHOWCASE-V2-0273',
      image_url: 'https://cdn.example.com/fixture.jpg',
    })).toBe(false);

    expect(isPublicCatalogProduct({
      is_active: true,
      product_ref: 'CJ-REAL-TECH-001',
      image_url: 'data:image/svg+xml;base64,PHN2Zz4=',
    })).toBe(false);

    expect(isPublicCatalogProduct({
      is_active: true,
      product_ref: 'CJ-REAL-TECH-001',
      image_url: '',
    })).toBe(false);
  });

  it('génère un prédicat SQL qui protège liste, comptes et détail public', () => {
    const sql = publicCatalogVisibilitySql('p');
    expect(sql).toContain('p.is_active = TRUE');
    expect(sql).toContain("p.product_ref NOT LIKE 'SHOWCASE-V2-%'");
    expect(sql).toContain("NULLIF(BTRIM(p.image_url), '') IS NOT NULL");
    expect(sql).toContain("p.image_url NOT ILIKE 'data:image/%'");
  });

  it('refuse un alias SQL non sûr', () => {
    expect(() => publicCatalogVisibilitySql('p; DROP TABLE products')).toThrow('Alias SQL catalogue invalide');
  });
});

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
