'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const {
  COMMONS_QUERY_LIMIT,
  canonicalCommonsMediaUrl,
  acceptableCommonsPage,
  mapCommonsPage,
  fetchCommonsQuery,
  dedupeCandidates,
  buildCandidatePool,
} = require('../../scripts/showcase-curate-staging-500-hybrid');

const HEADPHONE_SIGNAL = /\b(headphone|headphones|earphone|earphones|earbud|earbuds|headset|airpods|livepods)\b/i;

function commonsPage(overrides = {}) {
  return {
    pageid: 42,
    title: 'File:Wireless headphones product.jpg',
    imageinfo: [{
      mime: 'image/jpeg',
      width: 1200,
      height: 1200,
      url: 'https://upload.wikimedia.org/original.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original#fragment',
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
  test('canonise les médias Wikimedia sans query/hash et ne réécrit pas les autres hôtes', () => {
    expect(canonicalCommonsMediaUrl({
      url: 'https://upload.wikimedia.org/a.jpg?utm_source=commons#frag',
    })).toBe('https://upload.wikimedia.org/a.jpg');
    expect(canonicalCommonsMediaUrl({
      url: 'https://cdn.example.test/a.jpg?variant=hero#frag',
    })).toBe('https://cdn.example.test/a.jpg?variant=hero#frag');
  });

  test('filtre les assets non commerciaux, formats fragiles et images trop petites', () => {
    expect(COMMONS_QUERY_LIMIT).toBe(50);
    expect(acceptableCommonsPage(commonsPage(), HEADPHONE_SIGNAL)).toBe(true);
    expect(acceptableCommonsPage(commonsPage({ title: 'File:Brand logo.png' }), HEADPHONE_SIGNAL)).toBe(false);
    expect(acceptableCommonsPage(commonsPage({ title: 'File:Football team 1967.jpg' }), /football/i)).toBe(false);
    expect(acceptableCommonsPage(commonsPage({ title: 'File:Shopping mall headphone store.jpg' }), HEADPHONE_SIGNAL)).toBe(false);
    expect(acceptableCommonsPage(commonsPage({ title: 'File:David Hasemyer portrait.jpg' }), HEADPHONE_SIGNAL)).toBe(false);
    expect(acceptableCommonsPage(commonsPage({ imageinfo: [{ mime: 'image/tiff', width: 1200, height: 1200, url: 'https://upload.wikimedia.org/archive.tif' }] }), HEADPHONE_SIGNAL)).toBe(false);
    expect(acceptableCommonsPage(commonsPage({ imageinfo: [{ mime: 'image/jpeg', width: 300, height: 300, url: 'https://upload.wikimedia.org/small.jpg' }] }), HEADPHONE_SIGNAL)).toBe(false);
  });

  test('mappe une source Commons commercialement pertinente avec provenance et URL canonique', () => {
    const mapped = mapCommonsPage(commonsPage(), 'headphones isolated product photograph', 'Tech', 'Accessoires', HEADPHONE_SIGNAL);
    expect(mapped).toMatchObject({
      source: 'commons:42',
      category: 'Tech',
      subcategory: 'Accessoires',
      image_url: 'https://upload.wikimedia.org/original.jpg',
    });
    expect(mapped.image_url).not.toContain('?');
    expect(mapped.image_url).not.toContain('#');
    expect(mapped.source_attribution.license).toBe('CC BY-SA 4.0');
  });

  test('retry un HTTP 429 puis réussit sans abandonner la requête', async () => {
    const headers = { get: () => '0.001' };
    const fetchFn = jest.fn()
      .mockResolvedValueOnce({ ok: false, status: 429, headers })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ query: { pages: { 42: commonsPage() } } }) });

    const rows = await fetchCommonsQuery('headphones isolated product photograph', 'Tech', 'Accessoires', 50, fetchFn, HEADPHONE_SIGNAL);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(rows).toHaveLength(1);
    expect(rows[0].source).toBe('commons:42');
    expect(rows[0].image_url).toBe('https://upload.wikimedia.org/original.jpg');
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
