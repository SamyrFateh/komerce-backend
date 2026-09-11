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
  buildCandidatePool,
} = require('../../scripts/showcase-curate-staging-500-hybrid');

function commonsPage(overrides = {}) {
  return {
    pageid: 42,
    title: 'File:Wireless headphones product.jpg',
    imageinfo: [{
      mime: 'image/jpeg',
      width: 1200,
      height: 1200,
      url: 'https://upload.wikimedia.org/original.jpg',
      thumburl: 'https://upload.wikimedia.org/example.jpg?utm_source=commons.wikimedia.org&utm_content=thumbnail_unscaled',
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
    expect(acceptableCommonsPage(commonsPage({ imageinfo: [{ mime: 'image/jpeg', width: 200, height: 200, url: 'https://upload.wikimedia.org/small.jpg' }] }))).toBe(false);
  });

  test('mappe une source Commons avec provenance et URL originale sans thumbnail paramétré', () => {
    const mapped = mapCommonsPage(commonsPage(), 'headphones product photograph', 'Tech', 'Accessoires');
    expect(mapped).toMatchObject({
      source: 'commons:42',
      category: 'Tech',
      subcategory: 'Accessoires',
      image_url: 'https://upload.wikimedia.org/original.jpg',
    });
    expect(mapped.image_url).not.toContain('utm_');
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

  test('combine les primaires déjà vérifiés et Commons sans second GET réseau', () => {
    const nucleus = [{ source: 'dummyjson:1', image_url: 'https://img/a.jpg' }];
    const primary = [{ source: 'dummyjson:2', image_url: 'https://img/b.jpg', category: 'Tech' }];
    const commons = [
      { source: 'commons:42', image_url: 'https://img/c.jpg', category: 'Mode' },
      { source: 'commons:43', image_url: 'https://img/b.jpg', category: 'Mode' },
    ];
    expect(buildCandidatePool(primary, commons, nucleus)).toEqual([
      primary[0],
      commons[0],
    ]);
  });
});
