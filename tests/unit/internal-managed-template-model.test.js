'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const {
  productKey,
  internalSku,
  mediaRef,
  buildTemplateModel,
} = require('../../services/suppliers/internal-managed-template-model');

test('M2a — génère les clés système déterministes et incrémentées', () => {
  expect(productKey('KM', 1)).toBe('KM-P-000001');
  expect(productKey('KM', 12)).toBe('KM-P-000012');
  expect(internalSku('KM', 2, 3)).toBe('KM-SKU-000002-003');
  expect(mediaRef(2, 4)).toBe('IMG-000002-004');
});

test('M2a — INTERNAL_STOCK pré-remplit toute la plomberie et laisse le métier vide', () => {
  const model = buildTemplateModel({
    profileId: 'KOMERCE_STOCK_KM_V1',
    supplierName: 'Komerce Stock',
    fulfillmentMode: 'INTERNAL_STOCK',
    prefix: 'KOM-KM',
    defaultCurrency: 'KMF',
    defaultLocale: 'fr-KM',
    productRows: 2,
    unitRowsPerProduct: 2,
    mediaRowsPerProduct: 2,
  });

  expect(model.sheets.PRODUCTS.rows).toHaveLength(2);
  expect(model.sheets.UNITS.rows).toHaveLength(4);
  expect(model.sheets.MEDIA.rows).toHaveLength(4);

  expect(model.sheets.PRODUCTS.rows[0]).toMatchObject({
    source_product_key: 'KOM-KM-P-000001',
    product_name: null,
    currency: 'KMF',
    source_locale: 'fr-KM',
    active: true,
  });

  expect(model.sheets.UNITS.rows[0]).toMatchObject({
    source_product_key: 'KOM-KM-P-000001',
    supplier_sku: 'KOM-KM-SKU-000001-001',
    stock_available: null,
    currency: 'KMF',
    active: true,
  });

  expect(model.sheets.MEDIA.rows[0]).toMatchObject({
    source_product_key: 'KOM-KM-P-000001',
    media_ref: 'IMG-000001-001',
    url: null,
    role: 'PRODUCT',
    display_order: 0,
  });

  expect(model.rules.auto_increment).toEqual({
    source_product_key: true,
    supplier_sku: true,
    media_ref: true,
    display_order: true,
  });
});

test('M2a — SUPPLIER_DIRECT ne fabrique jamais un SKU fournisseur', () => {
  const model = buildTemplateModel({
    profileId: 'GROSSISTE_V1',
    supplierName: 'Grossiste',
    fulfillmentMode: 'SUPPLIER_DIRECT',
    defaultCurrency: 'EUR',
    productRows: 1,
    unitRowsPerProduct: 2,
    mediaRowsPerProduct: 1,
  });

  expect(model.sheets.UNITS.rows.map(row => row.supplier_sku)).toEqual([null, null]);
  expect(model.rules.auto_increment.supplier_sku).toBe(false);
});

test('M2a — distingue explicitement champs système et champs métier', () => {
  const model = buildTemplateModel({
    profileId: 'P',
    supplierName: 'S',
    fulfillmentMode: 'INTERNAL_STOCK',
    productRows: 1,
    unitRowsPerProduct: 1,
    mediaRowsPerProduct: 1,
  });

  const productCols = Object.fromEntries(model.sheets.PRODUCTS.columns.map(col => [col.key, col]));
  expect(productCols.source_product_key).toMatchObject({ owner: 'system', generated: true });
  expect(productCols.product_name).toMatchObject({ owner: 'business', required: true });
  expect(productCols.currency.owner).toBe('profile_or_business');

  const mediaCols = Object.fromEntries(model.sheets.MEDIA.columns.map(col => [col.key, col]));
  expect(mediaCols.media_ref).toMatchObject({ owner: 'system', generated: true });
  expect(mediaCols.url.owner).toBe('business');
});

test.each([
  [{ supplierName: 'S', fulfillmentMode: 'INTERNAL_STOCK' }, 'PROFILE_ID_REQUIRED'],
  [{ profileId: 'P', fulfillmentMode: 'INTERNAL_STOCK' }, 'SUPPLIER_NAME_REQUIRED'],
  [{ profileId: 'P', supplierName: 'S', fulfillmentMode: 'BAD' }, 'FULFILLMENT_MODE_INVALID'],
  [{ profileId: 'P', supplierName: 'S', fulfillmentMode: 'INTERNAL_STOCK', defaultCurrency: 'XYZ' }, 'DEFAULT_CURRENCY_INVALID'],
  [{ profileId: 'P', supplierName: 'S', fulfillmentMode: 'INTERNAL_STOCK', productRows: 0 }, 'PRODUCT_ROWS_INVALID'],
])('M2a fail-closed — %j', (input, code) => {
  expect(() => buildTemplateModel(input)).toThrow(code);
});
