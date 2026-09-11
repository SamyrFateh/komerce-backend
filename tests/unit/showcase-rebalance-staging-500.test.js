'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const {
  FLOOR,
  NUCLEUS,
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
});
