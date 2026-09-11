'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const path = require('path');
const {
  DEFAULT_CURATED_INPUT,
  parseArgs,
  resolveTarget,
  assertCuratedSource,
  roundKmf,
  isCloudinaryUrl,
  isCanonicalCloudinaryUpload,
  isCloudinaryFetchProxy,
  normalizeImages,
  localizeTitle,
  mapDummyProduct,
  cloudinarySignature,
  staticAudit,
} = require('../../scripts/showcase-catalog');

function curatedProduct(overrides = {}) {
  return {
    product_ref: 'KPR-990001',
    name: 'Palette de fards avec miroir',
    description: 'Palette compacte avec miroir intégré et plusieurs teintes pour varier les maquillages du quotidien.',
    category: 'Beauté',
    subcategory: 'Maquillage',
    price_kmf: 9500,
    stock: 32,
    image_url: 'https://cdn.example.com/palette.webp',
    images: ['https://cdn.example.com/palette.webp'],
    source: 'dummyjson:2',
    curated: true,
    ...overrides,
  };
}

describe('showcase-catalog', () => {
  test('source vise 500 candidats par défaut, prepare consomme tout le catalogue curaté', () => {
    const source = parseArgs(['source']);
    expect(source.command).toBe('source');
    expect(source.target).toBe(500);

    const prepare = parseArgs(['prepare']);
    expect(prepare.command).toBe('prepare');
    expect(prepare.target).toBeNull();
    expect(prepare.input).toBe(DEFAULT_CURATED_INPUT);
    expect(path.basename(prepare.input)).toBe('staging-market-catalog-curated-v1.json');
  });

  test('parseArgs autorise une cible explicite jusqu’à 1000 et refuse les bornes invalides', () => {
    expect(parseArgs(['prepare', '--target', '40']).target).toBe(40);
    expect(parseArgs(['source', '--target', '1000']).target).toBe(1000);
    expect(() => parseArgs(['prepare', '--target', '0'])).toThrow(/entre 1 et 1000/);
    expect(() => parseArgs(['prepare', '--target', '1001'])).toThrow(/entre 1 et 1000/);
  });

  test('le vieux db/seed-products-v2.json est explicitement interdit comme input', () => {
    expect(() => parseArgs(['prepare', '--input', 'db/seed-products-v2.json']))
      .toThrow(/Entrée legacy interdite/);
    expect(() => parseArgs(['audit', '--input=db/seed-products-v2.json']))
      .toThrow(/Entrée legacy interdite/);
  });

  test('resolveTarget prend tout le manifeste par défaut et fail-closed si cible trop grande', () => {
    const products = [curatedProduct(), curatedProduct({ product_ref: 'KPR-990002', image_url: 'https://cdn.example.com/b.webp' })];
    expect(resolveTarget(products, null)).toBe(2);
    expect(resolveTarget(products, 1)).toBe(1);
    expect(() => resolveTarget(products, 3)).toThrow(/sous cible/);
  });

  test('quality gate accepte une fiche réellement curatée', () => {
    expect(assertCuratedSource([curatedProduct()])).toEqual({ products: 1, refs: 1, heroes: 1 });
  });

  test('quality gate refuse produit générique, description brute, ref non canonique et absence de curation', () => {
    expect(() => assertCuratedSource([curatedProduct({
      product_ref: 'SHOWCASE-V1-0001',
      name: 'Produit 1',
      description: 'Raw test product: Some Item',
      curated: false,
    })])).toThrow(/Catalogue curaté invalide/);
  });

  test('quality gate refuse deux produits qui réutilisent la même image hero', () => {
    const hero = 'https://cdn.example.com/shared.webp';
    expect(() => assertCuratedSource([
      curatedProduct({ product_ref: 'KPR-990001', image_url: hero }),
      curatedProduct({ product_ref: 'KPR-990002', name: 'Rouge à lèvres mat', image_url: hero }),
    ])).toThrow(/image hero dupliquée/);
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

  test('localizeTitle reste un outil de pool candidat et ne prétend pas faire une vraie curation', () => {
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