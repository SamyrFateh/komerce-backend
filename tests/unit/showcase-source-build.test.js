'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const {
  USER_AGENT,
  COMMONS_CATEGORIES,
  parseArgs,
  retryDelayMs,
  isReusableCommonsLicense,
  isShowcaseRaster,
  mapCommonsPage,
  dedupe,
  decorate,
} = require('../../scripts/showcase-source-build');

describe('showcase-source-build', () => {
  test('identifie le client Wikimedia et limite la concurrence', () => {
    expect(USER_AGENT).toContain('https://komerce.co');
    expect(COMMONS_CATEGORIES.length).toBeGreaterThanOrEqual(10);
    expect(COMMONS_CATEGORIES.some(([name]) => name.includes('white background'))).toBe(true);
    expect(parseArgs([])).toMatchObject({ target: 500, concurrency: 3 });
    expect(() => parseArgs(['--concurrency', '4'])).toThrow(/entre 1 et 3/);
  });

  test('retryDelayMs respecte Retry-After et le backoff', () => {
    expect(retryDelayMs({ headers: { get: () => '2' } }, 0)).toBe(2000);
    expect(retryDelayMs({ headers: { get: () => '120' } }, 0)).toBe(30000);
    expect(retryDelayMs({ headers: { get: () => null } }, 1)).toBe(2400);
  });

  test('filtre les licences Commons', () => {
    expect(isReusableCommonsLicense('Public domain')).toBe(true);
    expect(isReusableCommonsLicense('CC0 1.0')).toBe(true);
    expect(isReusableCommonsLicense('CC BY-SA 4.0')).toBe(true);
    expect(isReusableCommonsLicense('CC BY 2.0')).toBe(true);
    expect(isReusableCommonsLicense('CC BY-NC 4.0')).toBe(false);
    expect(isReusableCommonsLicense('CC BY-ND 4.0')).toBe(false);
    expect(isReusableCommonsLicense('All rights reserved')).toBe(false);
  });

  test('filtre les médias Commons pour un rendu vitrine', () => {
    expect(isShowcaseRaster({ mime: 'image/jpeg', width: 1200, height: 900 })).toBe(true);
    expect(isShowcaseRaster({ mime: 'image/svg+xml', width: 1200, height: 900 })).toBe(false);
    expect(isShowcaseRaster({ mime: 'image/jpeg', width: 250, height: 250 })).toBe(false);
    expect(isShowcaseRaster({ mime: 'image/jpeg', width: 2400, height: 300 })).toBe(false);
  });

  test('mapCommonsPage conserve source et attribution', () => {
    const row = mapCommonsPage({
      pageid: 42,
      title: 'File:Yellow wristwatch.jpg',
      imageinfo: [{
        thumburl: 'https://upload.wikimedia.org/watch.jpg',
        mime: 'image/jpeg',
        width: 1200,
        height: 1000,
        descriptionurl: 'https://commons.wikimedia.org/wiki/File:Yellow_wristwatch.jpg',
        extmetadata: {
          LicenseShortName: { value: 'CC BY-SA 4.0' },
          Artist: { value: '<b>Alice</b>' },
          ImageDescription: { value: '<p>Yellow wristwatch product photo</p>' },
        },
      }],
    }, 'Timepieces with white background', 'Mode', 'Montres');

    expect(row.source).toBe('commons:42');
    expect(row.category).toBe('Mode');
    expect(row.source_attribution.license).toBe('CC BY-SA 4.0');
    expect(row.source_attribution.artist).toBe('Alice');
    expect(row.source_attribution.commons_category).toBe('Timepieces with white background');
  });

  test('mapCommonsPage rejette un média non image', () => {
    expect(mapCommonsPage({
      pageid: 1,
      title: 'File:test.pdf',
      imageinfo: [{
        url: 'https://upload.wikimedia.org/test.pdf',
        mime: 'application/pdf',
        width: 1200,
        height: 900,
        extmetadata: { LicenseShortName: { value: 'CC BY-SA 4.0' } },
      }],
    }, 'Office equipment with white background', 'Maison', 'Divers')).toBeNull();
  });

  test('dedupe refuse doublons source et hero', () => {
    const rows = dedupe([
      { source: 'a:1', image_url: 'https://a/1.jpg' },
      { source: 'a:1', image_url: 'https://a/2.jpg' },
      { source: 'a:2', image_url: 'https://a/1.jpg' },
      { source: 'a:3', image_url: 'https://a/3.jpg' },
    ]);
    expect(rows.map((row) => row.source)).toEqual(['a:1', 'a:3']);
  });

  test('decorate est déterministe', () => {
    const input = {
      source: 'test:7',
      name: 'Classic Dress',
      category: 'Mode',
      subcategory: 'Robes',
      description: '',
      image_url: 'https://example.com/7.jpg',
      images: ['https://example.com/7.jpg'],
    };
    const a = decorate(input, 6);
    const b = decorate(input, 6);
    expect(a).toEqual(b);
    expect(a.product_ref).toBe('SHOWCASE-V1-0007');
    expect(a.stock).toBeGreaterThanOrEqual(2);
    expect(a.sort_order).toBe(6);
  });
});
