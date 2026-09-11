'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const {
  acceptableCommonsPage,
  mapCommonsPage,
  fetchCommonsQuery,
  dedupeCandidates,
} = require('../../scripts/showcase-curate-staging-500-hybrid');

function commonsPage(overrides = {}) {
  return {
    pageid: 42,
    title: 'File:Wireless headphones product.jpg',
    imageinfo: [{
      mime: 'image/jpeg',
      width: 1200,
      height: 1200,
      thumburl: 'https://upload.wikimedia.org/example.jpg',
      descriptionurl: 'https://commons.wikimedia.org/wiki/File:Example.jpg',
      extmetadata: {
        LicenseShortName: { value: 'CC BY-SA 4.0' },
        Artist: { value: 'Example artist' },
        ImageDescription: { value: 'A product photograph.' },
      },
    }],
    ...overrides,
  };
}

describe('showcase-curate-staging-500-hybrid', () => {
  test('filtre les assets manifestement non produit et les images trop petites', () => {
    expect(acceptableCommonsPage(commonsPage())).toBe(true);
    expect(acceptableCommonsPage(commonsPage({ title: 'File:Brand logo.png' }))).toBe(false);
    expect(acceptableCommonsPage(commonsPage({ imageinfo: [{ mime: 'image/jpeg', width: 200, height: 200, thumburl: 'https://upload.wikimedia.org/small.jpg' }] }))).toBe(false);
  });

  test('mappe une source Commons avec provenance et catégorie', () => {
    const mapped = mapCommonsPage(commonsPage(), 'headphones product photograph', 'Tech', 'Accessoires');
    expect(mapped).toMatchObject({
      source: 'commons:42',
      category: 'Tech',
      subcategory: 'Accessoires',
      image_url: 'https://upload.wikimedia.org/example.jpg',
    });
    expect(mapped.source_attribution.license).toBe('CC BY-SA 4.0');
  });

  test('retry un HTTP 429 puis réussit sans abandonner la requête', async () => {
    const headers = { get: () => '0.001' };
    const fetchFn = jest.fn()
      .mockResolvedValueOnce({ ok: false, status: 429, headers })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ query: { pages: { 42: commonsPage() } } }) });

    const rows = await fetchCommonsQuery('headphones product photograph', 'Tech', 'Accessoires', 20, fetchFn);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(rows).toHaveLength(1);
    expect(rows[0].source).toBe('commons:42');
  });

  test('déduplique contre le noyau puis entre sources candidates', () => {
    const nucleus = [{ source: 'dummyjson:1', image_url: 'https://img/a.jpg' }];
    const rows = dedupeCandidates([
      { source: 'dummyjson:1', image_url: 'https://img/b.jpg', category: 'Tech' },
      { source: 'platzi:2', image_url: 'https://img/a.jpg', category: 'Tech' },
      { source: 'platzi:3', image_url: 'https://img/c.jpg', category: 'Tech' },
      { source: 'platzi:3', image_url: 'https://img/d.jpg', category: 'Tech' },
    ], nucleus);
    expect(rows).toEqual([{ source: 'platzi:3', image_url: 'https://img/c.jpg', category: 'Tech' }]);
  });
});
