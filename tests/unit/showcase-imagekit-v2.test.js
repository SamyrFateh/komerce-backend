'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const path = require('path');
const {
  DEFAULT_TARGET,
  MAX_TARGET,
  DEFAULT_MANIFEST,
  NAMESPACE,
  MEDIA_PROVIDER,
  parseArgs,
  productFolder,
  uploadSlot,
  downloadRemoteSourceMedia,
  downloadSourceMedia,
  uploadSourceImage,
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

function sourceDownload(sourceUrl) {
  const type = sourceUrl.endsWith('.png') ? 'image/png' : 'image/jpeg';
  const filename = sourceUrl.split('/').pop();
  return {
    blob: new Blob([new Uint8Array(128)], { type }),
    filename,
    bytes: 128,
    type,
  };
}

describe('showcase-imagekit-v2', () => {
  test('le défaut reste 40 mais le chemin staging explicite accepte 500', () => {
    const options = parseArgs(['prepare']);
    expect(DEFAULT_TARGET).toBe(40);
    expect(MAX_TARGET).toBe(500);
    expect(options.target).toBe(40);
    expect(options.manifest).toBe(DEFAULT_MANIFEST);
    expect(path.basename(options.manifest)).toBe('showcase-catalog-v2.json');
    expect(NAMESPACE).toBe('showcase-v2');
    expect(MEDIA_PROVIDER).toBe('imagekit');

    const large = parseArgs(['prepare', '--target', '500', '--input', 'data/catalogue-test-raw/showcase-curated-staging-500.json']);
    expect(large.target).toBe(500);
    expect(large.input).toHaveLength(1);
    expect(() => parseArgs(['prepare', '--target', '501'])).toThrow(/entre 1 et 500/);
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

  test('mirrorProduct matérialise hero et galerie avant upload ImageKit', async () => {
    const uploader = jest.fn(async (_file, options) => (
      `https://ik.imagekit.io/demo/${options.folder}/${options.publicId}.jpg`
    ));
    const downloader = jest.fn(async (sourceUrl) => sourceDownload(sourceUrl));

    const mirrored = await mirrorProduct(product(), uploader, downloader);

    expect(downloader).toHaveBeenCalledTimes(2);
    expect(uploader).toHaveBeenCalledTimes(2);
    expect(uploader.mock.calls[0][0]).toBeInstanceOf(Blob);
    expect(uploader.mock.calls[0][1]).toEqual({
      folder: 'komerce/staging/showcase-v2/kpr-990040',
      publicId: 'hero',
      filename: 'hero.jpg',
    });
    expect(uploader.mock.calls[1][0]).toBeInstanceOf(Blob);
    expect(uploader.mock.calls[1][1]).toMatchObject({
      folder: 'komerce/staging/showcase-v2/kpr-990040',
      publicId: 'gallery-01',
      filename: 'detail.png',
    });
    expect(mirrored.image_url).toBe('https://ik.imagekit.io/demo/komerce/staging/showcase-v2/kpr-990040/hero.jpg');
    expect(mirrored.images).toHaveLength(2);
  });

  test('uploadSourceImage ne confie jamais une URL distante directement à ImageKit', async () => {
    const sourceUrl = 'https://source.example.test/hero.jpg';
    const downloaded = sourceDownload(sourceUrl);
    const downloader = jest.fn(async () => downloaded);
    const uploader = jest.fn(async () => 'https://ik.imagekit.io/demo/komerce/staging/showcase-v2/kpr-990040/hero.jpg');

    const hosted = await uploadSourceImage(sourceUrl, {
      folder: 'komerce/staging/showcase-v2/kpr-990040',
      publicId: 'hero',
    }, { uploader, downloader });

    expect(downloader).toHaveBeenCalledWith(sourceUrl);
    expect(uploader).toHaveBeenCalledTimes(1);
    expect(uploader.mock.calls[0][0]).toBe(downloaded.blob);
    expect(uploader.mock.calls[0][0]).not.toBe(sourceUrl);
    expect(uploader.mock.calls[0][1]).toMatchObject({ filename: 'hero.jpg' });
    expect(hosted).toContain('ik.imagekit.io');
  });

  test('Wikimedia conserve son downloader poli dédié', async () => {
    const sourceUrl = 'https://upload.wikimedia.org/wikipedia/commons/9/93/example.jpg';
    const downloaded = sourceDownload(sourceUrl);
    const wikimediaDownloader = jest.fn(async () => downloaded);
    const fetchImpl = jest.fn();

    const result = await downloadSourceMedia(sourceUrl, { wikimediaDownloader, fetchImpl });

    expect(wikimediaDownloader).toHaveBeenCalledWith(sourceUrl);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result).toBe(downloaded);
  });

  test('le downloader distant exige de vrais octets image', async () => {
    const bytes = new Uint8Array(128);
    const fetchImpl = jest.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: (name) => (name === 'content-type' ? 'image/jpeg' : name === 'content-length' ? '128' : null) },
      arrayBuffer: async () => bytes.buffer,
    }));

    const downloaded = await downloadRemoteSourceMedia('https://source.example.test/hero.jpg', { fetchImpl });

    expect(downloaded.filename).toBe('hero.jpg');
    expect(downloaded.bytes).toBe(128);
    expect(downloaded.type).toBe('image/jpeg');
    expect(downloaded.blob).toBeInstanceOf(Blob);
  });

  test('le downloader distant refuse une réponse HTML même en HTTP 200', async () => {
    const fetchImpl = jest.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: (name) => (name === 'content-type' ? 'text/html' : null) },
      arrayBuffer: async () => new Uint8Array(128).buffer,
    }));

    await expect(downloadRemoteSourceMedia('https://source.example.test/hero.jpg', { fetchImpl }))
      .rejects.toThrow(/non-image/);
  });

  test('un échec de matérialisation reste fatal avant tout appel ImageKit', async () => {
    const uploader = jest.fn();
    const downloader = jest.fn().mockRejectedValue(new Error('source download failed'));
    await expect(uploadSourceImage('https://source.example.test/hero.jpg', {
      folder: 'komerce/staging/showcase-v2/kpr-990040',
      publicId: 'hero',
    }, { uploader, downloader })).rejects.toThrow('source download failed');
    expect(uploader).not.toHaveBeenCalled();
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
