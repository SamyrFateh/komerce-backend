'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const {
  DEFAULT_TARGET,
  MIN_STOCK,
  MAX_STOCK,
  parseArgs,
  polishName,
  curateCandidate,
  balancedSelection,
  summarize,
} = require('../../scripts/showcase-curate-staging-500');

function candidate(index, category) {
  return {
    name: `Wireless headphones black ${index}`,
    description: 'Raw candidate description in English for test purposes only.',
    category,
    subcategory: 'Test',
    price_kmf: 12345,
    promo_pct: null,
    image_url: `https://example.com/${category}-${index}.jpg`,
    images: [`https://example.com/${category}-${index}.jpg`],
    source: `fixture:${category}:${index}`,
    source_url: `https://example.com/source/${index}`,
  };
}

describe('showcase-curate-staging-500', () => {
  test('cible 500 par défaut et borne la CLI', () => {
    expect(parseArgs([]).target).toBe(DEFAULT_TARGET);
    expect(parseArgs(['--target', '500', '--network', '--concurrency', '16'])).toMatchObject({
      target: 500,
      network: true,
      concurrency: 16,
    });
    expect(() => parseArgs(['--target', '751'])).toThrow(/entre 40 et 750/);
  });

  test('nettoie les termes fréquents pour un affichage français', () => {
    expect(polishName("Women's Wireless Headphones Black")).toMatch(/Femme/i);
    expect(polishName("Women's Wireless Headphones Black")).toMatch(/sans fil/i);
    expect(polishName("Women's Wireless Headphones Black")).toMatch(/casque audio/i);
    expect(polishName("Women's Wireless Headphones Black")).toMatch(/noir/i);
  });

  test('curation produit = ref stable, stock positif, image hero unique', () => {
    const product = curateCandidate(candidate(1, 'Tech'), 40);
    expect(product.product_ref).toBe('KPR-990041');
    expect(product.curated).toBe(true);
    expect(product.stock).toBeGreaterThanOrEqual(MIN_STOCK);
    expect(product.stock).toBeLessThanOrEqual(MAX_STOCK);
    expect(product.images).toEqual([product.image_url]);
    expect(product.price_kmf % 500).toBe(0);
  });

  test('sélection équilibrée fait tourner les catégories tant qu’elles ont du stock candidat', () => {
    const pool = [
      candidate(1, 'Mode'), candidate(2, 'Mode'), candidate(3, 'Mode'),
      candidate(4, 'Maison'), candidate(5, 'Maison'),
      candidate(6, 'Tech'), candidate(7, 'Tech'),
      candidate(8, 'Beauté'), candidate(9, 'Sport'), candidate(10, 'Enfant'),
    ];
    const selected = balancedSelection(pool, 6);
    expect(selected.map((row) => row.category)).toEqual(['Mode', 'Maison', 'Tech', 'Beauté', 'Sport', 'Enfant']);
  });

  test('résumé détecte les ruptures et compte les unités de stock', () => {
    const rows = [
      { ...candidate(1, 'Tech'), stock: 12 },
      { ...candidate(2, 'Maison'), stock: 20 },
      { ...candidate(3, 'Mode'), stock: 0 },
    ];
    const summary = summarize(rows);
    expect(summary.products).toBe(3);
    expect(summary.stock_units).toBe(32);
    expect(summary.out_of_stock).toBe(1);
    expect(summary.unique_heroes).toBe(3);
  });
});
