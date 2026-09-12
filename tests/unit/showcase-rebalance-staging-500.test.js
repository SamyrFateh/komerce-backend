'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const {
  FLOOR,
  NUCLEUS,
  reusableLicense,
  sportCategoryPage,
  fetchSportCategory,
  counts,
  donorIndex,
  applyFloor,
} = require('../../scripts/showcase-rebalance-staging-500');

function product(index, category) {
  return {
    product_ref: `KPR-${String(990001 + index).padStart(6, '0')}`,
    name: `Produit ${index}`,
    description: 'Description française suffisamment longue pour le catalogue de test Komerce.',
    category,
    subcategory: 'Test',
    price_kmf: 5000,
    stock: 20,
    image_url: `https://img.test/${index}.jpg`,
    images: [`https://img.test/${index}.jpg`],
    source: `test:${index}`,
    curated: true,
    sort_order: index,
  };
}

function candidate(index, category) {
  return {
    name: `Candidat ${index}`,
    description: 'Candidat de couverture catégorie pour un scénario réaliste de boutique.',
    category,
    subcategory: category === 'Enfant' ? 'Jouets' : 'Fitness',
    price_kmf: 7000,
    image_url: `https://candidate.test/${index}.jpg`,
    images: [`https://candidate.test/${index}.jpg`],
    source: `candidate:${index}`,
  };
}

function commonsPage(overrides = {}) {
  return {
    pageid: 42,
    title: 'File:Dumbbell product photo.jpg',
    imageinfo: [{
      mime: 'image/jpeg',
      width: 1200,
      height: 1000,
      url: 'https://upload.wikimedia.org/dumbbell.jpg',
      descriptionurl: 'https://commons.wikimedia.org/wiki/File:Dumbbell_product_photo.jpg',
      extmetadata: {
        LicenseShortName: { value: 'CC BY-SA 4.0' },
        Artist: { value: 'Example' },
        ImageDescription: { value: 'Dumbbell on a neutral background.' },
      },
    }],
    ...overrides,
  };
}

describe('showcase-rebalance-staging-500', () => {
  test('verrouille un plancher de couverture adapté aux rails boutique', () => {
    expect(FLOOR).toBe(24);
    expect(NUCLEUS).toBe(40);
  });

  test('ne prélève jamais dans le noyau curaté protégé', () => {
    const products = [];
    for (let i = 0; i < 40; i += 1) products.push(product(i, 'Maison'));
    for (let i = 40; i < 60; i += 1) products.push(product(i, 'Maison'));
    const totals = counts(products);
    expect(donorIndex(products, totals, 24)).toBeGreaterThanOrEqual(40);
  });

  test('remplace les surplus sans changer le volume ni les références de position', () => {
    const products = [];
    for (let i = 0; i < 40; i += 1) products.push(product(i, 'Mode'));
    for (let i = 40; i < 460; i += 1) products.push(product(i, 'Maison'));
    for (let i = 460; i < 480; i += 1) products.push(product(i, 'Sport'));
    for (let i = 480; i < 500; i += 1) products.push(product(i, 'Enfant'));

    const beforeRefs = products.map((row) => row.product_ref);
    const result = applyFloor(products, {
      Sport: Array.from({ length: 10 }, (_, index) => candidate(1000 + index, 'Sport')),
      Enfant: Array.from({ length: 10 }, (_, index) => candidate(2000 + index, 'Enfant')),
    }, 24);

    expect(result.products).toHaveLength(500);
    expect(result.after.Sport).toBeGreaterThanOrEqual(24);
    expect(result.after.Enfant).toBeGreaterThanOrEqual(24);
    expect(result.replacements).toBe(8);
    expect(result.products.map((row) => row.product_ref)).toEqual(beforeRefs);
    expect(result.products.slice(0, 40).map((row) => row.source)).toEqual(products.slice(0, 40).map((row) => row.source));
    expect(new Set(result.products.map((row) => row.image_url)).size).toBe(500);
    expect(result.products.every((row) => Number(row.stock) > 0)).toBe(true);
  });

  test('accepte les licences réutilisables et rejette NC/ND', () => {
    expect(reusableLicense('CC BY-SA 4.0')).toBe(true);
    expect(reusableLicense('Public domain')).toBe(true);
    expect(reusableLicense('CC BY-NC 4.0')).toBe(false);
    expect(reusableLicense('CC BY-ND 4.0')).toBe(false);
  });

  test('mappe uniquement une photo équipement sport exploitable', () => {
    expect(sportCategoryPage(commonsPage(), 'Sports gear with transparent background', 'Fitness')).toMatchObject({
      category: 'Sport',
      subcategory: 'Fitness',
      source: 'commons:42',
      image_url: 'https://upload.wikimedia.org/dumbbell.jpg',
    });
    expect(sportCategoryPage(commonsPage({ title: 'File:Football team players.jpg' }), 'Sports gear with transparent background', 'Fitness')).toBeNull();
  });

  test('lit une catégorie Commons comme fallback sans inventer de produit', async () => {
    const fetchFn = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ query: { pages: [commonsPage()] } }),
    }));
    const rows = await fetchSportCategory('Sports gear with transparent background', 'Fitness', 50, fetchFn);
    expect(rows).toHaveLength(1);
    expect(rows[0].source).toBe('commons:42');
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});
