/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
'use strict';

const {
  BULK_CONFIRMATION,
  parseArgs,
  selectPilotProducts,
  selectTargets,
  buildImagePrompt,
  imageKitTarget,
  showcaseNamespacePurgeUrl,
  mapWithConcurrency,
} = require('../../scripts/showcase-v2-media-realism');
const { buildCatalogue } = require('../../scripts/showcase-v2-source-build');

describe('showcase-v2-media-realism', () => {
  test('le pilote couvre exactement les 21 sous-catégories une seule fois', () => {
    const products = buildCatalogue();
    const pilot = selectPilotProducts(products);
    expect(pilot).toHaveLength(21);
    expect(new Set(pilot.map((p) => `${p.category}/${p.subcategory}`)).size).toBe(21);
    expect(pilot.every((p) => /^SHOWCASE-V2-\d{4}$/.test(p.product_ref))).toBe(true);
  });

  test('le plan par défaut est pilot, medium, sans effet réseau', () => {
    expect(parseArgs([])).toMatchObject({
      apply: false,
      scope: 'pilot',
      refs: [],
      model: 'gpt-image-2',
      quality: 'medium',
      size: '1024x1024',
      concurrency: 2,
    });
  });

  test('un apply bulk exige une confirmation explicite', () => {
    const products = buildCatalogue();
    const unsafe = parseArgs(['--apply', '--scope=all']);
    expect(() => selectTargets(products, unsafe)).toThrow(/Garde bulk/);

    const safe = parseArgs(['--apply', '--scope=all', `--confirm-all=${BULK_CONFIRMATION}`]);
    expect(selectTargets(products, safe)).toHaveLength(500);
  });

  test('une liste ciblée courte ne demande pas le garde bulk', () => {
    const products = buildCatalogue();
    const options = parseArgs(['--apply', '--refs=SHOWCASE-V2-0001,SHOWCASE-V2-0131']);
    expect(selectTargets(products, options).map((p) => p.product_ref)).toEqual([
      'SHOWCASE-V2-0001',
      'SHOWCASE-V2-0131',
    ]);
  });

  test('le prompt impose une photo produit sans marque, texte ni personne', () => {
    const product = buildCatalogue()[0];
    const prompt = buildImagePrompt(product);
    expect(prompt).toContain('photorealistic e-commerce hero photograph');
    expect(prompt).toContain('no logos');
    expect(prompt).toContain('no readable text');
    expect(prompt).toContain('No people');
    expect(prompt).toContain(product.category);
    expect(prompt).toContain(product.subcategory);
  });

  test('la cible ImageKit conserve exactement le hero.jpg canonique V2', () => {
    expect(imageKitTarget('SHOWCASE-V2-0473')).toEqual({
      folder: 'komerce/staging/showcase-v2/showcase-v2-0473',
      publicId: 'hero',
      filename: 'hero.jpg',
    });
  });

  test('la purge agrège tout le namespace V2 en une seule invalidation', () => {
    expect(showcaseNamespacePurgeUrl(
      'https://ik.imagekit.io/demo/komerce/staging/showcase-v2/showcase-v2-0473/hero.jpg'
    )).toBe('https://ik.imagekit.io/demo/komerce/staging/showcase-v2/*');
  });

  test('le pool conserve l ordre des résultats', async () => {
    const result = await mapWithConcurrency([3, 1, 2], 2, async (value) => {
      await new Promise((resolve) => setTimeout(resolve, value));
      return value * 10;
    });
    expect(result).toEqual([30, 10, 20]);
  });
});
