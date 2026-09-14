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
  buildCommandableStructure,
  flattenProductList,
  getAccessToken,
  buildProductListUrl,
  fetchProducts,
  resetTokenCacheForTests,
  DEFAULT_DETAIL_DELAY_MS,
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

const rawDetail = {
  pid: '1369601676230660096',
  productNameEn: 'Motorcycle Riding Gloves',
  productSku: 'CJNS1037469',
  bigImage: 'https://cf.cjdropshipping.com/product/gloves.jpg',
  productImageSet: ['https://cf.cjdropshipping.com/product/gloves-2.jpg'],
  sellPrice: '6.60-8.10',
  categoryName: 'Sports > Motorcycle > Gloves',
  productKeyEn: 'Color-Size',
  productWeight: 170,
  description: '<p>Outdoor riding gloves</p>',
  variants: [
    {
      vid: '1369601677723832320',
      pid: '1369601676230660096',
      variantNameEn: 'Camouflage S',
      variantImage: 'https://cf.cjdropshipping.com/product/gloves-camo.jpg',
      variantSku: 'CJNS103746901AZ',
      variantKey: 'Camouflage-S',
      variantSellPrice: 6.6,
      variantWeight: 170,
      inventories: [
        { countryCode: 'CN', totalInventory: 40000, cjInventory: 0, factoryInventory: 40000 },
      ],
    },
    {
      vid: '1369601677795135488',
      pid: '1369601676230660096',
      variantNameEn: 'Camouflage M',
      variantSku: 'CJNS103746902BY',
      variantKey: 'Camouflage-M',
      variantSellPrice: 6.6,
      inventories: [
        { countryCode: 'CN', totalInventory: 25, cjInventory: 25, factoryInventory: 0 },
        { countryCode: 'US', totalInventory: 5, cjInventory: 5, factoryInventory: 0 },
      ],
    },
  ],
};

describe('cj-connector', () => {
  beforeEach(() => resetTokenCacheForTests());

  test('reste inactif sans credential et accepte API key ou access token', () => {
    expect(isConfigured({})).toBe(false);
    expect(inactiveReason({})).toMatch(/CJ_API_KEY/);
    expect(isConfigured({ CJ_API_KEY: 'key' })).toBe(true);
    expect(isConfigured({ CJ_ACCESS_TOKEN: 'token' })).toBe(true);
  });

  test('normalise un produit CJ de discovery en contrat fournisseur V2 traçable', () => {
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
      sellable_units: null,
    });
    expect(product.description).toBe('Comfortable wireless headset.');
    expect(product.media).toEqual([
      expect.objectContaining({ url: rawProduct.bigImage, role: 'PRODUCT', display_order: 0 }),
    ]);
    expect(product.raw_payload.cj).toEqual(rawProduct);
    expect(product.raw_payload.source_title).toBe(rawProduct.nameEn);
  });

  test('produit une unité commandable déterministe par VID sans heuristique', () => {
    const structure = buildCommandableStructure(rawDetail);
    expect(structure.sellable_units).toHaveLength(2);
    expect(structure.option_axes).toEqual(expect.arrayContaining([
      expect.objectContaining({ display_name: 'Color', values: ['Camouflage'] }),
      expect.objectContaining({ display_name: 'Size', values: ['S', 'M'] }),
    ]));
    expect(structure.sellable_units[0]).toMatchObject({
      supplier_sku: 'CJNS103746901AZ',
      supplier_unit_ref: '1369601677723832320',
      supplier_order_identity: {
        provider: 'cj',
        version: 1,
        payload: {
          pid: '1369601676230660096',
          vid: '1369601677723832320',
          variant_sku: 'CJNS103746901AZ',
        },
      },
      stock_available: 40000,
      purchase_price: 6.6,
      currency: 'USD',
      is_active: true,
    });
    expect(structure.sellable_units[1].stock_available).toBe(30);
  });

  test('remappe un média variante dupliqué vers un supplier_media_id réellement présent', () => {
    const duplicateImageDetail = {
      ...rawDetail,
      bigImage: rawDetail.variants[0].variantImage,
      productImageSet: [rawDetail.variants[0].variantImage],
    };
    const product = normalizeCjProduct(duplicateImageDetail);
    const knownMediaIds = new Set((product.media || []).map((item) => item.supplier_media_id).filter(Boolean));
    const refs = (product.sellable_units || []).flatMap((unit) => unit.media_refs || []);

    expect(product.media.filter((item) => item.url === rawDetail.variants[0].variantImage)).toHaveLength(1);
    expect(product.sellable_units[0].media_refs).toEqual([`${rawDetail.pid}:hero`]);
    expect(refs.length).toBeGreaterThan(0);
    expect(refs.every((ref) => knownMediaIds.has(ref))).toBe(true);
  });

  test('normalise le détail CJ en V2 commandable avec prix et stock agrégés depuis les variantes', () => {
    const product = normalizeCjProduct(rawDetail);
    expect(product.supplier_product_id).toBe(rawDetail.pid);
    expect(product.purchase_price).toBe(6.6);
    expect(product.stock_available).toBe(40030);
    expect(product.weight_kg).toBeCloseTo(0.17);
    expect(product.sellable_units).toHaveLength(2);
    expect(product.sellable_units.every((unit) => unit.supplier_order_identity?.provider === 'cj')).toBe(true);
    expect(product.media.length).toBeGreaterThanOrEqual(2);
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

  test('fetchProducts discovery reste léger et ne demande pas les détails variante par défaut', async () => {
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
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, options] = fetchImpl.mock.calls[0];
    expect(String(url)).toContain('keyWord=headphones');
    expect(options.headers['CJ-Access-Token']).toBe('token');
  });

  test('fetchProducts ciblé résout directement PID → variantes commandables + SOI', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(response({
      code: 200,
      result: true,
      success: true,
      data: rawDetail,
      requestId: 'req-detail-1',
    }));

    const result = await fetchProducts({
      fetchImpl,
      env: { CJ_ACCESS_TOKEN: 'token' },
      productIds: [rawDetail.pid],
    });

    expect(result.products).toHaveLength(1);
    expect(result.invalid).toHaveLength(0);
    expect(result.source).toBe('cj_api_v2_product_query');
    expect(result.products[0].sellable_units).toHaveLength(2);
    expect(result.products[0].sellable_units[0].supplier_unit_ref).toBe('1369601677723832320');
    expect(result.products[0].sellable_units[0].supplier_order_identity.payload.vid).toBe('1369601677723832320');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url] = fetchImpl.mock.calls[0];
    expect(String(url)).toContain('/product/query?pid=1369601676230660096');
  });

  test('cadence les détails ciblés séquentiellement pour respecter la limite CJ 1 QPS', async () => {
    const sleepImpl = jest.fn().mockResolvedValue(undefined);
    const fetchImpl = jest.fn().mockImplementation(async (url) => {
      const pid = new URL(String(url)).searchParams.get('pid');
      return response({
        code: 200,
        result: true,
        success: true,
        data: { ...rawDetail, pid },
        requestId: `req-${pid}`,
      });
    });
    const productIds = ['1369601676230660096', '1369601676230660097', '1369601676230660098'];

    const result = await fetchProducts({
      fetchImpl,
      sleepImpl,
      env: { CJ_ACCESS_TOKEN: 'token' },
      productIds,
    });

    expect(result.products).toHaveLength(3);
    expect(result.invalid).toHaveLength(0);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleepImpl).toHaveBeenCalledTimes(2);
    expect(sleepImpl).toHaveBeenNthCalledWith(1, DEFAULT_DETAIL_DELAY_MS);
    expect(sleepImpl).toHaveBeenNthCalledWith(2, DEFAULT_DETAIL_DELAY_MS);
  });

  test('retente localement un détail CJ en 429 sans paralléliser le core', async () => {
    const sleepImpl = jest.fn().mockResolvedValue(undefined);
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(response({
        result: false,
        success: false,
        message: 'Too Many Requests, QPS limit is 1 time/1second',
        requestId: 'req-429',
      }, 429))
      .mockResolvedValueOnce(response({
        code: 200,
        result: true,
        success: true,
        data: rawDetail,
        requestId: 'req-ok',
      }));

    const result = await fetchProducts({
      fetchImpl,
      sleepImpl,
      env: { CJ_ACCESS_TOKEN: 'token' },
      productIds: [rawDetail.pid],
    });

    expect(result.products).toHaveLength(1);
    expect(result.invalid).toHaveLength(0);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleepImpl).toHaveBeenCalledTimes(1);
    expect(sleepImpl).toHaveBeenCalledWith(DEFAULT_DETAIL_DELAY_MS);
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
