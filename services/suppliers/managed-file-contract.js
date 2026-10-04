/**
 * @komerce-arch
 * @role          managed-catalog-file-contract
 * @domain        catalog
 * @layer         service
 * @criticality   high
 * @inputs        parsed CSV/XLSX logical bundle
 * @outputs       validated ManagedCatalogFileBundle.v1 or explicit errors
 * @depends       ajv, ajv-formats, schemas/catalog/managed-catalog-file-bundle.v1.schema.json
 * @used-by       future CSV/XLSX adapters (M2), tests
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_INTERNAL_MANAGED_CATALOG.md, docs/doctrine/INTERNAL_MANAGED_FILE_CONTRACT_V1.md
 * @impact-areas  catalog, sourcing
 */
'use strict';

const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const schema = require('../../schemas/catalog/managed-catalog-file-bundle.v1.schema.json');

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validateShape = ajv.compile(schema);

function comboKey(optionValues) {
  return Object.entries(optionValues || {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('|');
}

function sameKeys(a, b) {
  const aa = Object.keys(a || {}).sort();
  const bb = Object.keys(b || {}).sort();
  return aa.length === bb.length && aa.every((key, index) => key === bb[index]);
}

function validateManagedFileBundle(bundle) {
  const errors = [];

  if (!validateShape(bundle)) {
    for (const error of validateShape.errors || []) {
      errors.push(`SCHEMA:${error.instancePath || '/'}:${error.keyword}`);
    }
    return { valid: false, errors };
  }

  const products = new Map();
  for (const product of bundle.products) {
    if (products.has(product.source_product_key)) {
      errors.push(`DUPLICATE_SOURCE_PRODUCT_KEY:${product.source_product_key}`);
      continue;
    }
    products.set(product.source_product_key, product);
  }

  const skuSeen = new Set();
  const unitsByProduct = new Map();
  const comboSeenByProduct = new Map();

  for (const unit of bundle.units) {
    if (!products.has(unit.source_product_key)) {
      errors.push(`ORPHAN_UNIT:${unit.source_product_key}:${unit.supplier_sku}`);
      continue;
    }

    if (skuSeen.has(unit.supplier_sku)) {
      errors.push(`DUPLICATE_SUPPLIER_SKU:${unit.supplier_sku}`);
    }
    skuSeen.add(unit.supplier_sku);

    const list = unitsByProduct.get(unit.source_product_key) || [];
    if (list.length && !sameKeys(list[0].option_values, unit.option_values)) {
      errors.push(`INCONSISTENT_OPTION_AXES:${unit.source_product_key}:${unit.supplier_sku}`);
    }
    list.push(unit);
    unitsByProduct.set(unit.source_product_key, list);

    const combo = comboKey(unit.option_values);
    const seenCombos = comboSeenByProduct.get(unit.source_product_key) || new Set();
    if (seenCombos.has(combo)) {
      errors.push(`DUPLICATE_OPTION_COMBINATION:${unit.source_product_key}:${combo || '<none>'}`);
    }
    seenCombos.add(combo);
    comboSeenByProduct.set(unit.source_product_key, seenCombos);
  }

  const mediaRefsByProduct = new Map();
  for (const media of bundle.media) {
    if (!products.has(media.source_product_key)) {
      errors.push(`ORPHAN_MEDIA:${media.source_product_key}:${media.media_ref}`);
      continue;
    }

    const refs = mediaRefsByProduct.get(media.source_product_key) || new Set();
    if (refs.has(media.media_ref)) {
      errors.push(`DUPLICATE_MEDIA_REF:${media.source_product_key}:${media.media_ref}`);
    }
    refs.add(media.media_ref);
    mediaRefsByProduct.set(media.source_product_key, refs);

    if (media.option_values && Object.keys(media.option_values).length) {
      const units = unitsByProduct.get(media.source_product_key) || [];
      if (!units.length) {
        errors.push(`MEDIA_OPTIONS_WITHOUT_UNITS:${media.source_product_key}:${media.media_ref}`);
        continue;
      }
      for (const [axis, value] of Object.entries(media.option_values)) {
        const known = units.some(unit => unit.option_values?.[axis] === value);
        if (!known) {
          errors.push(`MEDIA_OPTION_UNKNOWN:${media.source_product_key}:${media.media_ref}:${axis}=${value}`);
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

function assertManagedFileBundle(bundle) {
  const verdict = validateManagedFileBundle(bundle);
  if (!verdict.valid) {
    const error = new Error(`MANAGED_FILE_CONTRACT_INVALID: ${verdict.errors.join(' ; ')}`);
    error.code = 'MANAGED_FILE_CONTRACT_INVALID';
    error.details = verdict.errors;
    throw error;
  }
  return bundle;
}

module.exports = {
  validateManagedFileBundle,
  assertManagedFileBundle,
  comboKey,
  sameKeys,
};
