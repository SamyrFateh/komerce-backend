'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const {
  USER_AGENT,
  COMMONS_MEDIA_MIN_DELAY_MS,
  COMMONS_MEDIA_RETRIES,
  COMMONS_CATEGORIES,
  parseArgs,
  retryDelayMs,
  verifyImageUrl,
  isReusableCommonsLicense,
  isShowcaseRaster,
  mapCommonsPage,
  dedupe,
  decorate,
  isCommonsProduct,
} = require('../../scripts/showcase-source-build');

describe('showcase-source-build', () => {
  test('identifie le client Wikimedia et régule les médias Commons', () => {
    expect(USER_AGENT).toContain('https://komerce.co');
    expect(USER_AGENT).toMatch(/bot/i);
    expect(COMMONS_MEDIA_MIN_DELAY_MS).toBeGreaterThanOrEqual(1000);
    expect(COMMONS_MEDIA_RETRIES).toBeGreaterThanOrEqual(3);
    expect(COMMONS_CATEGORIES.length).toBeGreaterThanOrEqual(10);
    expect(COMMONS_CATEGORIES.some(([name]) => name.includes('white background'))).toBe(true);
    expect(parseArgs([])).toMatchObject({ target: 500, concurrency: 3 });
    expect(() => parseArgs(['--concurrency', '4'])).toThrow(/entre 1 et 3/);
  });

  test('reconnaît les produits Commons à throttler', () => {
    expect(isCommonsProduct({ source: 'commons:42' })).toBe(true);
    expect(isCommonsProduct({ source: 'dummyjson:42' })).toBe(false);
    expect(isCommonsProduct({ source: 'platzi:42' })).toBe(false);
  });

  test('verifyImageUrl réutilise le User-Agent Wikimedia conforme', async () => {
    const previousFetch = global.fetch;
    const cancel = jest.fn(async () => {});
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: (name) => name === 'content-type' ? 'image/jpeg' : null },
      body: {
        getReader: () => ({
          read: async () => ({ value: new Uint8Array(128) }),
          cancel,
        }),
      },
    }));

    try {
      const result = await verifyImageUrl('https://upload.wikimedia.org/example.jpg', 1000);
      expect(result).toMatchObject({ ok: true, status: 200, type: 'image/jpeg' });
      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(global.fetch.mock.calls[0][1].headers['User-Agent']).toBe(USER_AGENT);
      expect(cancel).toHaveBeenCalledTimes(1);
    } finally {
      global.fetch = previousFetch;
    }
  });

  test('verifyImageUrl expose un 429 non retenté pour le diagnostic', async () => {
    const previousFetch = global.fetch;
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 429,
      headers: { get: (name) => name === 'content-type' ? 'text/html; charset=utf-8' : null },
      body: {
        getReader: () => ({
          read: async () => ({ value: new Uint8Array(128) }),
          cancel: async () => {},
        }),
      },
    }));

    try {
      const result = await verifyImageUrl('https://upload.wikimedia.org/rate-limited.jpg', 1000);
      expect(result).toMatchObject({ ok: false, status: 429, type: 'text/html; charset=utf-8' });
      expect(global.fetch).toHaveBeenCalledTimes(1);
    } finally {
      global.fetch = previousFetch;
    }
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
