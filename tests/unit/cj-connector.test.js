'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const {
  isConfigured,
  inactiveReason,
  normalizeCjProduct,
  flattenProductList,
  getAccessToken,
  buildProductListUrl,
  fetchProducts,
  resetTokenCacheForTests,
} = require('../../services/suppliers/connectors/cj-connector');

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

const rawProduct = {
  id: '04A22450-67F0-4617-A132-E7AE7F8963B0',
  nameEn: 'Wireless Headphones',
  sku: 'CJ-HEADSET-1',
  bigImage: 'https://cf.cjdropshipping.com/product/headset.jpg',
  sellPrice: '11.85',
  nowPrice: '9.50',
  oneCategoryName: 'Consumer Electronics',
  twoCategoryName: 'Audio',
  threeCategoryName: 'Headphones',
  totalVerifiedInventory: 42,
  description: '<p>Comfortable <strong>wireless</strong> headset.</p>',
  deliveryCycle: '3-5',
  directMinOrderNum: '1',
};

describe('cj-connector', () => {
  beforeEach(() => resetTokenCacheForTests());

  test('reste inactif sans credential et accepte API key ou access token', () => {
    expect(isConfigured({})).toBe(false);
    expect(inactiveReason({})).toMatch(/CJ_API_KEY/);
    expect(isConfigured({ CJ_API_KEY: 'key' })).toBe(true);
    expect(isConfigured({ CJ_ACCESS_TOKEN: 'token' })).toBe(true);
  });

  test('normalise un produit CJ en contrat fournisseur V2 traçable', () => {
    const product = normalizeCjProduct(rawProduct);
    expect(product).toMatchObject({
      schema_version: '2',
      supplier_name: 'CJdropshipping',
      supplier_product_id: rawProduct.id,
      product_name: 'Wireless Headphones',
      supplier_category: 'Consumer Electronics > Audio > Headphones',
      purchase_price: 9.5,
      currency: 'USD',
      image_url: rawProduct.bigImage,
      stock_available: 42,
      min_order_qty: 1,
      supplier_delay_days: 5,
      source_locale: 'en',
    });
    expect(product.description).toBe('Comfortable wireless headset.');
    expect(product.media).toEqual([
      expect.objectContaining({ url: rawProduct.bigImage, role: 'PRODUCT', display_order: 0 }),
    ]);
    expect(product.raw_payload.cj).toEqual(rawProduct);
    expect(product.raw_payload.source_title).toBe(rawProduct.nameEn);
  });

  test('aplatit le format content/productList de listV2', () => {
    expect(flattenProductList({ data: { content: [
      { productList: [{ id: '1' }, { id: '2' }] },
      { productList: [{ id: '3' }] },
    ] } })).toEqual([{ id: '1' }, { id: '2' }, { id: '3' }]);
  });

  test('obtient le token CJ avec la clé API sans exposer la clé dans l URL', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(response({
      code: 200,
      result: true,
      success: true,
      data: { accessToken: 'access-token' },
    }));

    await expect(getAccessToken({ fetchImpl, env: { CJ_API_KEY: 'secret-key' } }))
      .resolves.toBe('access-token');

    const [url, options] = fetchImpl.mock.calls[0];
    expect(String(url)).toMatch(/authentication\/getAccessToken$/);
    expect(String(url)).not.toContain('secret-key');
    expect(JSON.parse(options.body)).toEqual({ apiKey: 'secret-key' });
  });

  test('utilise directement CJ_ACCESS_TOKEN quand il est fourni', async () => {
    const fetchImpl = jest.fn();
    await expect(getAccessToken({ fetchImpl, env: { CJ_ACCESS_TOKEN: 'pre-issued' } }))
      .resolves.toBe('pre-issued');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('construit une recherche listV2 bornée avec description et catégories', () => {
    const url = buildProductListUrl({ keyword: 'headphones', page: 2, size: 63, countryCode: 'cn', startWarehouseInventory: 1, verifiedWarehouse: 1 });
    expect(url.pathname).toMatch(/product\/listV2$/);
    expect(url.searchParams.get('keyWord')).toBe('headphones');
    expect(url.searchParams.get('page')).toBe('2');
    expect(url.searchParams.get('size')).toBe('63');
    expect(url.searchParams.get('countryCode')).toBe('CN');
    expect(url.searchParams.getAll('features')).toEqual(['enable_description', 'enable_category']);
  });

  test('fetchProducts retourne uniquement les produits qui passent le schéma canonique', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(response({
      code: 200,
      result: true,
      success: true,
      data: {
        pageNumber: 1,
        totalRecords: 1,
        content: [{ productList: [rawProduct] }],
      },
      requestId: 'req-1',
    }));

    const result = await fetchProducts({
      fetchImpl,
      env: { CJ_ACCESS_TOKEN: 'token' },
      keyword: 'headphones',
      page: 1,
      size: 20,
    });

    expect(result.products).toHaveLength(1);
    expect(result.invalid).toHaveLength(0);
    expect(result.total).toBe(1);
    expect(result.total_records).toBe(1);
    const [url, options] = fetchImpl.mock.calls[0];
    expect(String(url)).toContain('keyWord=headphones');
    expect(options.headers['CJ-Access-Token']).toBe('token');
  });

  test('propage une erreur CJ avec requestId sans secret', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(response({
      result: false,
      success: false,
      message: 'Authentication failed',
      requestId: 'req-fail',
    }, 401));

    await expect(fetchProducts({ fetchImpl, env: { CJ_ACCESS_TOKEN: 'bad-token' } }))
      .rejects.toThrow(/requestId=req-fail/);
  });
});
