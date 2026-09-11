'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const path = require('path');
const {
  DEFAULT_TARGET,
  DEFAULT_MANIFEST,
  NAMESPACE,
  MEDIA_PROVIDER,
  parseArgs,
  productFolder,
  uploadSlot,
  mirrorProduct,
} = require('../../scripts/showcase-imagekit-v2');
const { staticAudit } = require('../../scripts/showcase-media-audit');

function product(overrides = {}) {
  return {
    product_ref: 'KPR-990040',
    name: 'Jeu de construction magnétique',
    image_url: 'https://source.example.test/hero.jpg',
    images: [
      'https://source.example.test/hero.jpg',
      'https://source.example.test/detail.png',
    ],
    ...overrides,
  };
}

describe('showcase-imagekit-v2', () => {
  test('le pipeline V2 vise exactement les 40 produits et le manifeste canonique', () => {
    const options = parseArgs(['prepare']);
    expect(DEFAULT_TARGET).toBe(40);
    expect(options.target).toBe(40);
    expect(options.manifest).toBe(DEFAULT_MANIFEST);
    expect(path.basename(options.manifest)).toBe('showcase-catalog-v2.json');
    expect(NAMESPACE).toBe('showcase-v2');
    expect(MEDIA_PROVIDER).toBe('imagekit');
  });

  test('aucune action réseau n’est implicite sans commande prepare ou audit', () => {
    expect(() => parseArgs([])).toThrow(/Commande requise/);
    expect(() => parseArgs(['seed'])).toThrow(/Commande requise/);
  });

  test('le namespace ImageKit est stable par product_ref canonique', () => {
    expect(productFolder('KPR-990040')).toBe('komerce/staging/showcase-v2/kpr-990040');
    expect(uploadSlot(0)).toBe('hero');
    expect(uploadSlot(1)).toBe('gallery-01');
    expect(uploadSlot(2)).toBe('gallery-02');
    expect(() => productFolder('SHOWCASE-V2-0001')).toThrow(/product_ref canonique/);
  });

  test('mirrorProduct envoie hero et galerie à ImageKit avec noms déterministes', async () => {
    const uploader = jest.fn(async (_file, options) => (
      `https://ik.imagekit.io/demo/${options.folder}/${options.publicId}.jpg`
    ));

    const mirrored = await mirrorProduct(product(), uploader);

    expect(uploader).toHaveBeenCalledTimes(2);
    expect(uploader.mock.calls[0]).toEqual([
      'https://source.example.test/hero.jpg',
      {
        folder: 'komerce/staging/showcase-v2/kpr-990040',
        publicId: 'hero',
        filename: 'https://source.example.test/hero.jpg',
      },
    ]);
    expect(uploader.mock.calls[1][1]).toMatchObject({
      folder: 'komerce/staging/showcase-v2/kpr-990040',
      publicId: 'gallery-01',
    });
    expect(mirrored.image_url).toBe('https://ik.imagekit.io/demo/komerce/staging/showcase-v2/kpr-990040/hero.jpg');
    expect(mirrored.images).toHaveLength(2);
  });

  test('l’audit ImageKit refuse un manifeste qui mélange encore Cloudinary', () => {
    const imagekit = 'https://ik.imagekit.io/demo/komerce/staging/showcase-v2/kpr-990040/hero.jpg';
    const cloudinary = 'https://res.cloudinary.com/demo/image/upload/v1/komerce/staging/showcase-v2/kpr-990039/hero.jpg';
    const report = staticAudit([
      { product_ref: 'KPR-990040', image_url: imagekit, images: [imagekit] },
      { product_ref: 'KPR-990039', image_url: cloudinary, images: [cloudinary] },
    ], {
      target: 2,
      mediaProvider: 'imagekit',
      namespace: 'showcase-v2',
    });

    expect(report.missingHero).toHaveLength(0);
    expect(report.invalidProvider).toHaveLength(1);
    expect(report.invalidProvider[0].ref).toBe('KPR-990039');
  });
});
