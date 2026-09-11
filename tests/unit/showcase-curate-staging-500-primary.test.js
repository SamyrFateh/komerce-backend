'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const {
  DUMMY_URL,
  PLATZI_URL,
  FAKESTORE_URL,
  MAKEUP_BASE_URL,
  OPEN_FOOD_BASE_URL,
  OPEN_FOOD_LIMIT,
  MAKEUP_LIMIT,
  httpsUrl,
  openFoodUrl,
  makeupUrl,
  mapFakeStoreProduct,
  mapOpenFoodProduct,
  mapMakeupProduct,
  dedupePool,
  collectPrimaryPool,
} = require('../../scripts/showcase-curate-staging-500-primary');

describe('showcase-curate-staging-500-primary', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test('normalise uniquement des URLs image exploitables en HTTPS', () => {
    expect(httpsUrl('//cdn.test/p.jpg')).toBe('https://cdn.test/p.jpg');
    expect(httpsUrl('http://cdn.test/p.jpg')).toBe('https://cdn.test/p.jpg');
    expect(httpsUrl('https://cdn.test/p.jpg')).toBe('https://cdn.test/p.jpg');
    expect(httpsUrl('data:image/png;base64,abc')).toBeNull();
  });

  test('borne les deux sources volumineuses avec suffisamment de réserve pour 500 produits', () => {
    expect(OPEN_FOOD_LIMIT).toBe(220);
    expect(MAKEUP_LIMIT).toBe(240);
    expect(openFoodUrl('Snacks', 100)).toContain('page_size=100');
    expect(openFoodUrl('Snacks', 100)).toContain('fields=');
    expect(makeupUrl('lipstick')).toContain('product_type=lipstick');
  });

  test('mappe Fake Store vers les catégories Komerce autorisées', () => {
    expect(mapFakeStoreProduct({
      id: 7,
      title: 'Portable SSD',
      description: 'Fast portable storage.',
      category: 'electronics',
      price: 49.99,
      image: 'https://cdn.test/ssd.jpg',
    })).toMatchObject({
      category: 'Tech',
      subcategory: 'Accessoires',
      source: 'fakestore:7',
      image_url: 'https://cdn.test/ssd.jpg',
    });
    expect(mapFakeStoreProduct({ id: 8, title: 'Unknown', category: 'books', image: 'https://cdn.test/book.jpg' })).toBeNull();
  });

  test('mappe Open Food Facts en épicerie avec identité source et image frontale', () => {
    const mapped = mapOpenFoodProduct({
      code: '3017620422003',
      product_name: 'Pâte à tartiner noisettes',
      brands: 'Example',
      image_front_url: 'https://images.openfoodfacts.org/example.jpg',
    });
    expect(mapped).toMatchObject({
      category: 'Maison',
      subcategory: 'Épicerie',
      source: 'openfoodfacts:3017620422003',
      image_url: 'https://images.openfoodfacts.org/example.jpg',
    });
    expect(mapped.price_kmf).toBeGreaterThan(0);
  });

  test('mappe Makeup API avec image featured et sous-catégorie lisible', () => {
    const mapped = mapMakeupProduct({
      id: 23,
      brand: 'Maybelline',
      name: 'Great Lash Mascara',
      price: '7.79',
      product_type: 'mascara',
      api_featured_image: '//s3.amazonaws.com/products/mascara.jpg',
      image_link: 'https://cdn.test/small.jpg',
      description: 'Mascara.',
    });
    expect(mapped).toMatchObject({
      category: 'Beauté',
      subcategory: 'Yeux',
      source: 'makeup:23',
      image_url: 'https://s3.amazonaws.com/products/mascara.jpg',
    });
    expect(mapped.price_kmf).toBeGreaterThan(0);
  });

  test('déduplique à la fois source et hero entre fournisseurs', () => {
    expect(dedupePool([
      { source: 'a:1', image_url: 'https://img.test/1.jpg' },
      { source: 'a:1', image_url: 'https://img.test/2.jpg' },
      { source: 'b:1', image_url: 'https://img.test/1.jpg' },
      { source: 'b:2', image_url: 'https://img.test/3.jpg' },
    ])).toEqual([
      { source: 'a:1', image_url: 'https://img.test/1.jpg' },
      { source: 'b:2', image_url: 'https://img.test/3.jpg' },
    ]);
  });

  test('agrège les sources produit sans jamais appeler Wikimedia', async () => {
    global.fetch = jest.fn(async (url) => {
      const href = String(url);
      if (href === DUMMY_URL) {
        return {
          ok: true,
          json: async () => ({ products: [{
            id: 1,
            title: 'Beauty Cream',
            description: 'A useful beauty cream for everyday care and testing.',
            category: 'beauty',
            price: 15,
            discountPercentage: 10,
            thumbnail: 'https://cdn.example.test/dummy-1.jpg',
            images: ['https://cdn.example.test/dummy-1.jpg'],
          }] }),
        };
      }
      if (href === PLATZI_URL) {
        return {
          ok: true,
          json: async () => [{
            id: 2,
            title: 'Wireless Speaker',
            description: 'An electronics item for a realistic staging catalogue.',
            price: 40,
            category: { name: 'Electronics' },
            images: ['https://cdn.example.test/platzi-2.jpg'],
          }],
        };
      }
      if (href === FAKESTORE_URL) {
        return { ok: true, json: async () => [] };
      }
      if (href.startsWith(OPEN_FOOD_BASE_URL)) {
        return { ok: true, json: async () => ({ products: [] }) };
      }
      if (href.startsWith(MAKEUP_BASE_URL)) {
        return { ok: true, json: async () => [] };
      }
      throw new Error(`source inattendue: ${href}`);
    });

    const pool = await collectPrimaryPool();
    expect(pool.map((row) => row.source)).toEqual(['dummyjson:1', 'platzi:2']);
    expect(global.fetch.mock.calls.some(([url]) => String(url).includes('wikimedia'))).toBe(false);
    expect(global.fetch.mock.calls.some(([url]) => String(url).startsWith(OPEN_FOOD_BASE_URL))).toBe(true);
    expect(global.fetch.mock.calls.some(([url]) => String(url).startsWith(MAKEUP_BASE_URL))).toBe(true);
  });
});