'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

jest.mock('node:crypto', () => ({ randomUUID: jest.fn(() => '12345678-1234-4234-8234-123456789abc') }));

const { uploadProductImage, deleteProductImage, safeExtension } = require('../../services/product-media-storage');

describe('product-media-storage', () => {
  const file = {
    originalname: 'Photo.PNG',
    detectedMimeType: 'image/png',
    buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
  };

  afterEach(() => jest.restoreAllMocks());

  test('upload requires an ImageKit server key and never falls back to a local URL', async () => {
    await expect(uploadProductImage(file, 'product-1', { env: {} })).rejects.toMatchObject({
      status: 503,
      code: 'PRODUCT_MEDIA_PROVIDER_UNAVAILABLE',
    });
  });

  test('uploads a validated buffer to a product-scoped folder and returns the provider URL', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ url: 'https://ik.imagekit.io/komerce/products/photo.png', fileId: 'provider-file-id' }),
    });

    const result = await uploadProductImage(file, 'product-1', {
      env: { IMAGEKIT_PRIVATE_KEY: 'private-test-key' }, fetchImpl,
    });

    expect(result).toEqual({ url: 'https://ik.imagekit.io/komerce/products/photo.png', fileId: 'provider-file-id' });
    expect(fetchImpl).toHaveBeenCalledWith('https://upload.imagekit.io/api/v1/files/upload', expect.objectContaining({
      method: 'POST',
      headers: { Authorization: `Basic ${Buffer.from('private-test-key:').toString('base64')}` },
      body: expect.any(FormData),
    }));
    const form = fetchImpl.mock.calls[0][1].body;
    expect(form.get('folder')).toBe('/komerce/products/product-1');
    expect(form.get('fileName')).toMatch(/^12345678-1234-4234-8234-123456789abc\.png$/);
    expect(form.get('useUniqueFileName')).toBe('false');
  });

  test('does not accept a non-HTTPS or incomplete provider result', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ url: 'http://ik.imagekit.io/x' }) });
    await expect(uploadProductImage(file, 'product-1', {
      env: { IMAGEKIT_PRIVATE_KEY: 'private-test-key' }, fetchImpl,
    })).rejects.toMatchObject({ status: 502, code: 'PRODUCT_MEDIA_UPLOAD_FAILED' });
  });

  test('deletes orphaned provider media after a failed database write', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: true, status: 204 });
    await expect(deleteProductImage('file id/1', {
      env: { IMAGEKIT_PRIVATE_KEY: 'private-test-key' }, fetchImpl,
    })).resolves.toBe(true);
    expect(fetchImpl).toHaveBeenCalledWith('https://api.imagekit.io/v1/files/file%20id%2F1', expect.objectContaining({
      method: 'DELETE',
      headers: { Authorization: `Basic ${Buffer.from('private-test-key:').toString('base64')}` },
    }));
  });

  test('limits extensions to image formats allowed by the upload filter', () => {
    expect(safeExtension('photo.GIF')).toBe('.gif');
    expect(safeExtension('payload.svg')).toBe('.jpg');
  });
});
