/**
 * @komerce-arch
 * @role          ebay-sandbox-browse-connector-test
 * @domain        catalog
 * @layer         test
 * @criticality   high
 */
'use strict';

const {
  TOKEN_URL,
  normalizeBrowseItem,
  fetchProducts,
} = require('../../services/suppliers/connectors/ebay-connector');
const { resolveSupplierUnit } = require('../../services/suppliers/supplier-order-identity');

const ITEM_ID = 'v1|123456789012|987654321';
const NOW = Date.parse('2026-09-18T17:00:00.000Z');

function raw(overrides = {}) {
  return {
    itemId: ITEM_ID,
    legacyItemId: '123456789012',
    itemGroupId: 'group-123',
    listingMarketplaceId: 'EBAY_US',
    title: 'Komerce eBay Sandbox phone',
    price: { value: '29.90', currency: 'USD' },
    estimatedAvailabilities: [{
      estimatedAvailabilityStatus: 'IN_STOCK',
      estimatedRemainingQuantity: 10,
    }],
    buyingOptions: ['FIXED_PRICE'],
    itemEndDate: '2026-10-18T00:00:00.000Z',
    image: { imageUrl: 'https://i.ebayimg.com/images/g/example/s-l1600.jpg' },
    additionalImages: [
      { imageUrl: 'https://i.ebayimg.com/images/g/example2/s-l1600.jpg' },
    ],
    itemWebUrl: 'https://www.ebay.com/itm/123456789012',
    ...overrides,
  };
}

function env() {
  return {
    EBAY_CLIENT_ID: 'client',
    EBAY_CLIENT_SECRET: 'credential',
    EBAY_ENV: 'sandbox',
    EBAY_MARKETPLACE_ID: 'EBAY_US',
  };
}

function response(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: jest.fn().mockResolvedValue(payload),
  };
}

describe('eBay Browse P2 mapper', () => {
  test('maps exact Browse item to one exact V2 sellable unit and opaque SOI', () => {
    const product = normalizeBrowseItem(raw(), {
      expectedItemId: ITEM_ID,
      marketplaceId: 'EBAY_US',
      now: NOW,
    });

    expect(product).toMatchObject({
      schema_version: '2',
      supplier_name: 'eBay Sandbox',
      supplier_product_id: 'group-123',
      purchase_price: 29.9,
      currency: 'USD',
      stock_available: 10,
      sellable_units: [{
        supplier_sku: 'ebay-sandbox:123456789012:987654321',
        supplier_unit_ref: ITEM_ID,
        supplier_order_identity: {
          provider: 'ebay',
          version: 1,
          payload: {
            environment: 'sandbox',
            marketplace_id: 'EBAY_US',
            item_id: ITEM_ID,
          },
        },
        purchase_price: 29.9,
        currency: 'USD',
        stock_available: 10,
        is_active: true,
      }],
    });

    expect(product.raw_payload.ebay.item).toEqual(raw());
    expect(product.media).toHaveLength(2);

    const resolved = resolveSupplierUnit(
      product,
      product.sellable_units[0].supplier_sku,
      2
    );
    expect(resolved).toMatchObject({
      supplier_product_ref: 'group-123',
      supplier_unit_ref: ITEM_ID,
      quantity: 2,
      stock_available: 10,
      unit_price: 29.9,
      currency: 'USD',
      supplier_order_identity: {
        provider: 'ebay',
        version: 1,
        payload: {
          environment: 'sandbox',
          marketplace_id: 'EBAY_US',
          item_id: ITEM_ID,
        },
      },
    });
  });

  test('fails closed if exact read-back identity differs', () => {
    expect(() => normalizeBrowseItem(raw({ itemId: 'v1|999|0' }), {
      expectedItemId: ITEM_ID,
      marketplaceId: 'EBAY_US',
      now: NOW,
    })).toThrow('EBAY_ITEM_ID_MISMATCH');
  });

  test('fails closed if listing marketplace differs from requested marketplace', () => {
    expect(() => normalizeBrowseItem(raw({ listingMarketplaceId: 'EBAY_FR' }), {
      expectedItemId: ITEM_ID,
      marketplaceId: 'EBAY_US',
      now: NOW,
    })).toThrow('EBAY_LISTING_MARKETPLACE_MISMATCH');
  });

  test('fails closed on native currency outside current canonical money contract', () => {
    expect(() => normalizeBrowseItem(raw({
      listingMarketplaceId: 'EBAY_GB',
      price: { value: '29.90', currency: 'GBP' },
    }), {
      expectedItemId: ITEM_ID,
      marketplaceId: 'EBAY_GB',
      now: NOW,
    })).toThrow('EBAY_CURRENCY_UNSUPPORTED_GBP');
  });

  test('fails closed when actual remaining quantity is not known', () => {
    expect(() => normalizeBrowseItem(raw({
      estimatedAvailabilities: [{
        estimatedAvailabilityStatus: 'IN_STOCK',
      }],
    }), {
      expectedItemId: ITEM_ID,
      marketplaceId: 'EBAY_US',
      now: NOW,
    })).toThrow('EBAY_AVAILABILITY_QUANTITY_REQUIRED');
  });

  test.each([
    ['zero stock', {
      estimatedAvailabilities: [{
        estimatedAvailabilityStatus: 'OUT_OF_STOCK',
        estimatedRemainingQuantity: 0,
      }],
    }],
    ['auction-only', { buyingOptions: ['AUCTION'] }],
    ['expired', { itemEndDate: '2026-09-01T00:00:00.000Z' }],
  ])('keeps exact unit but marks it inactive when %s', (_label, overrides) => {
    const product = normalizeBrowseItem(raw(overrides), {
      expectedItemId: ITEM_ID,
      marketplaceId: 'EBAY_US',
      now: NOW,
    });
    expect(product.sellable_units[0].is_active).toBe(false);
  });

  test('fetchProducts proves OAuth -> bounded search -> exact item -> V2 mapping', async () => {
    const fetchImpl = jest.fn(async (url) => {
      const href = String(url);
      if (href === TOKEN_URL) {
        return response(200, {
          access_token: 'opaque-token',
          token_type: 'Application Access Token',
          expires_in: 7200,
        });
      }
      if (href.includes('/item_summary/search')) {
        expect(href).toContain('q=iphone');
        expect(href).toContain('limit=3');
        return response(200, {
          itemSummaries: [{ itemId: ITEM_ID }],
        });
      }
      if (href.includes('/item/v1%7C123456789012%7C987654321')) {
        return response(200, raw());
      }
      throw new Error(`unexpected URL ${href}`);
    });

    const result = await fetchProducts({
      env: env(),
      fetchImpl,
      keyword: 'iphone',
      size: 3,
      now: NOW,
    });

    expect(result).toMatchObject({
      total: 1,
      source: 'ebay_browse_api',
      invalid: [],
    });
    expect(result.products).toHaveLength(1);
    expect(result.products[0].sellable_units[0].supplier_unit_ref).toBe(ITEM_ID);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  test('provider HTTP failure aborts batch instead of returning an empty snapshot', async () => {
    const fetchImpl = jest.fn(async (url) => {
      if (String(url) === TOKEN_URL) {
        return response(200, { access_token: 'opaque-token' });
      }
      return response(403, { errors: [{ errorId: 1100 }] });
    });

    await expect(fetchProducts({
      env: env(),
      fetchImpl,
      productIds: [ITEM_ID],
      now: NOW,
    })).rejects.toThrow('EBAY_BROWSE_REJECTED_403');
  });
});
