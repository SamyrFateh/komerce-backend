/**
 * @komerce-arch
 * @role          catalog-product-admin-service
 * @domain        catalog
 * @layer         service
 * @criticality   high
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       services/catalog-overrides.js, services/product-price-audit.js, services/product-publication-guard.js,
 *                services/product-sku-service.js, services/product-variant-service.js, services/product-sellable-service.js,
 *                services/product-stock-service.js
 * @used-by       routes/products.js
 * @db-read       boutique_categories, boutique_subcategories, catalog_field_overrides, products
 * @db-write      catalog_field_overrides, products
 * @db-write-via:product-stock-service product_skus, product_variants, products
 * @db-txn        resolve_before_behavior_change
 * @doctrine      docs/doctrine/DOCTRINE_CATALOGUE.md §5, §7
 * @impact-areas  catalog, product-discovery, admin-dashboard
 * @version       2026-08 (LOT 3B — adjustStock/adjustSkuStock/adjustLegacyStock extraits vers
 *                product-stock-service.js ; LOT 3A — applyCanonicalPromotion/computeSellablePricing/
 *                resolveSellableUnit extraits vers product-sellable-service.js ; replaceVariants/
 *                deleteVariant déjà extraits vers product-variant-service.js)
 */

'use strict';

/**
 * product-admin-service.js
 *
 * Logique métier extraite de routes/products.js (R8 + R8B).
 *
 * Exports :
 *   validateProductTaxonomyPayload(db, { category, subcategory })
 *     → { ok: true } | { ok: false, status, body }
 *
 *   createProduct(db, payload, adminUser)   → { status, body }
 *   updateProduct(db, productId, payload, adminUser) → { status, body }
 *   deleteProduct(db, productId)            → { status, body }
 *   setMainImage(db, productId, imageUrl)   → { status, body }
 *   appendImages(db, productId, imageUrls)  → { status, body }
 *   (replaceVariants/deleteVariant réexportées depuis product-variant-service.js ;
 *    resolveActiveSku/canonicalizeVariantCombo/getSkuCandidates/upsertProductSku/
 *    deactivateProductSku/auditProductSkuReadiness réexportées depuis
 *    product-sku-service.js ; applyCanonicalPromotion/computeSellablePricing/
 *    resolveSellableUnit réexportées depuis product-sellable-service.js — LOT 3A ;
 *    adjustStock réexportée depuis product-stock-service.js — LOT 3B)
 */

const { recordProductPriceChange }          = require('./product-price-audit');
const { auditProductStockChange,
        validatePublicationUpdate }         = require('./product-publication-guard');
const { OVERRIDABLE_FIELDS, isPipelineSourced, upsertOverrides } = require('./catalog-overrides');
const log = require('../utils/logger').child({ module: 'product-admin-service' });

// Nettoyage architectural (2026-08) : replaceVariants/deleteVariant extraits
// vers product-variant-service.js, réexportés ci-dessous (API inchangée).
const { replaceVariants, deleteVariant } = require('./product-variant-service');

// Domaine 3/5 (2026-08) : le sous-domaine SKU (déclaration/lecture des
// product_skus) a été extrait vers product-sku-service.js. resolveActiveSku
// et canonicalizeVariantCombo ne sont plus consommées en interne par ce
// fichier depuis le LOT 3A (resolveSellableUnit a suivi la même extraction
// vers product-sellable-service.js, qui importe désormais ces deux
// fonctions directement depuis product-sku-service.js). Elles restent
// importées ICI uniquement pour être réexportées telles quelles
// ci-dessous : API publique inchangée, aucun appelant externe
// (routes/products.js notamment) n'est modifié.
const {
  resolveActiveSku,
  canonicalizeVariantCombo,
  getSkuCandidates,
  upsertProductSku,
  deactivateProductSku,
  auditProductSkuReadiness,
} = require('./product-sku-service');

// ── Taxonomy ──────────────────────────────────────────────────────────────────

/**
 * Valide category + subcategory contre boutique_categories / boutique_subcategories.
 * Iso-comportement avec l'ancien helper inline.
 *
 * @param {import('pg').Pool|import('pg').PoolClient} dbOrClient
 * @param {{ category?: string, subcategory?: string }} payload
 * @returns {Promise<{ ok: true }|{ ok: false, status: number, body: object }>}
 */
async function validateProductTaxonomyPayload(dbOrClient, { category, subcategory } = {}) {
  if (!category) return { ok: true };

  const { rows: [cat] } = await dbOrClient.query(
    `SELECT key, label
       FROM boutique_categories
      WHERE is_active = TRUE
        AND (key = $1 OR $1 = ANY(db_keys))
      LIMIT 1`,
    [category]
  );

  if (!cat) {
    const { rows } = await dbOrClient.query(
      `SELECT key, label, db_keys
         FROM boutique_categories
        WHERE is_active = TRUE
        ORDER BY display_order`
    );
    return {
      ok: false,
      status: 422,
      body: { error: `Catégorie invalide : "${category}"`, validCategories: rows },
    };
  }

  if (subcategory) {
    const { rows: [sub] } = await dbOrClient.query(
      `SELECT key, label
         FROM boutique_subcategories
        WHERE category_key = $1
          AND key = $2
          AND is_active = TRUE
        LIMIT 1`,
      [cat.key, subcategory]
    );

    if (!sub) {
      const { rows } = await dbOrClient.query(
        `SELECT key, label
           FROM boutique_subcategories
          WHERE category_key = $1
            AND is_active = TRUE
          ORDER BY display_order`,
        [cat.key]
      );
      return {
        ok: false,
        status: 422,
        body: {
          error: `Sous-catégorie invalide : "${subcategory}" pour "${category}"`,
          validSubcategories: rows,
        },
      };
    }
  }

  return { ok: true };
}

// ── Helpers internes ──────────────────────────────────────────────────────────

/**
 * Valide les champs numériques scalaires d'un payload produit.
 * @returns {{ ok: true }|{ ok: false, status: 400, body: object }}
 */
function _validateNumericFields(payload) {
  const numericFields = ['price_kmf', 'price_aed', 'price_eur', 'stock',
                         'weight_kg', 'promo_pct', 'customs_risk_coeff', 'unsold_price_kmf'];
  for (const f of numericFields) {
    if (payload[f] !== undefined && payload[f] !== null) {
      const v = Number(payload[f]);
      if (!Number.isFinite(v) || v < 0) {
        return { ok: false, status: 400, body: { error: `Le champ "${f}" doit être un nombre positif` } };
      }
    }
  }
  return { ok: true };
}

// ── R8B — Fonctions CRUD produit ──────────────────────────────────────────────

/**
 * Crée un nouveau produit.
 * @returns {{ status: number, body: object }}
 */
async function createProduct(db, payload, adminUser) {
  const { name, category, price_kmf } = payload;

  if (!name || !category || price_kmf === undefined || price_kmf === null) {
    return { status: 400, body: { error: 'Champs obligatoires manquants : name, category, price_kmf' } };
  }

  const numCheck = _validateNumericFields(payload);
  if (!numCheck.ok) return { status: numCheck.status, body: numCheck.body };

  // Taxonomy
  const taxCheck = await validateProductTaxonomyPayload(db, { category: payload.category, subcategory: payload.subcategory });
  if (!taxCheck.ok) return { status: taxCheck.status, body: taxCheck.body };

  // Une création admin est un brouillon tant que la publication n'est pas
  // explicitement demandée. Sans ces valeurs, les DEFAULT historiques de la
  // table (TRUE/TRUE) rendaient immédiatement publics les produits de tests
  // API et leurs libellés techniques. Les tests de charge peuvent désormais
  // créer leurs fixtures sans polluer le catalogue présenté aux clients.
  const creationPayload = {
    ...payload,
    is_active: payload.is_active === true,
    is_available: payload.is_available === true,
  };

  // Publication guard (si l'activation est explicitement demandée)
  if (creationPayload.is_active || creationPayload.is_available) {
    const pubCheck = validatePublicationUpdate({
      before: { name: '', category: '', price_kmf: 0, stock: null, is_active: false, is_available: false },
      patch: { ...creationPayload },
    });
    if (!pubCheck.ok) return { status: 422, body: { error: pubCheck.error, code: pubCheck.code } };
  }

  const fields = ['name', 'category', 'price_kmf'];
  // product_ref : optionnel — si absent, la DB génère KPR-XXXXXX via DEFAULT + séquence (migration 081)
  const optionals = ['sku', 'product_ref', 'description', 'subcategory', 'price_aed', 'price_eur', 'weight_kg',
                     'dimensions_cm', 'stock', 'image_url', 'images', 'badge', 'emoji', 'promo_pct',
                     'is_available', 'is_active', 'has_couture', 'sourcing_source',
                     'requires_secure_transport', 'customs_risk_coeff', 'unsold_price_kmf',
                     'unsold_channel', 'has_variants', 'sort_order'];
  for (const f of optionals) {
    if (creationPayload[f] !== undefined) fields.push(f);
  }

  const cols        = fields.join(', ');
  const placeholders = fields.map((_, i) => `$${i + 1}`).join(', ');
  const values      = fields.map(f => creationPayload[f]);

  let product;
  try {
    const { rows: [row] } = await db.query(
      `INSERT INTO products (${cols}) VALUES (${placeholders}) RETURNING *`,
      values
    );
    product = row;
  } catch (err) {
    if (err.code === '23505' && err.constraint === 'products_product_ref_unique') {
      return { status: 409, body: { error: `product_ref déjà utilisé : "${payload.product_ref}"`, code: 'product_ref_conflict' } };
    }
    throw err;
  }

  // Audits
  await recordProductPriceChange(db, {
    productId:   product.id,
    oldPriceKmf: 0,
    newPriceKmf: Number(product.price_kmf),
    source:      'product_create',
    appliedBy:   adminUser?.id,
  });

  if (product.stock !== undefined && product.stock !== null) {
    await auditProductStockChange(db, {
      productId: product.id,
      oldStock:  null,
      newStock:  product.stock,
      source:    'product_create',
      appliedBy: adminUser?.id,
    });
  }

  log.info(`Produit créé : ${product.id} — ${product.name}`);
  return { status: 201, body: product };
}

/**
 * Met à jour un produit existant.
 * @returns {{ status: number, body: object }}
 */
async function updateProduct(db, productId, payload, adminUser) {
  // product_ref accepté en update — doit rester unique (contrainte DB)
  const ALLOWED = ['name', 'sku', 'product_ref', 'description', 'category', 'subcategory',
                   'price_kmf', 'price_aed', 'price_eur', 'weight_kg', 'dimensions_cm',
                   'stock', 'badge', 'emoji', 'promo_pct', 'is_available', 'is_active',
                   'has_couture', 'sourcing_source', 'requires_secure_transport',
                   'customs_risk_coeff', 'unsold_price_kmf', 'unsold_channel',
                   'has_variants', 'sort_order'];

  const fields = Object.keys(payload).filter(k => ALLOWED.includes(k));
  if (!fields.length) {
    return { status: 400, body: { error: 'Aucun champ valide à mettre à jour' } };
  }

  const numCheck = _validateNumericFields(payload);
  if (!numCheck.ok) return { status: numCheck.status, body: numCheck.body };

  // Lire avant — content_source pilote le régime d'écriture (§5), lifecycle_status
  // pilote le garde d'approbation (§6).
  const { rows: [before] } = await db.query(
    'SELECT id, name, category, subcategory, price_kmf, stock, is_active, is_available, content_source, lifecycle_status FROM products WHERE id = $1',
    [productId]
  );
  if (!before) return { status: 404, body: { error: 'Produit introuvable' } };

  // DOCTRINE_CATALOGUE §6 — "Rien ne passe lifecycle_status='active' sans être
  // passé par ⑥ [approbation] au moins une fois." Une fiche candidate issue du
  // pipeline ne peut pas être publiée par une édition directe : elle doit
  // transiter par la file d'approbation (services/catalog-approval.js), seule
  // habilitée à sortir une fiche de l'état candidate. Portée volontairement
  // étroite : ne s'applique qu'aux candidats pipeline jamais encore publiés —
  // aucune contrainte nouvelle sur les produits déjà actifs (pattern 095/098/100).
  if (payload.is_active === true && !before.is_active
      && before.lifecycle_status === 'candidate' && isPipelineSourced(before)) {
    return {
      status: 409,
      body: {
        error: 'Fiche candidate en attente d\'approbation — utilisez la file d\'approbation (approve/override), pas une édition directe.',
        code: 'pending_approval',
      },
    };
  }

  // Taxonomy si category change
  if (payload.category !== undefined || payload.subcategory !== undefined) {
    const taxCheck = await validateProductTaxonomyPayload(db, {
      category:    payload.category    !== undefined ? payload.category    : before.category,
      subcategory: payload.subcategory !== undefined ? payload.subcategory : before.subcategory,
    });
    if (!taxCheck.ok) return { status: taxCheck.status, body: taxCheck.body };
  }

  // Publication guard
  if (payload.is_active !== undefined || payload.is_available !== undefined) {
    const pubCheck = validatePublicationUpdate({ before, patch: payload });
    if (!pubCheck.ok) return { status: 422, body: { error: pubCheck.error, code: pubCheck.code } };
  }

  // DOCTRINE_CATALOGUE §5 corollaire — "le CRUD admin existant devient
  // l'éditeur d'overrides, même formulaire, sémantique nouvelle" : pour une
  // fiche issue du pipeline (connecteur/IA), toute retouche sur un champ
  // régénérable se pose en override tracé, jamais en édition directe — sinon
  // le prochain re-raffinage l'écraserait silencieusement (§7). Le contenu
  // manuel legacy garde l'édition directe : rien à rejouer, rien à tracer.
  const routeAsOverride = isPipelineSourced(before);
  const overrideFields = routeAsOverride ? fields.filter(f => OVERRIDABLE_FIELDS.includes(f)) : [];
  const directFields = fields.filter(f => !overrideFields.includes(f));

  let updated = before;

  if (overrideFields.length) {
    const overridePayload = {};
    for (const f of overrideFields) overridePayload[f] = payload[f];
    const { product } = await upsertOverrides(db, productId, overridePayload, {
      reason: payload.override_reason || null,
      setBy: adminUser?.id || null,
    });
    updated = product;
    log.info(`Overrides posés (${overrideFields.join(', ')}) — produit ${productId}`);
  }

  if (!directFields.length) {
    if (!overrideFields.length) {
      // Ne devrait pas arriver (fields non vide implique l'un ou l'autre),
      // gardé en défense.
      return { status: 400, body: { error: 'Aucun champ valide à mettre à jour' } };
    }
    return { status: 200, body: updated };
  }

  const setClauses = directFields.map((f, i) => `${f} = $${i + 1}`).join(', ');
  const values     = directFields.map(f => payload[f]);
  values.push(productId);

  try {
    const { rows: [row] } = await db.query(
      `UPDATE products SET ${setClauses}, updated_at = NOW() WHERE id = $${values.length} RETURNING *`,
      values
    );
    updated = row;
  } catch (err) {
    if (err.code === '23505' && err.constraint === 'products_product_ref_unique') {
      return { status: 409, body: { error: `product_ref déjà utilisé : "${payload.product_ref}"`, code: 'product_ref_conflict' } };
    }
    throw err;
  }

  // Audit prix si changement
  if (payload.price_kmf !== undefined && Number(payload.price_kmf) !== Number(before.price_kmf)) {
    await recordProductPriceChange(db, {
      productId,
      oldPriceKmf: Number(before.price_kmf),
      newPriceKmf: Number(payload.price_kmf),
      source:      'product_update',
      appliedBy:   adminUser?.id,
    });
  }

  // Audit stock si changement
  if (payload.stock !== undefined && payload.stock !== before.stock) {
    await auditProductStockChange(db, {
      productId,
      oldStock:  before.stock,
      newStock:  payload.stock,
      source:    'product_update',
      appliedBy: adminUser?.id,
    });
  }

  log.info(`Produit modifié : ${productId}`);
  return { status: 200, body: updated };
}

/**
 * Soft-delete : is_active = FALSE.
 * @returns {{ status: number, body: object }}
 */
async function deleteProduct(db, productId) {
  await db.query(
    'UPDATE products SET is_active = FALSE, updated_at = NOW() WHERE id = $1',
    [productId]
  );
  log.info(`Produit désactivé : ${productId}`);
  return { status: 200, body: { success: true } };
}

/**
 * Définit l'image principale d'un produit.
 * @returns {{ status: number, body: object }}
 */
async function setMainImage(db, productId, imageUrl) {
  const { rows: [product] } = await db.query(
    `UPDATE products SET image_url = $1, updated_at = NOW()
      WHERE id = $2 AND is_active = TRUE
      RETURNING id, name, image_url`,
    [imageUrl, productId]
  );
  if (!product) return { status: 404, body: { error: 'Produit introuvable ou inactif' } };
  return { status: 200, body: { success: true, image_url: product.image_url, product } };
}

/**
 * Ajoute des images à la galerie d'un produit.
 * @returns {{ status: number, body: object }}
 */
async function appendImages(db, productId, imageUrls) {
  const { rows: [product] } = await db.query(
    'SELECT id, name, images FROM products WHERE id = $1 AND is_active = TRUE',
    [productId]
  );
  if (!product) return { status: 404, body: { error: 'Produit introuvable ou inactif' } };

  const existing = product.images ? JSON.parse(product.images) : [];
  const merged   = [...existing, ...imageUrls];

  let updateSql, updateParams;
  if (existing.length === 0) {
    // Premier ajout : définir aussi image_url
    updateSql    = `UPDATE products SET images = $1, image_url = $2, updated_at = NOW() WHERE id = $3`;
    updateParams = [JSON.stringify(merged), merged[0], productId];
  } else {
    updateSql    = `UPDATE products SET images = $1, updated_at = NOW() WHERE id = $2`;
    updateParams = [JSON.stringify(merged), productId];
  }

  await db.query(updateSql, updateParams);

  return {
    status: 200,
    body: {
      product_name: product.name,
      images:       merged,
      new_images:   imageUrls,
      total_count:  merged.length,
    },
  };
}

// ── Variantes : replaceVariants()/deleteVariant() → product-variant-service.js
// (nettoyage architectural, sous-domaine legacy variants ; réexportées
// ci-dessous). SKU : resolveActiveSku(), getSkuCandidates(),
// upsertProductSku(), deactivateProductSku(), auditProductSkuReadiness(),
// canonicalizeVariantCombo() → product-sku-service.js (domaine 3/5).

// ── Sellable unit (pricing, promotion, image canonique) — LOT 3A ────────
// applyCanonicalPromotion / computeSellablePricing / resolveSellableUnit
// vivent désormais dans product-sellable-service.js (nettoyage
// architectural). Réexportées ci-dessous pour API publique inchangée :
// routes/orders/create.js et services/shared-cart-creation.js (contrat
// protégé) continuent d'importer resolveSellableUnit depuis CE fichier
// sans aucun changement.
const {
  applyCanonicalPromotion,
  computeSellablePricing,
  resolveSellableUnit,
} = require('./product-sellable-service');
// ── Gestion du stock — LOT 3B ────────────────────────────────────────────
// adjustStock/adjustSkuStock/adjustLegacyStock vivent désormais dans
// product-stock-service.js (nettoyage architectural). Réexportée
// ci-dessous pour API publique inchangée : order-payment-confirmation.js,
// order-status-machine.js et parcel-operations.js (contrat protégé,
// hors périmètre de ce lot) continuent d'importer adjustStock depuis CE
// fichier sans aucun changement.
const { adjustStock } = require('./product-stock-service');

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  validateProductTaxonomyPayload,
  createProduct,
  updateProduct,
  deleteProduct,
  setMainImage,
  appendImages,
  replaceVariants,
  deleteVariant,
  getSkuCandidates,
  resolveActiveSku,
  applyCanonicalPromotion,
  computeSellablePricing,
  resolveSellableUnit,
  canonicalizeVariantCombo,
  upsertProductSku,
  deactivateProductSku,
  auditProductSkuReadiness,
  adjustStock,
};
