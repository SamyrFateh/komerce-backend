'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const { validateNormalizedProduct } = require('../../services/suppliers/normalized-product');
const scanner = require('../../services/supplier-catalog-scanner');
const {
  BASE_URL,
  isConfigured,
  inactiveReason,
  formatTopTimestamp,
  buildTopRequest,
  extractProductId,
  normalizeDsProduct,
  flattenFeedProducts,
  fetchProducts,
} = require('../../services/suppliers/connectors/aliexpress-connector');

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

const feedProduct = {
  product_id: '4000102715995',
  product_title: 'Wireless Mini Speaker',
  product_detail_url: 'https://www.aliexpress.com/item/4000102715995.html',
  product_main_image_url: 'https://ae01.alicdn.com/kf/main.jpg',
  product_small_image_urls: {
    string: [
      'https://ae01.alicdn.com/kf/side-1.jpg',
      'https://ae01.alicdn.com/kf/side-2.jpg',
    ],
  },
  target_sale_price: '9.90',
  target_sale_price_currency: 'USD',
  first_level_category_name: 'Consumer Electronics',
  second_level_category_name: 'Portable Audio',
};

const detailResult = {
  result: {
    ae_item_base_info_dto: {
      product_id: '4000102715995',
      subject: 'Wireless Mini Speaker',
      currency_code: 'USD',
      product_status_type: 'onSelling',
      category_id: 200003482,
      detail: '<p>Compact <strong>Bluetooth</strong> speaker.</p>',
    },
    ae_item_sku_info_dtos: {
      ae_item_sku_info_d_t_o: [
        {
          id: 'sku-black-s',
          sku_code: 'AE-SPK-BLK-S',
          sku_available_stock: 12,
          offer_sale_price: '9.90',
          sku_price: '12.00',
          currency_code: 'USD',
          ae_sku_property_dtos: {
            ae_sku_property_d_t_o: [
              {
                sku_property_id: 14,
                sku_property_name: 'Color',
                sku_property_value: '14:193',
                property_value_definition_name: 'Black',
                sku_image: 'https://ae01.alicdn.com/kf/black.jpg',
              },
              {
                sku_property_id: 5,
                sku_property_name: 'Size',
                sku_property_value: '100014064',
                property_value_definition_name: 'S',
              },
            ],
          },
        },
        {
          id: 'sku-white-m',
          sku_code: 'AE-SPK-WHT-M',
          sku_available_stock: 8,
          offer_sale_price: '10.50',
          sku_price: '13.00',
          currency_code: 'USD',
          ae_sku_property_dtos: {
            ae_sku_property_d_t_o: [
              {
                sku_property_id: 14,
                sku_property_name: 'Color',
                sku_property_value: '14:29',
                property_value_definition_name: 'White',
                sku_image: 'https://ae01.alicdn.com/kf/white.jpg',
              },
              {
                sku_property_id: 5,
                sku_property_name: 'Size',
                sku_property_value: '361386',
                property_value_definition_name: 'M',
              },
            ],
          },
        },
      ],
    },
    ae_multimedia_info_dto: {
      image_urls: 'https://ae01.alicdn.com/kf/main.jpg;https://ae01.alicdn.com/kf/detail.jpg',
    },
    package_info_dto: {
      gross_weight: '0.42',
      package_length: '12',
      package_width: '10',
      package_height: '8',
    },
    logistics_info_dto: {
      delivery_time: 7,
      ship_to_country: 'KM',
    },
    ae_item_properties: {
      ae_item_property: [
        {
          attr_name_id: 1001,
          attr_name: 'Bluetooth version',
          attr_value: '5.3',
        },
      ],
    },
  },
};

const credentials = {
  ALIEXPRESS_APP_KEY: 'app-key',
  ALIEXPRESS_APP_SECRET: 'app-secret',
  ALIEXPRESS_SESSION: 'session-token',
};

describe('aliexpress-connector', () => {
  test('reste fail-closed sans les trois credentials officiels', () => {
    expect(isConfigured({})).toBe(false);
    expect(isConfigured({ ALIEXPRESS_APP_KEY: 'key' })).toBe(false);
    expect(isConfigured(credentials)).toBe(true);
    expect(inactiveReason({})).toMatch(/ALIEXPRESS_APP_KEY/);
  });

  test('signe une requête Open Platform /sync en SHA-256 sans exposer le secret', () => {
    const now = new Date('2026-09-12T00:00:00.000Z');
    expect(BASE_URL).toBe('https://api-sg.aliexpress.com/sync');
    expect(formatTopTimestamp(now)).toBe(String(now.getTime()));

    const query = buildTopRequest('aliexpress.ds.product.get', {
      product_id: '4000102715995',
      target_currency: 'USD',
    }, { env: credentials, now });

    expect(query.get('method')).toBe('aliexpress.ds.product.get');
    expect(query.get('app_key')).toBe('app-key');
    expect(query.get('session')).toBe('session-token');
    expect(query.get('simplify')).toBe('true');
    expect(query.get('sign_method')).toBe('sha256');
    expect(query.get('sign')).toMatch(/^[A-F0-9]{64}$/);
    expect(query.toString()).not.toContain('app-secret');
  });

  test('extrait un product id depuis un id brut ou une URL AliExpress', () => {
    expect(extractProductId('4000102715995')).toBe('4000102715995');
    expect(extractProductId('https://www.aliexpress.com/item/4000102715995.html?spm=abc'))
      .toBe('4000102715995');
    expect(extractProductId('not-a-product')).toBeNull();
  });

  test('normalise les médias, axes et SKU AliExpress en contrat V2 valide', () => {
    const product = normalizeDsProduct(detailResult, feedProduct);
    const verdict = validateNormalizedProduct(product);

    expect(verdict).toEqual({ valid: true, errors: [] });
    expect(product).toMatchObject({
      schema_version: '2',
      supplier_name: 'AliExpress',
      supplier_product_id: '4000102715995',
      product_name: 'Wireless Mini Speaker',
      supplier_category: 'Consumer Electronics > Portable Audio',
      purchase_price: 9.9,
      currency: 'USD',
      stock_available: 20,
      weight_kg: 0.42,
      dimensions: { l_cm: 12, w_cm: 10, h_cm: 8 },
    });
    expect(product.description).toBe('Compact Bluetooth speaker.');
    expect(product.option_axes).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'p_14', display_name: 'Color', values: ['Black', 'White'] }),
      expect.objectContaining({ key: 'p_5', display_name: 'Size', values: ['S', 'M'] }),
    ]));
    expect(product.sellable_units).toEqual(expect.arrayContaining([
      expect.objectContaining({
        supplier_sku: 'AE-SPK-BLK-S',
        option_values: { p_14: 'Black', p_5: 'S' },
        stock_available: 12,
        purchase_price: 9.9,
        currency: 'USD',
      }),
      expect.objectContaining({
        supplier_sku: 'AE-SPK-WHT-M',
        option_values: { p_14: 'White', p_5: 'M' },
        stock_available: 8,
        purchase_price: 10.5,
        currency: 'USD',
      }),
    ]));
    expect(product.media.length).toBeGreaterThanOrEqual(4);
    expect(product.raw_payload.aliexpress).toEqual({ feed: feedProduct, detail: detailResult.result });
  });

  test('le produit AliExpress traverse la vraie normalisation de la Raffinerie', async () => {
    const product = normalizeDsProduct(detailResult, feedProduct);
    const config = {
      finance: {
        taux_change_eur_kmf: 492,
        taux_aed_kmf: 138,
        target_marge_brute_pct: 40,
      },
      categories: {
        electronique: {
          key: 'electronique',
          default_weight_kg: 1,
          default_margin_pct: 35,
        },
        autre: {
          key: 'autre',
          default_weight_kg: 0.5,
          default_margin_pct: 40,
        },
      },
    };

    const refined = await scanner.normalizeCandidate(product, { config });

    expect(refined).toMatchObject({
      supplier_name: 'AliExpress',
      supplier_product_id: '4000102715995',
      product_name: 'Wireless Mini Speaker',
      komerce_category: 'electronique',
      purchase_price: 9.9,
      currency: 'USD',
      estimated_weight_kg: 0.42,
    });
    expect(refined.purchase_price_kmf).toBeGreaterThan(0);
    expect(refined.data_sources.purchase_price).toBe('supplier');
    expect(refined.data_sources.weight).toBe('supplier');
  });

  test('aplatit le feed DS officiel', () => {
    expect(flattenFeedProducts({
      result: {
        products: {
          integer: [{ product_id: 1 }, { product_id: 2 }],
        },
      },
    })).toEqual([{ product_id: 1 }, { product_id: 2 }]);
  });

  test('fetchProducts utilise /sync puis partitionne un lot real-shaped entre accepté et rejeté', async () => {
    const badDetail = JSON.parse(JSON.stringify(detailResult));
    badDetail.result.ae_item_base_info_dto.product_id = '4000102715996';
    badDetail.result.ae_item_base_info_dto.subject = '';

    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(response({
        aliexpress_ds_recommend_feed_get_response: {
          result: {
            current_page_no: 1,
            total_record_count: 2,
            products: {
              integer: [
                feedProduct,
                { ...feedProduct, product_id: '4000102715996', product_title: '' },
              ],
            },
          },
        },
      }))
      .mockResolvedValueOnce(response({
        aliexpress_ds_product_get_response: detailResult,
      }))
      .mockResolvedValueOnce(response({
        aliexpress_ds_product_get_response: badDetail,
      }));

    const result = await fetchProducts({
      fetchImpl,
      env: credentials,
      countryCode: 'AE',
      page: 1,
      size: 2,
    });

    expect(result.total).toBe(2);
    expect(result.products).toHaveLength(1);
    expect(result.invalid).toHaveLength(1);
    expect(result.products[0].supplier_product_id).toBe('4000102715995');
    expect(result.invalid[0].errors.join(' ')).toMatch(/product_name/);
    expect(fetchImpl).toHaveBeenCalledTimes(3);

    for (const [rawUrl, init] of fetchImpl.mock.calls) {
      const url = new URL(rawUrl);
      expect(url.origin + url.pathname).toBe('https://api-sg.aliexpress.com/sync');
      expect(url.searchParams.get('sign_method')).toBe('sha256');
      expect(url.searchParams.get('sign')).toMatch(/^[A-F0-9]{64}$/);
      expect(url.toString()).not.toContain('app-secret');
      expect(init.method).toBe('POST');
      expect(init.body).toBeUndefined();
    }
    const detailUrls = fetchImpl.mock.calls.slice(1).map(([rawUrl]) => new URL(rawUrl));
    expect(detailUrls.every((url) => url.searchParams.get('ship_to_country') === 'AE')).toBe(true);
  });
});

describe('aliexpress-connected-connector credential hygiene', () => {
  test('normalise les credentials Railway avant toute signature TOP', () => {
    const connected = require('../../services/suppliers/connectors/aliexpress-connected-connector');
    const normalized = connected.normalizedRuntimeEnv({
      ALIEXPRESS_APP_KEY: '  app-key\n',
      ALIEXPRESS_APP_SECRET: 'app-secret\r\n',
      ALIEXPRESS_SESSION: '  session-token\n',
      ALIEXPRESS_TOKEN_ENCRYPTION_KEY: 'keep-as-is',
    });

    expect(normalized).toMatchObject({
      ALIEXPRESS_APP_KEY: 'app-key',
      ALIEXPRESS_APP_SECRET: 'app-secret',
      ALIEXPRESS_SESSION: 'session-token',
      ALIEXPRESS_TOKEN_ENCRYPTION_KEY: 'keep-as-is',
    });
    expect(connected.isRuntimeConfigured(normalized)).toBe(true);
  });
});