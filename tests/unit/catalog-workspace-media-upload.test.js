'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const mockDbQuery = jest.fn();
jest.mock('../../db', () => ({ query: (...args) => mockDbQuery(...args) }));

const workspace = require('../../services/catalog-workspace');

beforeEach(() => mockDbQuery.mockReset());

test('résout un brouillon sourcing avant de stocker son image', async () => {
  mockDbQuery
    .mockResolvedValueOnce({ rows: [{ id: 'product-id', product_ref: 'KPR-1', lifecycle_status: 'candidate', is_active: false }] })
    .mockResolvedValueOnce({ rows: [{ id: 'product-id', name: 'Lampe' }] });
  await expect(workspace.getCanonicalMediaUploadTarget('KPR-1')).resolves.toEqual({ id: 'product-id', name: 'Lampe' });
  expect(mockDbQuery).toHaveBeenCalledTimes(2);
  expect(mockDbQuery.mock.calls[1][0]).toContain("sc.state='imported_to_catalog'");
});

test('refuse une référence produit inconnue', async () => {
  mockDbQuery.mockResolvedValueOnce({ rows: [] });
  await expect(workspace.getCanonicalMediaUploadTarget('KPR-404'))
    .rejects.toMatchObject({ code: 'product_not_found', status: 404 });
});

test('refuse un produit qui n’est pas un brouillon sourcing inactif', async () => {
  mockDbQuery
    .mockResolvedValueOnce({ rows: [{ id: 'product-id', product_ref: 'KPR-1' }] })
    .mockResolvedValueOnce({ rows: [] });
  await expect(workspace.getCanonicalMediaUploadTarget('KPR-1'))
    .rejects.toMatchObject({ code: 'catalog_media_upload_candidate_required', status: 409 });
});

test.each(['http://ik.imagekit.io/file.jpg', 'https://example.org/file.jpg', 'invalid'])
  ('refuse une URL qui ne provient pas d’ImageKit : %s', async url => {
    await expect(workspace.appendUploadedCanonicalMedia('KPR-1', url))
      .rejects.toMatchObject({ code: 'catalog_media_url_invalid', status: 422 });
    expect(mockDbQuery).not.toHaveBeenCalled();
  });

test('ajoute un média sans identité fournisseur et met à jour l’image principale', async () => {
  mockDbQuery.mockResolvedValueOnce({ rows: [{
    product_id: 'product-id', media_id: 'media-id', image_url: 'https://ik.imagekit.io/komerce/image.jpg',
  }] });
  const result = await workspace.appendUploadedCanonicalMedia('KPR-1', 'https://ik.imagekit.io/komerce/image.jpg');
  expect(result).toMatchObject({ product_id: 'product-id', media_id: 'media-id' });
  const [sql, params] = mockDbQuery.mock.calls[0];
  expect(sql).toContain('INSERT INTO catalog_media');
  expect(sql).toContain('source_media_id, url');
  expect(params).toEqual(['KPR-1', 'https://ik.imagekit.io/komerce/image.jpg']);
});

test('refuse un produit qui ne peut plus recevoir de média canonique', async () => {
  mockDbQuery.mockResolvedValueOnce({ rows: [] });
  await expect(workspace.appendUploadedCanonicalMedia('KPR-1', 'https://ik.imagekit.io/komerce/image.jpg'))
    .rejects.toMatchObject({ code: 'catalog_media_upload_candidate_required', status: 409 });
});
