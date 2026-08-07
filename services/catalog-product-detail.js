/**
 * @komerce-arch
 * @role          catalog-product-detail-contract
 * @domain        catalog
 * @layer         service
 * @criticality   high
 * @inputs        product_id, canonical_catalog_rows, commercially_exposed_transport_rails
 * @outputs       public_product_detail_v1
 * @depends       services/transport-rails.js, services/transport-pricing.js, utils/rules.js, schemas/catalog/product-detail.v1.schema.json
 * @used-by       routes/catalog-product-detail.js
 * @db-read       business_rules, catalog_media, product_attributes, product_content_profile, product_content_sections, product_sku_media, product_skus, product_variants, products
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_PRODUCT_DETAIL_CONTRACT.md, docs/specs/DECISION_MODELE_STOCK_SKU.md, docs/doctrine/DOCTRINE_TRANSPORT_RAILS.md
 * @impact-areas  catalog, product-detail, modal, logistics
 * @version       2026-07 — §9 : price_kmf réel via transport-pricing.js ; eta_label toujours null (aucune source honnête)
 */

'use strict';

const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const detailSchema = require('../schemas/catalog/product-detail.v1.schema.json');
const { listCommercialTransportRails } = require('./transport-rails');
const { getRule } = require('../utils/rules');
const { quoteTransportPriceForItem, TransportPricingError } = require('./transport-pricing');
const { applyCanonicalPromotion } = require('./product-admin-service');

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

// section_key réservés de product_content_sections : toujours BULLETS,
// aplatis vers content.materials/care/warnings plutôt que content.sections[].
// Cf. migrations/111_product_content.sql §2 pour la justification.
const RESERVED_SECTION_TARGETS = Object.freeze({
  materials: 'materials',
  care: 'care',
  warnings: 'warnings',
});

function asStringOrNull(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function asStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (item === null || item === undefined ? '' : String(item).trim()))
    .filter((item) => item.length > 0);
}

function asDisplayOrder(value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : 0;
}

/**
 * Sépare les lignes product_content_sections entre les section_key réservés
 * (MATERIALS/CARE/WARNINGS, aplatis en listes de chaînes) et les sections
 * éditoriales libres (content.sections[]). Ne fabrique jamais de HTML : le
 * texte traverse tel quel, le rendu frontend l'assigne via textContent.
 */
function buildSections(sectionRows) {
  const sections = [];
  const flattened = { materials: [], care: [], warnings: [] };

  for (const row of sectionRows || []) {
    const json = row.content_json || {};
    const target = RESERVED_SECTION_TARGETS[row.section_key];

    if (target) {
      flattened[target].push(...asStringArray(json.items));
      continue;
    }

    const type = row.section_type;
    sections.push({
      key: row.section_key,
      title: row.title,
      type,
      text: type === 'TEXT' ? asStringOrNull(json.text) : null,
      items: type === 'BULLETS' ? asStringArray(json.items) : [],
      entries: type === 'KEY_VALUE'
        ? (Array.isArray(json.entries) ? json.entries : [])
            .filter((entry) => entry && entry.label && entry.value)
            .map((entry) => ({ label: String(entry.label), value: String(entry.value) }))
        : [],
      display_order: asDisplayOrder(row.display_order),
    });
  }

  return { sections, materials: flattened.materials, care: flattened.care, warnings: flattened.warnings };
}

/** content.highlights depuis product_attributes(kind='HIGHLIGHT'). */
function buildHighlights(attributeRows) {
  return (attributeRows || [])
    .filter((row) => row.kind === 'HIGHLIGHT')
    // La promotion (services/catalog-promotion/content.js) stocke le texte du
    // highlight dans label et laisse value_text à null (contrainte live
    // product_attributes_highlight_no_value : kind<>'HIGHLIGHT' OR value_text
    // IS NULL — un highlight n'a pas de couple label/valeur comme une spec).
    // Fallback value_text conservé pour compat avec d'éventuelles lignes
    // legacy déjà en base avant ce fix.
    .map((row) => ({ key: row.attribute_key, label: row.label || row.value_text }));
}

/** content.specifications depuis product_attributes(kind='SPECIFICATION'). */
function buildSpecifications(attributeRows) {
  return (attributeRows || [])
    .filter((row) => row.kind === 'SPECIFICATION')
    .map((row) => ({
      group: row.group_key ? row.group_key : null,
      key: row.attribute_key,
      label: row.label,
      value: row.value_text,
      unit: row.unit || null,
      display_order: asDisplayOrder(row.display_order),
    }));
}

/**
 * Assemble content.* depuis les 3 sources canoniques (profil, sections,
 * attributs). Toujours peuplé, même pour un produit pauvre (collections
 * vides, provenance honnête par défaut) — jamais absent, pour que mobile et
 * desktop consomment une forme unique sans code conditionnel de présence.
 * `content` reste néanmoins une clé optionnelle du schéma v1 (cf. tests) :
 * un contrat construit à la main sans ce bloc reste valide.
 */
function buildContent(profileRow, sectionRows, attributeRows) {
  const { sections, materials, care, warnings } = buildSections(sectionRows);

  return {
    brand: profileRow ? asStringOrNull(profileRow.brand) : null,
    short_description: profileRow ? asStringOrNull(profileRow.short_description) : null,
    highlights: buildHighlights(attributeRows),
    specifications: buildSpecifications(attributeRows),
    sections,
    materials,
    care,
    warnings,
    provenance: {
      source: (profileRow && profileRow.source) || 'SUPPLIER',
      enrichment_version: profileRow ? asStringOrNull(profileRow.enrichment_version) : null,
      reviewed: Boolean(profileRow && profileRow.reviewed),
    },
  };
}

/**
 * Média canonique depuis catalog_media. Vide pour un produit non promu —
 * le fallback legacy (buildMedia) reste alors la seule source, jamais un
 * mélange des deux dans la même réponse.
 */
function buildCanonicalMedia(catalogMediaRows) {
  return (catalogMediaRows || []).map((row) => ({
    id: row.id,
    url: row.url,
    role: row.role,
    alt: row.alt || null,
    option_values: canonicalOptionValues(row.option_values || {}),
  }));
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

function buildSellableUnits(product, skuRows, media, explicitSkuMediaMap = new Map()) {
  if (product.inventory_model !== 'SKU') return [];

  return skuRows.map((sku) => {
    const optionValues = canonicalOptionValues(sku.variant_combo || {});
    // Une association explicite SKU <-> média (product_sku_media, PDC-8 Lot 5)
    // gagne toujours sur le matching heuristique par option_values.
    const mediaIds = explicitSkuMediaMap.has(sku.id)
      ? [...explicitSkuMediaMap.get(sku.id)]
      : media
          .filter((item) => mediaMatchesOptions(item.option_values, optionValues))
          .map((item) => item.id);
    const quantity = Math.max(0, Number(sku.stock) || 0);
    // Mandat §10 — le prix exposé au frontend DOIT être le prix effectif
    // (celui réellement facturé par computeSellablePricing() à la commande),
    // jamais le prix de base brut. Même fonction pure (applyCanonicalPromotion,
    // services/product-admin-service.js), même gating (is_promo ET promo_pct>0
    // ET promo_until absent/futur), pour ne jamais dupliquer cette règle côté
    // catalogue avec un risque de divergence (badge -X% affiché alors que la
    // commande ne remise pas, ou l'inverse).
    const baseSkuPrice = asNullableInteger(sku.price_kmf) ?? asNullableInteger(product.price_kmf);
    const effectiveSkuPrice = baseSkuPrice != null ? applyCanonicalPromotion(baseSkuPrice, product) : null;

    return {
      sku_id: sku.id,
      sku: sku.sku || null,
      option_values: optionValues,
      stock_status: quantity > 0 ? 'AVAILABLE' : 'OUT_OF_STOCK',
      available_quantity: quantity,
      price_kmf: effectiveSkuPrice,
      media_ids: [...new Set(mediaIds)],
    };
  });
}

/**
 * Construit les options de livraison exposées dans la fiche produit.
 *
 * Règles :
 *  1. Seuls les rails PUBLIC + ACTIVE + ACTIVE (listCommercialTransportRails) sont exposés.
 *  2. AIR_EXPRESS est filtré si le produit n'est pas ELIGIBLE (PENDING_REVIEW ou EXCLUDED).
 *  3. price_kmf (§9) est un devis réel via services/transport-pricing.js
 *     (quantity=1, poids/volume produit), jamais une valeur inventée ici.
 *     Si le produit n'a pas de weight_kg (donnée manquante) ou que le devis
 *     échoue (tarif business_rules absent, rail ambigu...), price_kmf reste
 *     null plutôt que de propager une erreur — la fiche produit ne doit
 *     jamais planter pour un problème de tarification transport.
 *  4. eta_label reste null : aucune source de donnée honnête ne relie
 *     aujourd'hui un délai à SEA_STANDARD/AIR_EXPRESS (la table `carriers`
 *     est un seed d'exemple générique, sans lien avec les rails commerciaux
 *     — voir gap note features/catalog.feature.js). À câbler quand une
 *     décision business fournira un délai réel par rail.
 *
 * @param {{ air_eligibility_status?: string, weight_kg?: number, volume_cm3?: number }} product
 * @param {object} rates business_rules injectées par l'appelant (mêmes clés que transport-pricing.js)
 */
function buildDeliveryOptions(product = {}, rates = {}) {
  const airEligible = product.air_eligibility_status === 'ELIGIBLE';
  const weightKg = Number(product.weight_kg);
  const hasWeight = Number.isFinite(weightKg) && weightKg > 0;

  return listCommercialTransportRails()
    .filter((rail) => !(rail.code === 'AIR_EXPRESS' && !airEligible))
    .map((rail) => {
      const label = PUBLIC_RAIL_LABELS[rail.code];
      if (!label) {
        const error = new Error(`Rail commercial sans label public produit : ${rail.code}`);
        error.code = 'PRODUCT_DETAIL_RAIL_LABEL_MISSING';
        throw error;
      }

      let price_kmf = null;
      if (hasWeight) {
        try {
          const quote = quoteTransportPriceForItem({
            requestedTransportRailCode: rail.code,
            weightKg,
            volumeCm3: Number(product.volume_cm3) || 0,
            quantity: 1,
            rates,
          });
          price_kmf = quote.price_kmf;
        } catch (e) {
          if (!(e instanceof TransportPricingError)) throw e;
          // Tarif manquant/rail non valorisable → honnête : reste null.
          price_kmf = null;
        }
      }

      return {
        code: rail.code,
        label,
        available: true,
        price_kmf,
        // Doctrine DOCTRINE_PRODUCT_DETAIL_CONTRACT : aucune vérité inventée.
        // Le délai viendra d'une future source business dédiée par rail.
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
    `SELECT id, product_ref, sku, name, description, category, subcategory, series,
            price_kmf, promo_pct, is_promo, promo_until, image_url, images, has_variants, inventory_model,
            air_eligibility_status, weight_kg, volume_cm3
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

  // Média canonique (PDC-8) prioritaire ; fallback legacy uniquement si le
  // produit n'a jamais été promu — jamais un mélange des deux sources.
  const { rows: catalogMediaRows } = await dbClient.query(
    `SELECT id, url, role, alt, option_values
       FROM catalog_media
      WHERE product_id = $1 AND is_active = TRUE
      ORDER BY display_order ASC NULLS LAST, created_at ASC`,
    [productId]
  );
  const canonicalMedia = buildCanonicalMedia(catalogMediaRows);
  const usingCanonicalMedia = canonicalMedia.length > 0;
  const media = usingCanonicalMedia ? canonicalMedia : buildMedia(product, variantRows);

  // Associations explicites SKU <-> média — seulement pertinentes quand le
  // média canonique est effectivement utilisé (les ids legacy ne
  // correspondent à aucune ligne product_sku_media).
  const explicitSkuMediaMap = new Map();
  if (usingCanonicalMedia && skuRows.length > 0) {
    const { rows: skuMediaRows } = await dbClient.query(
      `SELECT sku_id, media_id
         FROM product_sku_media
        WHERE sku_id = ANY($1::uuid[])`,
      [skuRows.map((sku) => sku.id)]
    );
    for (const row of skuMediaRows) {
      if (!explicitSkuMediaMap.has(row.sku_id)) explicitSkuMediaMap.set(row.sku_id, new Set());
      explicitSkuMediaMap.get(row.sku_id).add(row.media_id);
    }
  }

  // Contenu éditorial canonique — jamais depuis raw_payload ni
  // normalized_source_contract, toujours depuis les tables promues.
  const { rows: [profileRow] } = await dbClient.query(
    `SELECT brand, short_description, source, enrichment_version, reviewed
       FROM product_content_profile
      WHERE product_id = $1`,
    [productId]
  );

  const { rows: sectionRows } = await dbClient.query(
    `SELECT section_key, title, section_type, content_json, display_order
       FROM product_content_sections
      WHERE product_id = $1 AND is_active = TRUE
      ORDER BY display_order ASC, section_key ASC`,
    [productId]
  );

  const { rows: attributeRows } = await dbClient.query(
    `SELECT kind, group_key, attribute_key, label, value_text, unit, display_order
       FROM product_attributes
      WHERE product_id = $1 AND is_active = TRUE
      ORDER BY kind ASC, display_order ASC, attribute_key ASC`,
    [productId]
  );

  // Mêmes clés/fallbacks que routes/orders/create.js — un seul point de
  // vérité pour les tarifs commerciaux transport (business_rules).
  const [
    seaKmfPerKgCommercial,
    airKmfPerKgTaxable,
    airVolumetricDivisor,
  ] = await Promise.all([
    getRule('SEA_KMF_PER_KG_COMMERCIAL', 65),
    getRule('AIR_KMF_PER_KG_TAXABLE', 2500),
    getRule('AIR_VOLUMETRIC_DIVISOR', 6000),
  ]);
  const transportRates = {
    SEA_KMF_PER_KG_COMMERCIAL: seaKmfPerKgCommercial,
    AIR_KMF_PER_KG_TAXABLE: airKmfPerKgTaxable,
    AIR_VOLUMETRIC_DIVISOR: airVolumetricDivisor,
  };

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
      series: product.series || null,
    },
    pricing: (() => {
      // Mandat §10 — même principe qu'au niveau SKU juste au-dessus : le
      // prix affiché est le prix effectif (post-promotion canonique),
      // jamais le prix de base brut accompagné d'un badge -X% qui pourrait
      // ne rien remiser réellement à la commande. old_price_kmf n'est
      // renseigné QUE si une remise est réellement appliquée (promo active
      // au sens applyCanonicalPromotion) — jamais reconstruit depuis un
      // promo_pct qui ne serait pas actif (is_promo faux ou promo_until
      // dépassé), pour ne jamais afficher un badge de promotion mensonger.
      const basePriceKmf = asNullableInteger(product.price_kmf);
      const effectivePriceKmf = basePriceKmf != null ? applyCanonicalPromotion(basePriceKmf, product) : null;
      const promoActuallyApplied = effectivePriceKmf != null && basePriceKmf != null && effectivePriceKmf < basePriceKmf;
      return {
        price_kmf: effectivePriceKmf,
        old_price_kmf: promoActuallyApplied ? basePriceKmf : null,
        promo_pct: promoActuallyApplied ? asNullableNumber(product.promo_pct) : null,
      };
    })(),
    media,
    option_axes: buildOptionAxes(variantRows),
    sellable_units: buildSellableUnits(product, skuRows, media, explicitSkuMediaMap),
    delivery_options: buildDeliveryOptions(product, transportRates),
    content: buildContent(profileRow || null, sectionRows, attributeRows),
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
  _buildContent: buildContent,
  _buildSections: buildSections,
  _buildSpecifications: buildSpecifications,
  _buildHighlights: buildHighlights,
  _buildCanonicalMedia: buildCanonicalMedia,
  _assertContract: assertContract,
};
