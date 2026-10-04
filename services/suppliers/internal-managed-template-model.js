/**
 * @komerce-arch
 * @role          internal-managed-template-model
 * @domain        catalog
 * @layer         service
 * @criticality   medium
 * @inputs        template profile, business defaults, requested row capacities
 * @outputs       deterministic workbook model with system/business field ownership
 * @depends       none
 * @used-by       future XLSX/CSV template writers (M2b)
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_INTERNAL_MANAGED_CATALOG.md, docs/doctrine/INTERNAL_MANAGED_FILE_CONTRACT_V1.md
 * @impact-areas  catalog, sourcing
 */
'use strict';

const CURRENCIES = Object.freeze(['AED', 'EUR', 'USD', 'KMF', 'PLN']);
const MEDIA_ROLES = Object.freeze(['PRODUCT', 'SCENE', 'DETAIL', 'SIZE_GUIDE', 'OTHER']);
const FULFILLMENT_MODES = Object.freeze(['SUPPLIER_DIRECT', 'INTERNAL_STOCK']);

const PRODUCT_COLUMNS = Object.freeze([
  { key: 'source_product_key', owner: 'system', required: true, generated: true },
  { key: 'product_name', owner: 'business', required: true },
  { key: 'supplier_product_id', owner: 'business', required: false },
  { key: 'supplier_category', owner: 'business', required: false },
  { key: 'description', owner: 'business', required: false },
  { key: 'brand', owner: 'business', required: false },
  { key: 'currency', owner: 'profile_or_business', required: true, validation: { type: 'list', values: CURRENCIES } },
  { key: 'purchase_price', owner: 'business', required: false, validation: { type: 'number', minExclusive: 0 } },
  { key: 'stock_available', owner: 'business', required: false, validation: { type: 'integer', min: 0 } },
  { key: 'weight_kg', owner: 'business', required: false, validation: { type: 'number', minExclusive: 0 } },
  { key: 'dim_l_cm', owner: 'business', required: false, validation: { type: 'number', minExclusive: 0 } },
  { key: 'dim_w_cm', owner: 'business', required: false, validation: { type: 'number', minExclusive: 0 } },
  { key: 'dim_h_cm', owner: 'business', required: false, validation: { type: 'number', minExclusive: 0 } },
  { key: 'source_locale', owner: 'profile_or_business', required: false },
  { key: 'active', owner: 'profile_or_business', required: false, validation: { type: 'list', values: [true, false] } },
]);

const UNIT_COLUMNS = Object.freeze([
  { key: 'source_product_key', owner: 'system', required: true, generated: true },
  { key: 'supplier_sku', owner: 'system_or_business', required: true },
  { key: 'supplier_unit_ref', owner: 'business', required: false },
  { key: 'option_1_name', owner: 'business', required: false },
  { key: 'option_1_value', owner: 'business', required: false },
  { key: 'option_2_name', owner: 'business', required: false },
  { key: 'option_2_value', owner: 'business', required: false },
  { key: 'option_3_name', owner: 'business', required: false },
  { key: 'option_3_value', owner: 'business', required: false },
  { key: 'stock_available', owner: 'business', required: false, validation: { type: 'integer', min: 0 } },
  { key: 'purchase_price', owner: 'business', required: false, validation: { type: 'number', minExclusive: 0 } },
  { key: 'currency', owner: 'profile_or_business', required: false, validation: { type: 'list', values: CURRENCIES } },
  { key: 'active', owner: 'profile_or_business', required: false, validation: { type: 'list', values: [true, false] } },
]);

const MEDIA_COLUMNS = Object.freeze([
  { key: 'source_product_key', owner: 'system', required: true, generated: true },
  { key: 'media_ref', owner: 'system', required: true, generated: true },
  { key: 'url', owner: 'business', required: true },
  { key: 'role', owner: 'profile_or_business', required: true, validation: { type: 'list', values: MEDIA_ROLES } },
  { key: 'option_1_name', owner: 'business', required: false },
  { key: 'option_1_value', owner: 'business', required: false },
  { key: 'option_2_name', owner: 'business', required: false },
  { key: 'option_2_value', owner: 'business', required: false },
  { key: 'display_order', owner: 'system', required: true, generated: true },
]);

function pad(n, size = 6) {
  return String(n).padStart(size, '0');
}

function assertPositiveInt(value, name) {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name}_INVALID`);
}

function normalizePrefix(value, fallback) {
  const raw = String(value || fallback).trim().toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (!raw) throw new Error('TEMPLATE_PREFIX_INVALID');
  return raw.slice(0, 24);
}

function productKey(prefix, n) {
  assertPositiveInt(n, 'PRODUCT_SEQUENCE');
  return `${normalizePrefix(prefix, 'KOM')}-P-${pad(n)}`;
}

function internalSku(prefix, productSeq, unitSeq) {
  assertPositiveInt(productSeq, 'PRODUCT_SEQUENCE');
  assertPositiveInt(unitSeq, 'UNIT_SEQUENCE');
  return `${normalizePrefix(prefix, 'KOM')}-SKU-${pad(productSeq)}-${pad(unitSeq, 3)}`;
}

function mediaRef(productSeq, mediaSeq) {
  assertPositiveInt(productSeq, 'PRODUCT_SEQUENCE');
  assertPositiveInt(mediaSeq, 'MEDIA_SEQUENCE');
  return `IMG-${pad(productSeq)}-${pad(mediaSeq, 3)}`;
}

function buildTemplateModel({
  profileId,
  supplierName,
  fulfillmentMode,
  prefix = 'KOM',
  defaultCurrency = null,
  defaultLocale = null,
  productRows = 50,
  unitRowsPerProduct = 5,
  mediaRowsPerProduct = 5,
} = {}) {
  if (!profileId || !String(profileId).trim()) throw new Error('PROFILE_ID_REQUIRED');
  if (!supplierName || !String(supplierName).trim()) throw new Error('SUPPLIER_NAME_REQUIRED');
  if (!FULFILLMENT_MODES.includes(fulfillmentMode)) throw new Error('FULFILLMENT_MODE_INVALID');
  if (defaultCurrency != null && !CURRENCIES.includes(defaultCurrency)) throw new Error('DEFAULT_CURRENCY_INVALID');
  assertPositiveInt(productRows, 'PRODUCT_ROWS');
  assertPositiveInt(unitRowsPerProduct, 'UNIT_ROWS_PER_PRODUCT');
  assertPositiveInt(mediaRowsPerProduct, 'MEDIA_ROWS_PER_PRODUCT');

  const pfx = normalizePrefix(prefix, 'KOM');
  const productSeedRows = [];
  const unitSeedRows = [];
  const mediaSeedRows = [];

  for (let p = 1; p <= productRows; p += 1) {
    const sourceProductKey = productKey(pfx, p);
    productSeedRows.push({
      source_product_key: sourceProductKey,
      product_name: null,
      supplier_product_id: null,
      supplier_category: null,
      description: null,
      brand: null,
      currency: defaultCurrency,
      purchase_price: null,
      stock_available: null,
      weight_kg: null,
      dim_l_cm: null,
      dim_w_cm: null,
      dim_h_cm: null,
      source_locale: defaultLocale,
      active: true,
    });

    for (let u = 1; u <= unitRowsPerProduct; u += 1) {
      unitSeedRows.push({
        source_product_key: sourceProductKey,
        supplier_sku: fulfillmentMode === 'INTERNAL_STOCK' ? internalSku(pfx, p, u) : null,
        supplier_unit_ref: null,
        option_1_name: null,
        option_1_value: null,
        option_2_name: null,
        option_2_value: null,
        option_3_name: null,
        option_3_value: null,
        stock_available: null,
        purchase_price: null,
        currency: defaultCurrency,
        active: true,
      });
    }

    for (let m = 1; m <= mediaRowsPerProduct; m += 1) {
      mediaSeedRows.push({
        source_product_key: sourceProductKey,
        media_ref: mediaRef(p, m),
        url: null,
        role: 'PRODUCT',
        option_1_name: null,
        option_1_value: null,
        option_2_name: null,
        option_2_value: null,
        display_order: m - 1,
      });
    }
  }

  return {
    template_version: 1,
    profile: {
      profile_id: String(profileId),
      supplier_name: String(supplierName),
      fulfillment_mode: fulfillmentMode,
      prefix: pfx,
      default_currency: defaultCurrency,
      default_locale: defaultLocale,
    },
    rules: {
      system_fields_locked: true,
      business_fields_editable: true,
      auto_increment: {
        source_product_key: true,
        supplier_sku: fulfillmentMode === 'INTERNAL_STOCK',
        media_ref: true,
        display_order: true,
      },
      note: 'Tout ce que Komerce peut déterminer sans ambiguïté est généré. L humain ne saisit que les faits métier.',
    },
    sheets: {
      README: {
        kind: 'instructions',
        rows: [
          ['Règle', 'Valeur'],
          ['Profil', String(profileId)],
          ['Fournisseur', String(supplierName)],
          ['Fulfillment', fulfillmentMode],
          ['Clés système', 'Ne pas modifier'],
          ['Champs métier', 'Renseigner uniquement les faits connus'],
          ['Stock vide', 'UNKNOWN — ne pas remplacer par 0'],
          ['Stock 0', 'Indisponible explicitement'],
          ['Réimport', 'Les clés système assurent l idempotence'],
        ],
      },
      PRODUCTS: { columns: PRODUCT_COLUMNS, rows: productSeedRows },
      UNITS: { columns: UNIT_COLUMNS, rows: unitSeedRows },
      MEDIA: { columns: MEDIA_COLUMNS, rows: mediaSeedRows },
    },
  };
}

module.exports = {
  CURRENCIES,
  MEDIA_ROLES,
  FULFILLMENT_MODES,
  PRODUCT_COLUMNS,
  UNIT_COLUMNS,
  MEDIA_COLUMNS,
  productKey,
  internalSku,
  mediaRef,
  buildTemplateModel,
};
