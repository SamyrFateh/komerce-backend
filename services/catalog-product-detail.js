/**
 * @komerce-arch
 * @role          catalog-product-detail-contract
 * @domain        catalog
 * @layer         service
 * @criticality   high
 * @inputs        product_id, canonical_catalog_rows, commercially_exposed_transport_rails
 * @outputs       public_product_detail_v1
 * @depends       services/transport-rails.js, schemas/catalog/product-detail.v1.schema.json
 * @used-by       routes/catalog-product-detail.js
 * @db-read       product_skus, product_variants, products
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_PRODUCT_DETAIL_CONTRACT.md, docs/specs/DECISION_MODELE_STOCK_SKU.md, docs/doctrine/DOCTRINE_TRANSPORT_RAILS.md
 * @impact-areas  catalog, product-detail, modal, logistics
 * @version       2026-07
 */

'use strict';

const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const detailSchema = require('../schemas/catalog/product-detail.v1.schema.json');
const { listCommercialTransportRails } = require('./transport-rails');

const CONTRACT_VERSION = '1';

// Le label public appartient à la projection catalogue. Un nouveau rail rendu
// commercial par logistics doit recevoir un wording explicite ici : on échoue
// plutôt que d'inventer un label depuis un code technique.
const PUBLIC_RAIL_LABELS = Object.freeze({
  SEA_STANDARD: 'Livraison standard',
  AIR_EXPRESS: 'Livraison express',
});

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validateDetail = ajv.compile(detailSchema);

function asNullableInteger(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

function asNullableNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function toUrlList(images, fallback = null) {
  const urls = [];
  if (Array.isArray(images)) {
    for (const image of images) {
      const url = typeof image === 'string'
        ? image.trim()
        : (image && typeof image === 'object' && image.url ? String(image.url).trim() : '');
      if (url) urls.push(url);
    }
  }
  if (fallback) {
    const value = String(fallback).trim();
    if (value) urls.unshift(value);
  }
  return urls;
}

function canonicalOptionValues(values) {
  const out = {};
  for (const key of Object.keys(values || {}).sort()) {
    const value = values[key];
    if (value === null || value === undefined) continue;
    out[String(key)] = String(value);
  }
  return out;
}

function optionSignature(values) {
  return JSON.stringify(canonicalOptionValues(values));
}

function mediaMatchesOptions(mediaOptions, unitOptions) {
  const entries = Object.entries(mediaOptions || {});
  if (!entries.length) return false;
  return entries.every(([key, value]) => unitOptions?.[key] === value);
}

function buildMedia(product, variantRows) {
  const media = [];
  const seen = new Map();

  function append({ key, url, role = 'PRODUCT', optionValues = {} }) {
    if (!url) return null;
    const normalizedUrl = String(url).trim();
    if (!normalizedUrl) return null;
    const normalizedOptions = canonicalOptionValues(optionValues);
    const signature = `${normalizedUrl}\u0000${optionSignature(normalizedOptions)}\u0000${role}`;
    if (seen.has(signature)) return seen.get(signature);

    const id = key;
    media.push({
      id,
      url: normalizedUrl,
      role,
      alt: product.name || null,
      option_values: normalizedOptions,
    });
    seen.set(signature, id);
    return id;
  }

  const productUrls = toUrlList(product.images, product.image_url);
  productUrls.forEach((url, index) => {
    append({ key: `product-${index + 1}`, url, role: 'PRODUCT' });
  });

  variantRows.forEach((variant, variantIndex) => {
    const urls = toUrlList(variant.images, variant.image_url);
    urls.forEach((url, imageIndex) => {
      append({
        key: `variant-${variantIndex + 1}-${imageIndex + 1}`,
        url,
        role: 'PRODUCT',
        optionValues: { [variant.variant_type]: variant.variant_value },
      });
    });
  });

  return media;
}

function buildOptionAxes(variantRows) {
  const axes = new Map();

  for (const variant of variantRows) {
    if (!axes.has(variant.variant_type)) {
      axes.set(variant.variant_type, new Map());
    }
    const values = axes.get(variant.variant_type);
    if (values.has(variant.variant_value)) continue;
    const urls = toUrlList(variant.images, variant.image_url);
    values.set(variant.variant_value, {
      value: variant.variant_value,
      thumbnail_url: urls[0] || null,
    });
  }

  return [...axes.entries()].map(([key, values]) => ({
    key,
    display_name: key,
    values: [...values.values()],
  }));
}

function buildSellableUnits(product, skuRows, media) {
  if (product.inventory_model !== 'SKU') return [];

  return skuRows.map((sku) => {
    const optionValues = canonicalOptionValues(sku.variant_combo || {});
    const mediaIds = media
      .filter((item) => mediaMatchesOptions(item.option_values, optionValues))
      .map((item) => item.id);
    const quantity = Math.max(0, Number(sku.stock) || 0);

    return {
      sku_id: sku.id,
      sku: sku.sku || null,
      option_values: optionValues,
      stock_status: quantity > 0 ? 'AVAILABLE' : 'OUT_OF_STOCK',
      available_quantity: quantity,
      price_kmf: asNullableInteger(sku.price_kmf) ?? asNullableInteger(product.price_kmf),
      media_ids: [...new Set(mediaIds)],
    };
  });
}

function buildDeliveryOptions() {
  return listCommercialTransportRails().map((rail) => {
    const label = PUBLIC_RAIL_LABELS[rail.code];
    if (!label) {
      const error = new Error(`Rail commercial sans label public produit : ${rail.code}`);
      error.code = 'PRODUCT_DETAIL_RAIL_LABEL_MISSING';
      throw error;
    }
    return {
      code: rail.code,
      label,
      available: true,
      // Aucun moteur de devis produit/destination ne fournit encore ces valeurs.
      // null est une absence honnête ; surtout pas "Gratuit" ou "3 à 5 semaines".
      price_kmf: null,
      eta_label: null,
      unavailable_reason: null,
    };
  });
}

function assertContract(detail) {
  if (validateDetail(detail)) return detail;
  const error = new Error(
    `Contrat détail produit v1 invalide : ${(validateDetail.errors || [])
      .map((entry) => `${entry.instancePath || '/'} ${entry.message}`)
      .join(' ; ')}`
  );
  error.code = 'PRODUCT_DETAIL_CONTRACT_INVALID';
  error.details = validateDetail.errors || [];
  throw error;
}

async function getProductDetail(dbClient, productId) {
  const { rows: [product] } = await dbClient.query(
    `SELECT id, product_ref, sku, name, description, category, subcategory,
            price_kmf, promo_pct, image_url, images, has_variants, inventory_model
       FROM products
      WHERE id = $1 AND is_active = TRUE`,
    [productId]
  );
  if (!product) return null;

  const { rows: variantRows } = await dbClient.query(
    `SELECT variant_type, variant_value, image_url, images, display_order
       FROM product_variants
      WHERE product_id = $1
      ORDER BY variant_type, display_order ASC, variant_value ASC`,
    [productId]
  );

  let skuRows = [];
  if (product.inventory_model === 'SKU') {
    const result = await dbClient.query(
      `SELECT id, sku, variant_combo, stock, price_kmf
         FROM product_skus
        WHERE product_id = $1 AND is_active = TRUE
        ORDER BY created_at ASC, id ASC`,
      [productId]
    );
    skuRows = result.rows;
  }

  const media = buildMedia(product, variantRows);
  const detail = {
    contract_version: CONTRACT_VERSION,
    inventory_model: product.inventory_model,
    product: {
      id: product.id,
      reference: product.product_ref || product.sku || null,
      name: product.name,
      description: product.description || null,
      category: product.category || null,
      subcategory: product.subcategory || null,
    },
    pricing: {
      price_kmf: asNullableInteger(product.price_kmf),
      // Le catalogue ne reconstruit pas un ancien prix depuis promo_pct.
      old_price_kmf: null,
      promo_pct: asNullableNumber(product.promo_pct),
    },
    media,
    option_axes: buildOptionAxes(variantRows),
    sellable_units: buildSellableUnits(product, skuRows, media),
    delivery_options: buildDeliveryOptions(),
  };

  return assertContract(detail);
}

module.exports = {
  CONTRACT_VERSION,
  PUBLIC_RAIL_LABELS,
  getProductDetail,
  _buildMedia: buildMedia,
  _buildOptionAxes: buildOptionAxes,
  _buildSellableUnits: buildSellableUnits,
  _buildDeliveryOptions: buildDeliveryOptions,
  _assertContract: assertContract,
};
