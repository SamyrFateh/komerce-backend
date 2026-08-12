'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const { TAXONOMY_TARGETS } = require('../../scripts/showcase-v2-plan');
const {
  DESCRIPTION_MAX_LENGTH,
  FALLBACK_QUERIES,
  PRODUCT_TERMS,
  segmentKey,
  queriesForTarget,
  productIdentityFor,
  isProductLike,
  boundedDescription,
  absoluteExclusionFor,
  decorate,
} = require('../../scripts/showcase-v2-source-build');

describe('showcase-v2-source-build query resilience', () => {
  test('chaque sous-catégorie possède une réserve de requêtes métier', () => {
    for (const target of TAXONOMY_TARGETS) {
      const key = segmentKey(target);
      expect(FALLBACK_QUERIES[key]).toBeDefined();
      expect(FALLBACK_QUERIES[key].length).toBeGreaterThanOrEqual(4);
    }
  });

  test('chaque sous-catégorie exige une identité produit explicite', () => {
    for (const target of TAXONOMY_TARGETS) {
      const key = segmentKey(target);
      expect(PRODUCT_TERMS[key]).toBeDefined();
      expect(PRODUCT_TERMS[key].length).toBeGreaterThanOrEqual(4);
    }
  });

  test('les requêtes primaires restent prioritaires et les doublons sont supprimés', () => {
    const target = TAXONOMY_TARGETS[0];
    const queries = queriesForTarget(target);
    expect(queries.slice(0, target.queries.length)).toEqual(target.queries);
    expect(new Set(queries.map((query) => query.toLowerCase())).size).toBe(queries.length);
    expect(queries.length).toBeGreaterThan(target.queries.length);
  });

  test('la campagne couvre toujours 21 segments avec plusieurs portes de sourcing', () => {
    expect(TAXONOMY_TARGETS).toHaveLength(21);
    for (const target of TAXONOMY_TARGETS) {
      expect(queriesForTarget(target).length).toBeGreaterThanOrEqual(6);
    }
  });

  test('refuse une photo de personnes dont le titre ne nomme aucun produit', () => {
    const target = { category: 'Mode & Beauté', subcategory: 'Homme' };
    const row = {
      name: 'Three men sitting outside a studio',
      source_description: 'The people are wearing fashionable shirts and jackets.',
    };
    expect(productIdentityFor(row, target)).toMatchObject({
      ok: false,
      reason: 'missing-product-term',
    });
    expect(isProductLike(row, target)).toBe(false);
  });

  test('refuse une scène éditoriale même si le titre contient un vêtement', () => {
    const target = { category: 'Mode & Beauté', subcategory: 'Femme' };
    const row = {
      name: 'Red dress at Fashion Week',
      source_description: 'Model wearing a red dress on the runway.',
    };
    expect(productIdentityFor(row, target)).toMatchObject({
      ok: false,
      reason: 'editorial-media',
      term: 'dress',
    });
  });

  test('accepte un média dont le titre identifie clairement le produit', () => {
    const target = { category: 'Mode & Beauté', subcategory: 'Femme' };
    const row = {
      name: 'Red cocktail dress isolated on white background',
      source_description: 'Studio product photograph.',
    };
    expect(productIdentityFor(row, target)).toMatchObject({
      ok: true,
      term: 'dress',
    });
    expect(isProductLike(row, target)).toBe(true);
  });

  test('borne la description normalisée sans perdre le texte source brut', () => {
    const sourceDescription = 'x'.repeat(DESCRIPTION_MAX_LENGTH + 2500);
    const row = {
      source: 'commons:oversized',
      name: 'Car headlight product',
      source_description: sourceDescription,
    };
    const slot = {
      product_ref: 'SHOWCASE-V2-0001',
      category: 'Auto',
      subcategory: 'Éclairage',
      globalIndex: 0,
      rich: true,
    };

    expect(boundedDescription(row)).toHaveLength(DESCRIPTION_MAX_LENGTH);
    const product = decorate(row, slot);
    expect(product.description).toHaveLength(DESCRIPTION_MAX_LENGTH);
    expect(product.source_description).toBe(sourceDescription);
    expect(product.showcase_v2.product_identity_term).toBe('headlight');
  });

  test('écarte avant miroir une exclusion absolue mais conserve une restriction transport', () => {
    const target = { category: 'Auto', subcategory: 'Freinage' };
    const absolute = [{
      layer: 'absolute',
      label: 'Armes',
      keywords: ['rifle'],
      categories: [],
    }];
    const restricted = [{
      layer: 'restricted',
      label: 'Batteries lithium',
      keywords: ['battery pack'],
      categories: [],
    }];

    expect(absoluteExclusionFor({
      name: 'M107 sniper rifle',
      source_description: 'Commercial weapon system',
    }, target, absolute)).toMatchObject({ layer: 'absolute', label: 'Armes' });

    expect(absoluteExclusionFor({
      name: 'Battery pack accessory',
      source_description: 'Lithium transport constraint',
    }, target, restricted)).toBeNull();
  });
});
