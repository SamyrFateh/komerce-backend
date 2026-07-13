/**
 * @komerce-arch
 * @role          catalog-normalized-product
 * @domain        catalog
 * @layer         service
 * @criticality   high
 * @inputs        supplier_connector_output
 * @outputs       validated_normalized_supplier_product, normalized_source_contract_snapshot
 * @depends       schemas/catalog/normalized-supplier-product.v1.schema.json, schemas/catalog/normalized-supplier-product.v2.schema.json
 * @used-by       services/suppliers/connectors/api-connector.base.js, services/suppliers/connectors/csv-connector.js, services/suppliers/connectors/manual-connector.js, services/suppliers/catalog-import-orchestrator.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_INGESTION_CATALOGUE.md, docs/doctrine/DOCTRINE_PRODUCT_DETAIL_CONTRACT.md
 * @impact-areas  catalog, product-discovery, product-detail
 * @version       2026-07
 */

/**
 * KOMERCE — Contrat pivot NormalizedSupplierProduct
 * ═══════════════════════════════════════════════════════════════════
 *
 * V1 reste accepté pour les sources plates historiques.
 *
 * V2 préserve explicitement, lorsqu'une source les connaît déjà :
 *   - media[]
 *   - option_axes[]
 *   - sellable_units[]
 *
 * Le contrat ne fabrique JAMAIS une matrice couleur × taille. Une source riche
 * reste riche ; une source pauvre reste pauvre honnêtement.
 */

'use strict';

const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const schemaV1 = require('../../schemas/catalog/normalized-supplier-product.v1.schema.json');
const schemaV2 = require('../../schemas/catalog/normalized-supplier-product.v2.schema.json');

const CURRENT_SCHEMA_VERSION = '2';
const SUPPORTED_SCHEMA_VERSIONS = Object.freeze(['1', '2']);

const ajv = new Ajv({ allErrors: true, strict: false, verbose: true });
addFormats(ajv);

const validators = Object.freeze({
  '1': ajv.compile(schemaV1),
  '2': ajv.compile(schemaV2),
});

const FIELD_MESSAGES = {
  product_name:  { required: 'product_name requis', minLength: 'product_name requis' },
  supplier_name: { required: 'supplier_name requis' },
  currency:      { required: 'currency requise', enum: 'currency doit être AED, EUR, USD ou KMF' },
  purchase_price: {
    type: 'purchase_price doit être un nombre positif',
    exclusiveMinimum: 'purchase_price doit être un nombre positif',
  },
  weight_kg: {
    type: 'weight_kg doit être un nombre positif',
    exclusiveMinimum: 'weight_kg doit être un nombre positif',
  },
  raw_payload: { required: 'raw_payload requis (ING-I3 : le brut ne se perd jamais)' },
};

function boundsPhrase(err) {
  const schema = err.parentSchema || {};
  const lo = schema.exclusiveMinimum != null ? `(${schema.exclusiveMinimum}` : (schema.minimum != null ? `[${schema.minimum}` : '(-∞');
  const hi = schema.maximum != null ? `${schema.maximum}]` : '∞)';
  return `${lo}, ${hi}`;
}

function fieldPath(err) {
  if (err.keyword === 'required') return err.params.missingProperty;
  const path = String(err.instancePath || '').replace(/^\//, '').replace(/\//g, '.');
  return path || '(objet)';
}

/** Traduit une erreur Ajv en message lisible pour l'admin. */
function humanizeError(err) {
  const field = fieldPath(err);
  const rootField = field.split('.')[0];
  const known = FIELD_MESSAGES[rootField]?.[err.keyword];
  if (known) return known;

  switch (err.keyword) {
    case 'required':
      return `${err.params.missingProperty} requis`;
    case 'additionalProperties':
      return `champ inconnu hors contrat : "${err.params.additionalProperty}"`;
    case 'enum':
      return `${field} doit être l'une de : ${err.params.allowedValues.join(', ')}`;
    case 'const':
      return `${field} doit valoir ${JSON.stringify(err.params.allowedValue)}`;
    case 'minimum':
    case 'maximum':
    case 'exclusiveMinimum':
    case 'exclusiveMaximum':
      return `${field} hors bornes ${boundsPhrase(err)}`;
    case 'minLength':
      return `${field} trop court (minimum ${err.params.limit} caractères)`;
    case 'maxLength':
      return `${field} trop long (maximum ${err.params.limit} caractères)`;
    case 'minItems':
      return `${field} doit contenir au moins ${err.params.limit} élément(s)`;
    case 'maxItems':
      return `${field} contient trop d'éléments (maximum ${err.params.limit})`;
    case 'uniqueItems':
      return `${field} contient une valeur dupliquée`;
    case 'format':
      return `${field} format invalide (${err.params.format} attendu)`;
    case 'type':
      return `${field} doit être de type ${[].concat(err.schema).join('/')}`;
    default:
      return `${field} invalide (${err.keyword})`;
  }
}

function schemaVersionOf(obj) {
  const raw = obj?.schema_version;
  if (raw === undefined || raw === null || raw === '') return '1';
  return String(raw);
}

function canonicalOptionValues(values) {
  return Object.keys(values || {})
    .sort()
    .map((key) => `${key}\u0000${values[key]}`)
    .join('\u0001');
}

/**
 * Les règles ci-dessous expriment les coutures référentielles impossibles à
 * garantir proprement en JSON Schema sans dupliquer la donnée : axes uniques,
 * combos complets, références média et absence de SKU/combinaison dupliqués.
 */
function validateRichStructureV2(obj) {
  const errors = [];
  const axes = new Map();

  for (const axis of obj.option_axes || []) {
    if (axes.has(axis.key)) {
      errors.push(`option_axes : axe dupliqué "${axis.key}"`);
      continue;
    }
    axes.set(axis.key, new Set(axis.values || []));
  }

  const mediaIds = new Set();
  for (let i = 0; i < (obj.media || []).length; i++) {
    const media = obj.media[i];
    if (media.supplier_media_id) {
      if (mediaIds.has(media.supplier_media_id)) {
        errors.push(`media[${i}] : supplier_media_id dupliqué "${media.supplier_media_id}"`);
      } else {
        mediaIds.add(media.supplier_media_id);
      }
    }

    for (const [key, value] of Object.entries(media.option_values || {})) {
      if (!axes.has(key)) {
        errors.push(`media[${i}].option_values : axe inconnu "${key}"`);
      } else if (!axes.get(key).has(value)) {
        errors.push(`media[${i}].option_values : valeur inconnue ${key}="${value}"`);
      }
    }
  }

  const supplierSkus = new Set();
  const combos = new Set();
  const axisKeys = [...axes.keys()].sort();

  for (let i = 0; i < (obj.sellable_units || []).length; i++) {
    const unit = obj.sellable_units[i];

    if (supplierSkus.has(unit.supplier_sku)) {
      errors.push(`sellable_units[${i}] : supplier_sku dupliqué "${unit.supplier_sku}"`);
    } else {
      supplierSkus.add(unit.supplier_sku);
    }

    const optionValues = unit.option_values || {};
    const unitKeys = Object.keys(optionValues).sort();

    if (axisKeys.length === 0 && unitKeys.length > 0) {
      errors.push(`sellable_units[${i}].option_values : aucun axe déclaré`);
    }

    for (const key of axisKeys) {
      if (!Object.prototype.hasOwnProperty.call(optionValues, key)) {
        errors.push(`sellable_units[${i}].option_values incomplet : axe "${key}" absent`);
      }
    }

    for (const [key, value] of Object.entries(optionValues)) {
      if (!axes.has(key)) {
        errors.push(`sellable_units[${i}].option_values : axe inconnu "${key}"`);
      } else if (!axes.get(key).has(value)) {
        errors.push(`sellable_units[${i}].option_values : valeur inconnue ${key}="${value}"`);
      }
    }

    const comboKey = canonicalOptionValues(optionValues);
    if (combos.has(comboKey)) {
      errors.push(`sellable_units[${i}] : combinaison d'options dupliquée`);
    } else {
      combos.add(comboKey);
    }

    for (const mediaRef of unit.media_refs || []) {
      if (!mediaIds.has(mediaRef)) {
        errors.push(`sellable_units[${i}].media_refs : média inconnu "${mediaRef}"`);
      }
    }
  }

  return errors;
}

/**
 * Valide un objet contre la version de contrat qu'il déclare.
 * Absence de schema_version = V1 pour compatibilité stricte avec les connecteurs
 * historiques. Une structure riche doit donc déclarer V2 explicitement.
 */
function validateNormalizedProduct(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return { valid: false, errors: ['Objet invalide'] };
  }

  const version = schemaVersionOf(obj);
  const validateSchema = validators[version];
  if (!validateSchema) {
    return {
      valid: false,
      errors: [`schema_version non supportée : "${version}" (versions supportées : ${SUPPORTED_SCHEMA_VERSIONS.join(', ')})`],
    };
  }

  const schemaOk = validateSchema(obj);
  const errors = schemaOk
    ? []
    : (validateSchema.errors || []).map(humanizeError);

  if (version === '2' && schemaOk) {
    errors.push(...validateRichStructureV2(obj));
  }

  return { valid: errors.length === 0, errors };
}

/** Sépare une liste en produits valides et rejets motivés. */
function partitionValid(products) {
  const valid = [];
  const invalid = [];
  for (const product of products || []) {
    const verdict = validateNormalizedProduct(product);
    if (verdict.valid) valid.push(product);
    else invalid.push({ product, errors: verdict.errors });
  }
  return { valid, invalid };
}

/**
 * Snapshot du contrat source NORMALISÉ destiné à sourcing_candidates.
 *
 * raw_payload reste persisté séparément et intégralement. Le snapshot V2
 * conserve la traduction fournisseur → contrat Komerce (rôles média, axes,
 * unités vendables) pour que PDC-2 puisse promouvoir ces faits sans relire ni
 * deviner la donnée fournisseur. Les V1 restent null : aucun faux enrichissement.
 */
function buildNormalizedSourceContractSnapshot(product) {
  if (schemaVersionOf(product) !== '2') return null;

  const verdict = validateNormalizedProduct(product);
  if (!verdict.valid) {
    const err = new Error(`NormalizedSupplierProduct v2 invalide : ${verdict.errors.join(' ; ')}`);
    err.code = 'NORMALIZED_SOURCE_CONTRACT_INVALID';
    throw err;
  }

  const { raw_payload: _rawPayload, ...contract } = product;
  return JSON.parse(JSON.stringify(contract));
}

module.exports = {
  CURRENT_SCHEMA_VERSION,
  SUPPORTED_SCHEMA_VERSIONS,
  validateNormalizedProduct,
  partitionValid,
  buildNormalizedSourceContractSnapshot,
  _validateRichStructureV2: validateRichStructureV2,
};
