'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const {
  IMAGEKIT_MAX_ATTEMPTS,
  parseArgs,
  isWikimediaMediaUrl,
  mediaFilename,
  showcaseNamespace,
  retryAfterMs,
  downloadWikimediaMedia,
  imageKitAuthHeader,
  imageKitFileName,
  isRetryableImageKitStatus,
  uploadImageKitFile,
} = require('../../scripts/showcase-media-mirror');

describe('showcase-media-mirror', () => {
  test('vise 500 produits et ImageKit par défaut, Cloudinary reste surcharge explicite', () => {
    const previous = process.env.SHOWCASE_MEDIA_PROVIDER;
    delete process.env.SHOWCASE_MEDIA_PROVIDER;
    try {
      expect(parseArgs([]).target).toBe(500);
      expect(parseArgs([]).mediaProvider).toBe('imagekit');
      expect(parseArgs(['--target', '750', '--media-provider', 'cloudinary'])).toMatchObject({
        target: 750,
        mediaProvider: 'cloudinary',
      });
    } finally {
      if (previous === undefined) delete process.env.SHOWCASE_MEDIA_PROVIDER;
      else process.env.SHOWCASE_MEDIA_PROVIDER = previous;
    }
  });

  test('identifie uniquement les médias Wikimedia à bufferiser localement', () => {
    expect(isWikimediaMediaUrl('https://upload.wikimedia.org/wikipedia/commons/a/a1/test.jpg')).toBe(true);
    expect(isWikimediaMediaUrl('https://res.cloudinary.com/demo/image/upload/test.jpg')).toBe(false);
    expect(isWikimediaMediaUrl('https://ik.imagekit.io/demo/test.jpg')).toBe(false);
    expect(isWikimediaMediaUrl('https://dummyjson.com/image.jpg')).toBe(false);
  });

  test('nettoie le nom de fichier sans conserver la query string', () => {
    expect(mediaFilename('https://upload.wikimedia.org/wikipedia/commons/7/70/Dusty%20Roy%20Parka.jpg?x=1'))
      .toBe('Dusty-Roy-Parka.jpg');
  });

  test('isole les campagnes V1 et V2 dans deux namespaces média', () => {
    expect(showcaseNamespace('SHOWCASE-V1-0001')).toBe('showcase-v1');
    expect(showcaseNamespace('SHOWCASE-V2-0001')).toBe('showcase-v2');
    expect(showcaseNamespace('autre')).toBe('showcase-v1');
  });

  test('forme l’auth Basic ImageKit sans exposer de mot de passe', () => {
    expect(imageKitAuthHeader('private_test')).toBe('Basic cHJpdmF0ZV90ZXN0Og==');
  });

  test('fabrique des noms de fichiers stables pour ImageKit', () => {
    expect(imageKitFileName('hero', 'https://example.test/photo.png?x=1')).toBe('hero.png');
    expect(imageKitFileName('gallery-01', null)).toBe('gallery-01.jpg');
  });

  test('respecte Retry-After en secondes ou utilise un backoff borné', () => {
    expect(retryAfterMs('3', 0, 1000)).toBe(3000);
    expect(retryAfterMs(null, 0, 1000)).toBe(1000);
    expect(retryAfterMs(null, 8, 1000)).toBe(30000);
  });

  test('classe 429 et 5xx ImageKit comme transitoires, pas les erreurs 4xx permanentes', () => {
    expect(IMAGEKIT_MAX_ATTEMPTS).toBe(4);
    expect(isRetryableImageKitStatus(429)).toBe(true);
    expect(isRetryableImageKitStatus(500)).toBe(true);
    expect(isRetryableImageKitStatus(503)).toBe(true);
    expect(isRetryableImageKitStatus(400)).toBe(false);
    expect(isRetryableImageKitStatus(401)).toBe(false);
  });

  test('retente un 500 ImageKit puis réussit sans abandonner le média', async () => {
    const previous = process.env.IMAGEKIT_PRIVATE_KEY;
    process.env.IMAGEKIT_PRIVATE_KEY = 'private_test';
    const headers = { get: () => null };
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce({ ok: false, status: 500, headers, json: async () => ({ message: 'rare transient failure' }) })
      .mockResolvedValueOnce({ ok: true, status: 200, headers, json: async () => ({ url: 'https://ik.imagekit.io/demo/hero.jpg' }) });
    const sleepImpl = jest.fn(async () => {});
    try {
      const result = await uploadImageKitFile(
        new Blob([new Uint8Array(128)], { type: 'image/jpeg' }),
        { folder: 'komerce/staging/showcase-v2/kpr-990040', publicId: 'hero', filename: 'source.jpg' },
        { fetchImpl, sleepImpl, nowImpl: () => 1000, maxAttempts: 2 },
      );
      expect(result).toBe('https://ik.imagekit.io/demo/hero.jpg');
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      expect(sleepImpl).toHaveBeenCalledWith(1000);
    } finally {
      if (previous === undefined) delete process.env.IMAGEKIT_PRIVATE_KEY;
      else process.env.IMAGEKIT_PRIVATE_KEY = previous;
    }
  });

  test('ne retente pas une erreur ImageKit 400 permanente', async () => {
    const previous = process.env.IMAGEKIT_PRIVATE_KEY;
    process.env.IMAGEKIT_PRIVATE_KEY = 'private_test';
    const headers = { get: () => null };
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      headers,
      json: async () => ({ message: 'invalid file' }),
    });
    const sleepImpl = jest.fn(async () => {});
    try {
      await expect(uploadImageKitFile(
        'https://example.test/bad.jpg',
        { folder: 'komerce/staging/showcase-v2/kpr-990040', publicId: 'hero', filename: 'bad.jpg' },
        { fetchImpl, sleepImpl, maxAttempts: 4 },
      )).rejects.toThrow(/ImageKit upload failed \(400\)/);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(sleepImpl).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined) delete process.env.IMAGEKIT_PRIVATE_KEY;
      else process.env.IMAGEKIT_PRIVATE_KEY = previous;
    }
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
