'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const {
  DEFAULT_MEDIA_PROVIDER,
  resolveMediaProvider,
  isCanonicalCloudinaryUrl,
  isCanonicalImageKitUrl,
  isCanonicalMediaUrl,
} = require('../../scripts/showcase-media-provider');

describe('showcase-media-provider', () => {
  const cloudinary = 'https://res.cloudinary.com/demo/image/upload/v1/komerce/staging/showcase-v2/showcase-v2-0001/hero.jpg';
  const imagekit = 'https://ik.imagekit.io/demo/komerce/staging/showcase-v2/showcase-v2-0001/hero.jpg';

  test('ImageKit est le provider canonique par défaut', () => {
    const previous = process.env.SHOWCASE_MEDIA_PROVIDER;
    delete process.env.SHOWCASE_MEDIA_PROVIDER;
    try {
      expect(DEFAULT_MEDIA_PROVIDER).toBe('imagekit');
      expect(resolveMediaProvider()).toBe('imagekit');
    } finally {
      if (previous === undefined) delete process.env.SHOWCASE_MEDIA_PROVIDER;
      else process.env.SHOWCASE_MEDIA_PROVIDER = previous;
    }
  });

  test('Cloudinary reste une compatibilité explicite, jamais le défaut', () => {
    expect(resolveMediaProvider('CLOUDINARY')).toBe('cloudinary');
    expect(resolveMediaProvider('imagekit')).toBe('imagekit');
    expect(() => resolveMediaProvider('autre')).toThrow(/SHOWCASE_MEDIA_PROVIDER invalide/);
  });

  test('reconnaît les URLs canoniques Cloudinary sans accepter un fetch proxy', () => {
    expect(isCanonicalCloudinaryUrl(cloudinary, 'showcase-v2')).toBe(true);
    expect(isCanonicalCloudinaryUrl('https://res.cloudinary.com/demo/image/fetch/https://example.test/a.jpg', 'showcase-v2')).toBe(false);
  });

  test('reconnaît uniquement un asset ImageKit hébergé dans le namespace attendu', () => {
    expect(isCanonicalImageKitUrl(imagekit, 'showcase-v2')).toBe(true);
    expect(isCanonicalImageKitUrl('https://ik.imagekit.io/demo/autre/hero.jpg', 'showcase-v2')).toBe(false);
    expect(isCanonicalImageKitUrl('http://ik.imagekit.io/demo/komerce/staging/showcase-v2/x/hero.jpg', 'showcase-v2')).toBe(false);
  });

  test('le provider choisi interdit silencieusement le mélange de CDN', () => {
    expect(isCanonicalMediaUrl(imagekit, 'imagekit', 'showcase-v2')).toBe(true);
    expect(isCanonicalMediaUrl(cloudinary, 'imagekit', 'showcase-v2')).toBe(false);
    expect(isCanonicalMediaUrl(cloudinary, 'cloudinary', 'showcase-v2')).toBe(true);
    expect(isCanonicalMediaUrl(imagekit, 'cloudinary', 'showcase-v2')).toBe(false);
  });
});
