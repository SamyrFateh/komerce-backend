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
 * Verrouille les invariants DOCTRINE_CATALOGUE.md :
 * - la boutique ne lit jamais les champs de cuisine ;
 * - les fixtures SHOWCASE-V2 et médias inline synthétiques ne rejoignent jamais
 *   la Boutique réelle ;
 * - le catalogue distant reste un catalogue maître global, jamais dupliqué par
 *   market_id. Le marché est une projection/navigation, pas une propriété produit.
 */

const fs = require('fs');
const path = require('path');
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

const ROOT = path.join(__dirname, '..', '..');

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

describe('catalogue distant unique + projection marché', () => {
  const productsRoute = fs.readFileSync(path.join(ROOT, 'routes', 'products.js'), 'utf8');
  const marketContext = fs.readFileSync(path.join(ROOT, 'public', 'boutique', 'js', 'market-context.js'), 'utf8');
  const doctrine = fs.readFileSync(path.join(ROOT, 'docs', 'doctrine', 'DOCTRINE_CATALOGUE.md'), 'utf8');

  it('la lecture catalogue distante reste ancrée sur products sans ownership market', () => {
    expect(productsRoute).toContain('FROM products p');
    expect(productsRoute).not.toMatch(/\bp\.market_id\b/i);
    expect(productsRoute).not.toMatch(/\bJOIN\s+product_market\b/i);
    expect(productsRoute).not.toMatch(/\bFROM\s+product_market\b/i);
  });

  it('MarketContext reste une projection de navigation non autorisante', () => {
    expect(marketContext).toContain('MarketContext = navigation');
    expect(marketContext).toContain('NON autorisant');
    expect(marketContext).not.toMatch(/\brequire\s*\(/);
    expect(marketContext).not.toMatch(/\bauthenticate\b|\brequireRole\b/);
  });

  it('la doctrine interdit explicitement de dupliquer le catalogue distant par marché', () => {
    expect(doctrine).toContain('un seul catalogue distant canonique');
    expect(doctrine).toContain('products.market_id` est interdit');
    expect(doctrine).toContain('une table de type `product_market` qui dupliquerait la fiche produit par pays est interdite');
    expect(doctrine).toContain('le catalogue distant reste global et simplement projeté selon le marché');
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
