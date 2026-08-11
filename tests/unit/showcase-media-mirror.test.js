'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const {
  parseArgs,
  isWikimediaMediaUrl,
  mediaFilename,
  retryAfterMs,
  downloadWikimediaMedia,
} = require('../../scripts/showcase-media-mirror');

describe('showcase-media-mirror', () => {
  test('vise 500 produits par défaut', () => {
    expect(parseArgs([]).target).toBe(500);
    expect(parseArgs(['--target', '750']).target).toBe(750);
  });

  test('identifie uniquement les médias Wikimedia à bufferiser localement', () => {
    expect(isWikimediaMediaUrl('https://upload.wikimedia.org/wikipedia/commons/a/a1/test.jpg')).toBe(true);
    expect(isWikimediaMediaUrl('https://res.cloudinary.com/demo/image/upload/test.jpg')).toBe(false);
    expect(isWikimediaMediaUrl('https://dummyjson.com/image.jpg')).toBe(false);
  });

  test('nettoie le nom de fichier sans conserver la query string', () => {
    expect(mediaFilename('https://upload.wikimedia.org/wikipedia/commons/7/70/Dusty%20Roy%20Parka.jpg?x=1'))
      .toBe('Dusty-Roy-Parka.jpg');
  });

  test('respecte Retry-After en secondes ou utilise un backoff borné', () => {
    expect(retryAfterMs('3', 0, 1000)).toBe(3000);
    expect(retryAfterMs(null, 0, 1000)).toBe(1000);
    expect(retryAfterMs(null, 8, 1000)).toBe(30000);
  });

  test('retente un 429 Wikimedia puis renvoie un Blob image avec User-Agent identifié', async () => {
    const headers429 = { get: (name) => name.toLowerCase() === 'retry-after' ? '0' : 'text/plain' };
    const headers200 = { get: (name) => name.toLowerCase() === 'content-type' ? 'image/jpeg' : null };
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce({ status: 429, ok: false, headers: headers429 })
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        headers: headers200,
        arrayBuffer: async () => new Uint8Array(128).buffer,
      });
    const sleepImpl = jest.fn(async () => {});

    const result = await downloadWikimediaMedia(
      'https://upload.wikimedia.org/wikipedia/commons/7/70/DustyRoyParka.jpg',
      { fetchImpl, sleepImpl, nowImpl: () => 1000, minDelayMs: 0, maxAttempts: 2, timeoutMs: 1000 },
    );

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0][1].headers['User-Agent']).toMatch(/KomerceShowcaseBot\/2\.1/);
    expect(result.blob).toBeInstanceOf(Blob);
    expect(result.type).toBe('image/jpeg');
    expect(result.bytes).toBe(128);
    expect(sleepImpl).toHaveBeenCalledWith(0);
  });
});
