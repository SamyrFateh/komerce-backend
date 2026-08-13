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
  identityQueriesForTarget,
  queriesForTarget,
  productIdentityFor,
  isProductLike,
  boundedDescription,
  absoluteExclusionFor,
  decorate,
  cleanSourceTitle,
  localizeV2Title,
  isRetryableHttpStatus,
  retryDelayMs,
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
      expect(identityQueriesForTarget(target).length).toBeGreaterThanOrEqual(4);
    }
  });

  test('les requêtes intitle sont prioritaires et les requêtes métier restent disponibles sans doublon', () => {
    const target = TAXONOMY_TARGETS[0];
    const identityQueries = identityQueriesForTarget(target);
    const queries = queriesForTarget(target);
    expect(queries.slice(0, identityQueries.length)).toEqual(identityQueries);
    for (const query of target.queries) expect(queries).toContain(query);
    expect(new Set(queries.map((query) => query.toLowerCase())).size).toBe(queries.length);
  });

  test('rejoue les erreurs HTTP transitoires Wikimedia sans masquer les erreurs client permanentes', () => {
    for (const status of [429, 500, 502, 503, 504]) {
      expect(isRetryableHttpStatus(status)).toBe(true);
    }
    for (const status of [400, 401, 403, 404, 422]) {
      expect(isRetryableHttpStatus(status)).toBe(false);
    }
  });

  test('respecte Retry-After puis le backoff exponentiel borné', () => {
    expect(retryDelayMs({ headers: { get: () => '2' } }, 0)).toBe(2000);
    expect(retryDelayMs({ headers: { get: () => null } }, 3)).toBe(8000);
    expect(retryDelayMs({ headers: { get: () => null } }, 9)).toBe(15000);
  });

  test('la preuve produit se fait sur le titre source avant traduction française', () => {
    const target = { category: 'Mode & Beauté', subcategory: 'Femme' };
    const row = {
      source_title: cleanSourceTitle('File:Red_dress_product.jpg'),
      name: localizeV2Title('File:Red_dress_product.jpg'),
      source_description: 'Studio photograph of a red dress on a neutral background.',
    };
    expect(row.source_title).toContain('dress');
    expect(row.name.toLowerCase()).toContain('robe');
    expect(productIdentityFor(row, target)).toMatchObject({ ok: true, term: 'dress', term_source: 'title' });
  });

  test('refuse une photo de personnes si le vêtement n’existe que dans la description', () => {
    const target = { category: 'Mode & Beauté', subcategory: 'Homme' };
    const row = {
      source_title: 'Three men outside a studio',
      name: 'Trois hommes devant un studio',
      source_description: 'Men wearing fashionable shirts and jackets for a group photo.',
    };
    expect(productIdentityFor(row, target)).toMatchObject({ ok: false, reason: 'product-term-description-only' });
    expect(isProductLike(row, target)).toBe(false);
  });

  test('refuse une scène humaine même si le titre contient un produit', () => {
    const target = { category: 'Mode & Beauté', subcategory: 'Femme' };
    const row = {
      source_title: 'Summer dress collection',
      name: 'Collection robe été',
      source_description: 'Woman wearing a summer dress outdoors.',
    };
    expect(productIdentityFor(row, target)).toMatchObject({ ok: false, reason: 'human-media', term: 'dress' });
  });

  test('refuse une identité produit portée uniquement par la description', () => {
    const target = { category: 'Mode & Beauté', subcategory: 'Femme' };
    const row = {
      source_title: 'Object 1842 17',
      name: 'Objet 1842 17',
      source_description: 'Red silk dress photographed flat on a neutral background.',
    };
    expect(productIdentityFor(row, target)).toMatchObject({
      ok: false,
      reason: 'product-term-description-only',
      term: 'dress',
      term_source: 'description',
    });
  });

  test('régression Mina : dress rehearsal ne peut jamais devenir une robe catalogue', () => {
    const target = { category: 'Mode & Beauté', subcategory: 'Femme' };
    const row = {
      source_title: 'Mina Mazzini 1961',
      name: 'Mina Mazzini 1961',
      source_description: 'Italian singer Mina getting ready in the dressing room before the dress rehearsal of a TV broadcast.',
    };
    expect(productIdentityFor(row, target)).toMatchObject({
      ok: false,
      reason: 'product-term-description-only',
      term: 'dress',
      term_source: 'description',
    });
  });

  test('refuse une scène d’usage humaine hors habillement', () => {
    const target = { category: 'Tech', subcategory: 'Phones' };
    const row = {
      source_title: 'Using Mobile Phone',
      name: 'Using Mobile Phone',
      source_description: 'Man holding a mobile phone while calling outdoors.',
    };
    expect(productIdentityFor(row, target)).toMatchObject({ ok: false, reason: 'human-media', term_source: 'title' });
  });

  test('la description boutique est française et la source brute reste séparée', () => {
    const sourceDescription = 'English source description that must remain untouched.';
    const row = {
      source: 'commons:french-presentation',
      source_title: 'Car headlight product',
      name: 'Phare automobile',
      source_description: sourceDescription,
    };
    const slot = {
      product_ref: 'SHOWCASE-V2-0001',
      category: 'Auto',
      subcategory: 'Éclairage',
      globalIndex: 0,
      rich: true,
    };
    const description = boundedDescription(row, slot);
    expect(description).toContain('Article de démonstration classé Auto · Éclairage');
    expect(description.length).toBeLessThanOrEqual(DESCRIPTION_MAX_LENGTH);
    const product = decorate(row, slot);
    expect(product.description).toBe(description);
    expect(product.source_description).toBe(sourceDescription);
    expect(product.showcase_v2.product_identity_term).toBe('headlight');
    expect(product.showcase_v2.product_identity_source).toBe('title');
  });

  test('écarte avant miroir une exclusion absolue mais conserve une restriction transport', () => {
    const target = { category: 'Auto', subcategory: 'Freinage' };
    const absolute = [{ layer: 'absolute', label: 'Armes', keywords: ['rifle'], categories: [] }];
    const restricted = [{ layer: 'restricted', label: 'Batteries lithium', keywords: ['battery pack'], categories: [] }];

    expect(absoluteExclusionFor({
      source_title: 'M107 sniper rifle',
      name: 'M107 sniper rifle',
      source_description: 'Commercial weapon system',
    }, target, absolute)).toMatchObject({ layer: 'absolute', label: 'Armes' });

    expect(absoluteExclusionFor({
      source_title: 'Battery pack accessory',
      name: 'Battery pack accessory',
      source_description: 'Lithium transport constraint',
    }, target, restricted)).toBeNull();
  });
});
