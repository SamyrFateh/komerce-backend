'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const {
  parseArgs,
  roundKmf,
  isCloudinaryUrl,
  isCanonicalCloudinaryUpload,
  isCloudinaryFetchProxy,
  normalizeImages,
  normalizeSeedProduct,
  localizeTitle,
  mapDummyProduct,
  cloudinarySignature,
  staticAudit,
} = require('../../scripts/showcase-catalog');

describe('showcase-catalog', () => {
  test('parseArgs vise 500 produits par défaut et autorise 1000', () => {
    const defaults = parseArgs(['prepare']);
    expect(defaults.command).toBe('prepare');
    expect(defaults.target).toBe(500);

    const max = parseArgs(['prepare', '--target', '1000']);
    expect(max.target).toBe(1000);
  });

  test('parseArgs refuse une cible hors borne', () => {
    expect(() => parseArgs(['prepare', '--target', '0'])).toThrow(/entre 1 et 1000/);
    expect(() => parseArgs(['prepare', '--target', '1001'])).toThrow(/entre 1 et 1000/);
  });

  test('Cloudinary upload canonique et fetch proxy sont distingués', () => {
    const upload = 'https://res.cloudinary.com/demo/image/upload/v1/komerce/product.jpg';
    const proxy = 'https://res.cloudinary.com/demo/image/fetch/w_400/https://example.com/product.jpg';

    expect(isCloudinaryUrl(upload)).toBe(true);
    expect(isCanonicalCloudinaryUpload(upload)).toBe(true);
    expect(isCloudinaryFetchProxy(upload)).toBe(false);

    expect(isCloudinaryUrl(proxy)).toBe(true);
    expect(isCanonicalCloudinaryUpload(proxy)).toBe(false);
    expect(isCloudinaryFetchProxy(proxy)).toBe(true);
  });

  test('normalizeImages déduplique hero + galerie', () => {
    const hero = 'https://res.cloudinary.com/demo/image/upload/a.jpg';
    const second = 'https://res.cloudinary.com/demo/image/upload/b.jpg';
    expect(normalizeImages({ image_url: hero, images: [hero, second, second] })).toEqual([hero, second]);
  });

  test('normalizeSeedProduct produit une référence stable et une description française', () => {
    const hero = 'https://res.cloudinary.com/demo/image/upload/a.jpg';
    const product = normalizeSeedProduct({
      name: 'Produit test',
      description: 'English source',
      description_fr: 'Description française',
      category: 'Maison',
      subcategory: 'Cuisine',
      price_kmf: 4123,
      promo_pct: 12,
      image_url: hero,
    }, 7);

    expect(product.product_ref).toBe('SHOWCASE-V1-0008');
    expect(product.description).toBe('Description française');
    expect(product.price_kmf).toBe(4000);
    expect(product.images).toEqual([hero]);
  });

  test('localizeTitle traduit les principaux noms de rayon sans inventer le produit', () => {
    expect(localizeTitle('Classic Red Dress and Shoes')).toBe('Classic Red robe and chaussures');
    expect(localizeTitle('Luxury Perfume')).toBe('Luxury parfum');
  });

  test('mapDummyProduct ne retient que les catégories mappées Komerce', () => {
    const mapped = mapDummyProduct({
      id: 12,
      title: 'Summer Dress',
      description: 'Light summer dress',
      category: 'womens-dresses',
      price: 20,
      discountPercentage: 10.4,
      thumbnail: 'https://example.com/a.jpg',
      images: ['https://example.com/b.jpg'],
    }, 0);

    expect(mapped.category).toBe('Mode');
    expect(mapped.subcategory).toBe('Robes');
    expect(mapped.price_kmf).toBe(10000);
    expect(mapped.promo_pct).toBe(10);
    expect(mapDummyProduct({ category: 'automotive' }, 0)).toBeNull();
  });

  test('audit strict peut détecter hero absent, URL externe et proxy fetch', () => {
    const canonical = 'https://res.cloudinary.com/demo/image/upload/v1/a.jpg';
    const proxy = 'https://res.cloudinary.com/demo/image/fetch/w_400/https://example.com/b.jpg';
    const report = staticAudit([
      { product_ref: 'A', image_url: canonical, images: [canonical] },
      { product_ref: 'B', image_url: proxy, images: [proxy] },
      { product_ref: 'C', image_url: 'https://example.com/c.jpg', images: [] },
      { product_ref: 'D', image_url: null, images: [] },
    ], 5);

    expect(report.totalProducts).toBe(4);
    expect(report.fetchProxy).toHaveLength(1);
    expect(report.nonCloudinary).toHaveLength(1);
    expect(report.missingHero).toHaveLength(1);
    expect(report.targetShortfall).toBe(1);
  });

  test('signature Cloudinary est déterministe indépendamment de l’ordre des clés', () => {
    const a = cloudinarySignature({ timestamp: 10, public_id: 'hero', folder: 'komerce/x' }, 'secret');
    const b = cloudinarySignature({ folder: 'komerce/x', public_id: 'hero', timestamp: 10 }, 'secret');
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{40}$/);
  });

  test('roundKmf garde un plancher boutique de 500 KMF', () => {
    expect(roundKmf(1)).toBe(500);
    expect(roundKmf(4123)).toBe(4000);
    expect(roundKmf(4301)).toBe(4500);
  });
});
