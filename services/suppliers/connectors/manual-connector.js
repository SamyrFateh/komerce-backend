/**
 * @komerce-arch
 * @role          manual-connector
 * @domain        catalog
 * @layer         service
 * @criticality   medium
 * @inputs        manual_supplier_product_payload
 * @outputs       normalized_supplier_product_v1_or_v2
 * @depends       services/suppliers/connectors/_connector-utils.js, services/suppliers/normalized-product.js
 * @used-by       routes/sourcing-scanner.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_INGESTION_CATALOGUE.md, docs/doctrine/DOCTRINE_PRODUCT_DETAIL_CONTRACT.md
 * @impact-areas  catalog, product-discovery, product-detail
 * @version       2026-07
 */

/**
 * KOMERCE — Manual Connector
 * ═══════════════════════════════════════════════════════════════════
 *
 * Une saisie plate continue de produire un contrat V1 compatible.
 *
 * Si l'entrée porte explicitement une structure riche (`media`, `option_axes`,
 * `sellable_units`, `source_locale`) et ne fixe pas elle-même une version, le
 * connecteur la place en V2. Il PRÉSERVE ces faits tels quels et laisse le
 * contrat versionné les valider : aucune matrice SKU ni association média n'est
 * reconstruite ici.
 */

'use strict';

const { partitionValid } = require('../normalized-product');
const { parseStrictNumber, parseStrictInteger, parsePositiveDimension } = require('./_connector-utils');

const V2_FIELDS = Object.freeze(['source_locale', 'media', 'option_axes', 'sellable_units']);

function cloneJsonValue(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

/**
 * Normalise un item de formulaire en NormalizedSupplierProduct.
 * Les erreurs de parsing scalar sont routées en invalid via `_connectorErrors`.
 */
function normalizeFormItem(item, supplierName) {
  const errors = [];

  function numField(field, label) {
    const r = parseStrictNumber(item[field]);
    if (r.invalid) errors.push(`${label} invalide : "${item[field]}"`);
    return r.value != null ? r.value : null;
  }
  function intField(field, label) {
    const r = parseStrictInteger(item[field]);
    if (r.invalid) errors.push(`${label} invalide : "${item[field]}"`);
    return r.value != null ? r.value : null;
  }

  const purchasePrice = numField('purchase_price', 'purchase_price');
  const stockAvailable = intField('stock_available', 'stock_available');
  const minOrderQty = intField('min_order_qty', 'min_order_qty');
  const supplierDelayDays = intField('supplier_delay_days', 'supplier_delay_days');
  const weightKg = numField('weight_kg', 'weight_kg');

  const dimSource = item.dimensions && typeof item.dimensions === 'object'
    ? item.dimensions
    : { l_cm: item.dim_l_cm, w_cm: item.dim_w_cm, h_cm: item.dim_h_cm };

  const dimensions = {};
  for (const key of ['l_cm', 'w_cm', 'h_cm']) {
    const r = parsePositiveDimension(dimSource[key]);
    if (r.invalid) errors.push(`dimensions.${key} invalide : "${dimSource[key]}"`);
    else if (r.value !== undefined) dimensions[key] = r.value;
  }
  const finalDimensions = Object.keys(dimensions).length ? dimensions : null;

  const currency = item.currency ? String(item.currency).toUpperCase() : null;
  const explicitVersion = item.schema_version == null || item.schema_version === ''
    ? null
    : String(item.schema_version);
  const hasRichStructure = V2_FIELDS.some((field) =>
    Object.prototype.hasOwnProperty.call(item, field)
  );

  const obj = {
    supplier_name: supplierName,
    supplier_product_id: item.supplier_product_id || null,
    product_name: (item.product_name || '').trim(),
    supplier_category: item.supplier_category || null,
    purchase_price: purchasePrice,
    currency,
    image_url: item.image_url || null,
    product_url: item.product_url || null,
    description: item.description || null,
    stock_available: stockAvailable,
    min_order_qty: minOrderQty,
    supplier_delay_days: supplierDelayDays,
    weight_kg: weightKg,
    dimensions: finalDimensions,
    raw_payload: { ...item },
  };

  // Version explicite gagnante : un payload qui annonce v1 mais contient des
  // champs v2 doit être rejeté par le schéma v1, pas promu silencieusement.
  if (explicitVersion) obj.schema_version = explicitVersion;
  else if (hasRichStructure) obj.schema_version = '2';

  // Préserver les structures riches sans interprétation. Le schéma V2 et les
  // invariants référentiels de normalized-product.js sont les seuls juges.
  if (hasRichStructure) {
    for (const field of V2_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(item, field)) {
        obj[field] = cloneJsonValue(item[field]);
      }
    }
  }

  if (errors.length) {
    Object.defineProperty(obj, '_connectorErrors', {
      value: errors,
      enumerable: false,
    });
  }

  return obj;
}

/**
 * Transforme une liste d'items du formulaire en NormalizedSupplierProduct[].
 */
function fetchProducts(input) {
  const supplierName = (input?.supplier_name || '').trim();
  if (!supplierName) throw new Error('supplier_name requis');
  if (!Array.isArray(input.items) || !input.items.length) {
    throw new Error('items requis (tableau non vide)');
  }

  const normalized = input.items.map((item) => normalizeFormItem(item, supplierName));
  const connectorInvalid = [];
  const toValidate = [];

  for (const product of normalized) {
    if (product._connectorErrors && product._connectorErrors.length) {
      connectorInvalid.push({ product: { ...product }, errors: product._connectorErrors });
    } else {
      toValidate.push(product);
    }
  }

  const { valid, invalid: schemaInvalid } = partitionValid(toValidate);
  return {
    products: valid,
    invalid: [...connectorInvalid, ...schemaInvalid],
    total: normalized.length,
  };
}

module.exports = {
  fetchProducts,
  normalizeFormItem,
};
