'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

jest.mock('../../db', () => ({
  getClient: jest.fn(),
  pool: { end: jest.fn(async () => {}) },
}));

const { buildCatalogue } = require('../../scripts/showcase-v2-source-build');
const {
  EXPECTED_V2,
  mediaVersion,
  versionedHeroId,
  validateSource,
} = require('../../scripts/showcase-v2-media-refresh');

describe('showcase-v2-media-refresh', () => {
  test('valide les 500 fixtures FR dont le SVG embarque bien le titre courant', () => {
    const products = buildCatalogue();
    expect(validateSource(products)).toHaveLength(EXPECTED_V2);
    expect(products.every((p) => p.source_locale === 'fr')).toBe(true);
  });

  test('versionne le nom ImageKit à partir du contenu du SVG', () => {
    const [product] = buildCatalogue();
    expect(versionedHeroId(product)).toMatch(/^hero-[a-f0-9]{12}$/);

    const altered = { ...product, image_url: `${product.image_url}x` };
    expect(versionedHeroId(altered)).not.toBe(versionedHeroId(product));
    expect(mediaVersion(product.image_url)).toHaveLength(12);
  });

  test('refuse un SVG qui ne correspond plus au titre éditorial courant', () => {
    const products = buildCatalogue();
    products[0] = { ...products[0], source_title: 'Titre français différent', name: 'Titre français différent' };
    expect(() => validateSource(products)).toThrow(/SVG n'embarque pas le titre FR courant/);
  });
});
