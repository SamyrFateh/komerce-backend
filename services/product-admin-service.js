/**
 * @komerce-arch
 * @role          catalog-product-admin-service
 * @domain        catalog
 * @layer         service
 * @criticality   high
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       services/catalog-overrides.js, services/product-price-audit.js,
 *                services/product-publication-guard.js
 * @used-by       routes/products.js
 * @db-read       boutique_categories, boutique_subcategories, catalog_field_overrides, catalog_media, order_items, orders, product_sku_media, product_skus, product_variants, products
 * @db-write      catalog_field_overrides, product_skus, product_variants, products
 * @db-txn        resolve_before_behavior_change
 * @doctrine      docs/doctrine/DOCTRINE_CATALOGUE.md §5, §7
 * @impact-areas  catalog, product-discovery, admin-dashboard
 * @version       2026-07
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
 *   replaceVariants(db, productId, variants)
 *     → { message, product_id, has_variants, count, variants }
 *     ✗ throws on 404/409/23505 (codes portés dans err.status / err.code)
 *
 *   createProduct(db, payload, adminUser)   → { status, body }
 *   updateProduct(db, productId, payload, adminUser) → { status, body }
 *   deleteProduct(db, productId)            → { status, body }
 *   setMainImage(db, productId, imageUrl)   → { status, body }
 *   appendImages(db, productId, imageUrls)  → { status, body }
 *   deleteVariant(db, productId, variantId) → { status, body }
 */

const { recordProductPriceChange }          = require('./product-price-audit');
const { auditProductStockChange,
        validatePublicationUpdate }         = require('./product-publication-guard');
const { OVERRIDABLE_FIELDS, isPipelineSourced, upsertOverrides } = require('./catalog-overrides');
const log = require('../utils/logger').child({ module: 'product-admin-service' });

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

  // Publication guard (si is_active ou is_available posé)
  if (payload.is_active || payload.is_available) {
    const pubCheck = validatePublicationUpdate({
      before: { name: '', category: '', price_kmf: 0, stock: null, is_active: false, is_available: false },
      patch: { ...payload },
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
    if (payload[f] !== undefined) fields.push(f);
  }

  const cols        = fields.join(', ');
  const placeholders = fields.map((_, i) => `$${i + 1}`).join(', ');
  const values      = fields.map(f => payload[f]);

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

// ── Variantes ─────────────────────────────────────────────────────────────────

/**
 * Remplace atomiquement toutes les variantes d'un produit (DELETE + INSERT en tx).
 *
 * Validation métier incluse (tableau, limites, types/valeurs, stock/price_kmf).
 * Lève des erreurs enrichies :
 *   err.status = 400 | 404 | 409
 *   err.code   = '23505' (doublon PostgreSQL — propagé tel quel)
 *
 * @param {import('pg').Pool} dbPool
 * @param {string} productId
 * @param {Array<{type,value,sku?,stock?,price_kmf?,image_url?,display_order?}>} variants
 */
async function replaceVariants(dbPool, productId, variants) {
  // — Validation de surface —
  if (!Array.isArray(variants)) {
    const e = new Error('variants doit être un tableau'); e.status = 400; throw e;
  }
  if (variants.length > 200) {
    const e = new Error('Maximum 200 variantes par produit'); e.status = 400; throw e;
  }
  for (const v of variants) {
    if (!v.type || typeof v.type !== 'string' || v.type.trim().length === 0) {
      const e = new Error('Chaque variante doit avoir un "type" (ex: "Taille")'); e.status = 400; throw e;
    }
    if (!v.value || typeof v.value !== 'string' || v.value.trim().length === 0) {
      const e = new Error('Chaque variante doit avoir une "value" (ex: "M")'); e.status = 400; throw e;
    }
    if (v.stock !== undefined && v.stock !== null && (typeof v.stock !== 'number' || v.stock < 0)) {
      const e = new Error(`stock invalide pour ${v.type}:${v.value} — entier >= 0 ou null`); e.status = 400; throw e;
    }
    if (v.price_kmf !== undefined && v.price_kmf !== null && (typeof v.price_kmf !== 'number' || v.price_kmf < 0)) {
      const e = new Error(`price_kmf invalide pour ${v.type}:${v.value} — entier >= 0 ou null`); e.status = 400; throw e;
    }
  }

  const client = await dbPool.getClient();
  try {
    await client.query('BEGIN');

    // — Lock produit —
    const { rows: [product] } = await client.query(
      'SELECT id, name FROM products WHERE id = $1 FOR UPDATE',
      [productId]
    );
    if (!product) {
      await client.query('ROLLBACK');
      const e = new Error('Produit introuvable'); e.status = 404; throw e;
    }

    // — Guard suppression totale : commandes en cours —
    if (variants.length === 0) {
      const { rows: [pending] } = await client.query(
        `SELECT COUNT(*)::int AS cnt
           FROM order_items oi
           JOIN orders o ON o.id = oi.order_id
          WHERE oi.product_id = $1
            AND oi.variant_combo IS NOT NULL
            AND o.status NOT IN ('collected', 'cancelled', 'refunded')`,
        [productId]
      );
      if (pending.cnt > 0) {
        await client.query('ROLLBACK');
        const e = new Error(
          `Impossible de supprimer les variantes : ${pending.cnt} commande(s) en cours y font référence`
        );
        e.status = 409;
        e.hint = 'Attendez que les commandes en cours soient finalisées ou annulées';
        throw e;
      }
    }

    // — Remplacement atomique —
    await client.query('DELETE FROM product_variants WHERE product_id = $1', [productId]);

    const inserted = [];
    for (let i = 0; i < variants.length; i++) {
      const v = variants[i];
      const { rows: [row] } = await client.query(
        `INSERT INTO product_variants
           (product_id, variant_type, variant_value, sku, stock, price_kmf, image_url, images, display_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [
          productId,
          v.type.trim(),
          v.value.trim(),
          v.sku           || null,
          v.stock      !== undefined ? v.stock : 0,
          v.price_kmf  || null,
          v.image_url  || null,
          JSON.stringify(Array.isArray(v.images) ? v.images : (v.image_url ? [v.image_url] : [])),
          v.display_order !== undefined ? v.display_order : i,
        ]
      );
      inserted.push(row);
    }

    await client.query('COMMIT');

    // Lecture hors-tx pour has_variants (trigger DB potentiel)
    const { rows: [updated] } = await dbPool.query(
      'SELECT id, name, has_variants FROM products WHERE id = $1',
      [productId]
    );

    return {
      message:      `${inserted.length} variante(s) enregistrée(s) pour "${product.name}"`,
      product_id:   productId,
      has_variants: updated.has_variants,
      count:        inserted.length,
      variants:     inserted,
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Supprime une variante d'un produit.
 * @returns {{ status: number, body: object }}
 */
async function deleteVariant(db, productId, variantId) {
  // Vérifier commandes en cours
  const { rows: [{ cnt }] } = await db.query(
    `SELECT COUNT(*) AS cnt
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
      WHERE oi.variant_id = $1
        AND o.status NOT IN ('delivered', 'cancelled', 'refunded')`,
    [variantId]
  );
  if (Number(cnt) > 0) {
    return {
      status: 409,
      body: { error: `Impossible de supprimer : ${cnt} commande(s) en cours référencent cette variante` },
    };
  }

  const { rows: [deleted] } = await db.query(
    `DELETE FROM product_variants
      WHERE id = $1 AND product_id = $2
      RETURNING id, variant_type, variant_value`,
    [variantId, productId]
  );
  if (!deleted) return { status: 404, body: { error: 'Variante introuvable' } };

  return {
    status: 200,
    body: { message: `Variante supprimée : ${deleted.variant_type}: ${deleted.variant_value}`, deleted },
  };
}

// ── SKU (Lot 1 — préparation/déclaration) ───────────────────────────────────
// Cf. docs/specs/DECISION_MODELE_STOCK_SKU.md. Ces fonctions lisent/écrivent
// EXCLUSIVEMENT product_skus. Elles ne touchent jamais products.stock ni
// product_variants.stock, et n'exigent PAS inventory_model = 'SKU' — un
// produit prépare ses SKU pendant qu'il reste LEGACY_VARIANTS ; la bascule
// (Lot 5) est un acte séparé, atomique, jamais déduit d'ici.

/**
 * Normalise un variant_combo : clés triées, valeurs non vides, ou null
 * pour le SKU par défaut. Lève une erreur 400 sur toute forme invalide.
 */
function _canonicalCombo(combo) {
  if (combo === null || combo === undefined) return null;
  if (typeof combo !== 'object' || Array.isArray(combo)) {
    const e = new Error('variant_combo doit être un objet {type: value} ou null'); e.status = 400; throw e;
  }
  const keys = Object.keys(combo);
  if (keys.length === 0) {
    const e = new Error('variant_combo ne peut pas être un objet vide — utilisez null pour un SKU par défaut');
    e.status = 400; throw e;
  }
  const out = {};
  for (const k of keys.sort()) {
    const v = combo[k];
    if (typeof v !== 'string' || v.trim().length === 0) {
      const e = new Error(`variant_combo.${k} doit être une chaîne non vide`); e.status = 400; throw e;
    }
    out[k.trim()] = v.trim();
  }
  return out;
}

/**
 * Résout le SKU actif correspondant à une combinaison (ou au SKU par défaut
 * si combo est null/undefined) pour un produit. Lecture seule.
 *
 * Lot 3 (cf. DECISION_MODELE_STOCK_SKU.md §D) : point d'entrée unique utilisé
 * par la création de commande pour les produits en inventory_model = 'SKU'.
 * Ne fait AUCUNE supposition sur inventory_model — c'est à l'appelant de
 * décider s'il doit passer par ce chemin (la bascule reste explicite, portée
 * par l'appelant, jamais déduite ici).
 *
 * @returns {object|null} { id, sku, stock, price_kmf } ou null si aucun SKU
 *   actif ne correspond à cette combinaison pour ce produit.
 */
async function resolveActiveSku(dbClient, productId, comboRaw) {
  const combo = _canonicalCombo(comboRaw ?? null);

  const { rows: [row] } = await dbClient.query(
    combo === null
      ? `SELECT id, sku, stock, price_kmf FROM product_skus
          WHERE product_id = $1 AND variant_combo IS NULL AND is_active = true`
      : `SELECT id, sku, stock, price_kmf FROM product_skus
          WHERE product_id = $1 AND variant_combo = $2::jsonb AND is_active = true`,
    combo === null ? [productId] : [productId, JSON.stringify(combo)]
  );

  return row || null;
}

/**
 * Politique promotionnelle canonique (GAP-07 — lot préalable).
 *
 * Point de vérité UNIQUE pour transformer un prix de base en prix effectif.
 * Reprend exactement la règle déjà en vigueur dans
 * services/shared-cart-creation.js :
 *   promo active ⇔ products.is_promo ET products.promo_pct > 0
 *                   ET (products.promo_until absent OU >= maintenant)
 *   prix effectif = round(prix_base * (1 - promo_pct / 100))
 *
 * Fonction pure (aucun accès DB) — appelable depuis n'importe quel writer
 * ou route sans coût de requête supplémentaire, dès lors que la ligne
 * `products` a déjà été chargée (is_promo, promo_pct, promo_until).
 *
 * @param {number} baseUnitPriceKmf
 * @param {{is_promo?: boolean, promo_pct?: number|null, promo_until?: string|Date|null}} product
 * @param {Date} [now]
 */
function applyCanonicalPromotion(baseUnitPriceKmf, product = {}, now = new Date()) {
  const base = Number(baseUnitPriceKmf) || 0;
  const promoActive = Boolean(product.is_promo) &&
    Number(product.promo_pct) > 0 &&
    (!product.promo_until || new Date(product.promo_until) >= now);
  if (!promoActive) return base;
  return Math.round(base * (1 - Number(product.promo_pct) / 100));
}

/**
 * Calcule le prix de base et le prix effectif d'une unité vendable, à
 * partir d'une ligne `products` déjà chargée et, le cas échéant, d'une
 * ligne `product_skus` déjà résolue (résultat de resolveActiveSku).
 *
 * Fonction pure — pas de requête DB. C'est la brique de calcul que
 * resolveSellableUnit() (ci-dessous) et routes/orders/create.js partagent,
 * pour ne jamais dupliquer la règle de fallback / la politique promo.
 *
 * Règle de prix de base (GAP-07 §5) :
 *   produit SKU  → product_skus.price_kmf si renseigné, sinon products.price_kmf
 *   produit non-SKU → products.price_kmf (product_skus n'existe pas pour lui)
 *
 * @returns {{ base_unit_price_kmf: number, effective_unit_price_kmf: number }}
 */
function computeSellablePricing({ product, resolvedSku = null, now = new Date() }) {
  const baseUnitPriceKmf = resolvedSku && resolvedSku.price_kmf != null
    ? Number(resolvedSku.price_kmf)
    : Number(product.price_kmf) || 0;

  return {
    base_unit_price_kmf: baseUnitPriceKmf,
    effective_unit_price_kmf: applyCanonicalPromotion(baseUnitPriceKmf, product, now),
  };
}

/**
 * Résout l'image canonique d'une unité vendable (GAP-07 §8) :
 *   média explicitement rattaché au SKU (product_sku_media → catalog_media)
 *   → sinon image produit legacy (products.image_url).
 *
 * Lecture seule, requête additionnelle — n'est appelée que par
 * resolveSellableUnit() ci-dessous (jamais par routes/orders/create.js,
 * qui n'a pas besoin d'une image pour écrire order_items).
 */
async function _resolveCanonicalImage(dbClient, { product, skuId }) {
  if (skuId) {
    const { rows: [media] } = await dbClient.query(
      `SELECT cm.url
         FROM product_sku_media psm
         JOIN catalog_media cm ON cm.id = psm.media_id AND cm.is_active = true
        WHERE psm.sku_id = $1
        ORDER BY psm.display_order NULLS LAST, psm.created_at ASC
        LIMIT 1`,
      [skuId]
    );
    if (media?.url) return media.url;
  }
  return product.image_url || null;
}

/**
 * Boundary canonique d'unité vendable (GAP-07 §5).
 *
 * Point d'entrée UNIQUE pour résoudre, quel que soit l'appelant (commande
 * personnelle, writers shared-cart, ajout unitaire...), l'identité, le
 * stock, le prix et le média d'une unité effectivement vendable. Réutilise
 * resolveActiveSku() — ne réimplémente jamais la résolution SKU.
 *
 * @param {object} dbClient
 * @param {{ productId: string, variantCombo?: object|null, quantity?: number }} args
 * @returns {Promise<{
 *   product_id: string, inventory_model: string,
 *   sku_id: string|null, sku: string|null, variant_combo: object|null,
 *   stock: number,
 *   base_unit_price_kmf: number, effective_unit_price_kmf: number,
 *   name: string, image_url: string|null, category: string|null,
 * }>}
 *
 * Erreurs (err.status / err.code) :
 *   404 product_not_found        — produit introuvable ou inactif
 *   409 sellable_unit_not_found  — produit SKU, combinaison inconnue/inactive
 *   409 sellable_unit_out_of_stock — stock insuffisant pour la quantité demandée
 *   400 variant_unknown          — produit legacy, variante inconnue
 */
async function resolveSellableUnit(dbClient, { productId, variantCombo = null, quantity = 1 }) {
  const { rows: [product] } = await dbClient.query(
    `SELECT id, name, image_url, category, price_kmf, is_active,
            inventory_model, has_variants, stock,
            promo_pct, is_promo, promo_until
       FROM products
      WHERE id = $1`,
    [productId]
  );
  if (!product || !product.is_active) {
    const e = new Error(`Produit introuvable ou inactif : ${productId}`);
    e.status = 404; e.code = 'product_not_found';
    throw e;
  }

  const qty = Number(quantity) || 1;

  if (product.inventory_model === 'SKU') {
    const resolvedSku = await resolveActiveSku(dbClient, productId, variantCombo);
    if (!resolvedSku) {
      const e = new Error(`Combinaison indisponible pour ${product.name}`);
      e.status = 409; e.code = 'sellable_unit_not_found';
      throw e;
    }
    if (resolvedSku.stock < qty) {
      const e = new Error(`Stock insuffisant pour ${product.name} — disponible : ${resolvedSku.stock}`);
      e.status = 409; e.code = 'sellable_unit_out_of_stock';
      e.available_stock = resolvedSku.stock;
      throw e;
    }

    const { base_unit_price_kmf, effective_unit_price_kmf } =
      computeSellablePricing({ product, resolvedSku });
    const imageUrl = await _resolveCanonicalImage(dbClient, { product, skuId: resolvedSku.id });

    return {
      product_id: product.id,
      inventory_model: product.inventory_model,
      sku_id: resolvedSku.id,
      sku: resolvedSku.sku,
      variant_combo: _canonicalCombo(variantCombo ?? null),
      stock: resolvedSku.stock,
      base_unit_price_kmf,
      effective_unit_price_kmf,
      name: product.name,
      image_url: imageUrl,
      category: product.category,
    };
  }

  // ── Produit non-SKU (LEGACY_VARIANTS ou sans variante) ──────────────
  // La combinaison legacy est conservée telle quelle lorsqu'elle existe
  // (référence d'affichage/historique — cf. product_variants), mais elle
  // n'identifie jamais une unité vendable à prix distinct : products ne
  // porte qu'un seul price_kmf pour toutes ses variantes.
  let combo = null;
  if (variantCombo && typeof variantCombo === 'object' && !Array.isArray(variantCombo)) {
    if (!product.has_variants) {
      combo = null;
    } else {
      combo = {};
      for (const [vType, vValue] of Object.entries(variantCombo)) {
        if (typeof vType !== 'string' || typeof vValue !== 'string') {
          const e = new Error(`variant_combo invalide pour ${productId} : ${vType}=${vValue}`);
          e.status = 400; e.code = 'variant_invalid';
          throw e;
        }
        const { rows: [variant] } = await dbClient.query(
          `SELECT stock FROM product_variants
            WHERE product_id = $1 AND variant_type = $2 AND variant_value = $3`,
          [productId, vType, vValue]
        );
        if (!variant) {
          const e = new Error(`Variante inconnue pour ${product.name} : ${vType}=${vValue}`);
          e.status = 400; e.code = 'variant_unknown';
          throw e;
        }
        if (variant.stock !== null && variant.stock < qty) {
          const e = new Error(`Stock insuffisant pour ${product.name} — ${vType}: ${vValue} — disponible : ${variant.stock}`);
          e.status = 409; e.code = 'sellable_unit_out_of_stock';
          e.available_stock = variant.stock;
          throw e;
        }
        combo[vType] = vValue;
      }
    }
  }

  if (combo === null && product.stock !== null && product.stock < qty) {
    const e = new Error(`Stock insuffisant pour ${product.name} — disponible : ${product.stock}`);
    e.status = 409; e.code = 'sellable_unit_out_of_stock';
    e.available_stock = product.stock;
    throw e;
  }

  const { base_unit_price_kmf, effective_unit_price_kmf } =
    computeSellablePricing({ product, resolvedSku: null });

  return {
    product_id: product.id,
    inventory_model: product.inventory_model || 'LEGACY_VARIANTS',
    sku_id: null,
    sku: null,
    variant_combo: combo,
    stock: product.stock,
    base_unit_price_kmf,
    effective_unit_price_kmf,
    name: product.name,
    image_url: product.image_url || null,
    category: product.category,
  };
}

/**
 * Liste les combinaisons possibles (produit cartésien des axes déclarés dans
 * product_variants) croisées avec les SKU déjà déclarés dans product_skus.
 * Lecture seule.
 */
async function getSkuCandidates(dbPool, productId) {
  const { rows: [product] } = await dbPool.query(
    'SELECT id, name, has_variants, inventory_model FROM products WHERE id = $1',
    [productId]
  );
  if (!product) { const e = new Error('Produit introuvable'); e.status = 404; throw e; }

  const { rows: declared } = await dbPool.query(
    `SELECT id, sku, variant_combo, stock, price_kmf, is_active, created_at, updated_at
       FROM product_skus WHERE product_id = $1
       ORDER BY variant_combo NULLS FIRST, created_at`,
    [productId]
  );

  if (!product.has_variants) {
    const existing = declared.find(s => s.variant_combo === null) || null;
    return {
      product_id: product.id, product_name: product.name,
      has_variants: false, inventory_model: product.inventory_model,
      axes: [], candidates: [{ variant_combo: null, declared: !!existing, sku: existing }],
      declared_count: declared.length,
    };
  }

  const { rows: variantRows } = await dbPool.query(
    `SELECT variant_type, variant_value FROM product_variants
      WHERE product_id = $1 ORDER BY variant_type, display_order, variant_value`,
    [productId]
  );

  const axesMap = new Map();
  for (const r of variantRows) {
    if (!axesMap.has(r.variant_type)) axesMap.set(r.variant_type, []);
    axesMap.get(r.variant_type).push(r.variant_value);
  }
  const axes = [...axesMap.entries()].map(([type, values]) => ({ type, values }));

  // Produit cartésien des axes — garde-fou anti-explosion combinatoire.
  let combos = [{}];
  for (const axis of axes) {
    const next = [];
    for (const base of combos) {
      for (const value of axis.values) next.push({ ...base, [axis.type]: value });
    }
    combos = next;
    if (combos.length > 500) {
      const e = new Error(
        `Trop de combinaisons possibles (${combos.length}+) — réduisez le nombre d'axes/valeurs avant de préparer les SKU`
      );
      e.status = 409; throw e;
    }
  }

  const declaredByKey = new Map();
  for (const row of declared) {
    if (row.variant_combo !== null) {
      declaredByKey.set(JSON.stringify(_canonicalCombo(row.variant_combo)), row);
    }
  }

  const candidates = combos.map(combo => {
    const canonical = _canonicalCombo(combo);
    const existing = declaredByKey.get(JSON.stringify(canonical)) || null;
    return { variant_combo: canonical, declared: !!existing, sku: existing };
  });

  return {
    product_id: product.id, product_name: product.name,
    has_variants: true, inventory_model: product.inventory_model,
    axes, candidates,
    candidate_count: candidates.length,
    declared_count: declared.filter(s => s.variant_combo !== null).length,
  };
}

/**
 * Déclare ou met à jour un SKU (upsert par combinaison, ou SKU par défaut
 * si variant_combo est null). N'exige pas inventory_model = 'SKU'.
 */
async function upsertProductSku(dbPool, productId, payload = {}) {
  const { rows: [product] } = await dbPool.query(
    'SELECT id, name, has_variants FROM products WHERE id = $1',
    [productId]
  );
  if (!product) { const e = new Error('Produit introuvable'); e.status = 404; throw e; }

  const combo = _canonicalCombo(payload.variant_combo ?? null);

  if (product.has_variants && combo === null) {
    const e = new Error("Ce produit a des variantes déclarées — variant_combo est obligatoire (pas de SKU par défaut)");
    e.status = 400; throw e;
  }
  if (!product.has_variants && combo !== null) {
    const e = new Error("Ce produit n'a pas de variantes — variant_combo doit être null (SKU par défaut uniquement)");
    e.status = 400; throw e;
  }

  if (typeof payload.stock !== 'number' || !Number.isInteger(payload.stock) || payload.stock < 0) {
    const e = new Error('stock est obligatoire — entier >= 0'); e.status = 400; throw e;
  }
  if (payload.price_kmf !== undefined && payload.price_kmf !== null &&
      (typeof payload.price_kmf !== 'number' || payload.price_kmf < 0)) {
    const e = new Error('price_kmf invalide — entier >= 0 ou null'); e.status = 400; throw e;
  }

  // Un combo précis ne peut référencer que des couples type/valeur qui
  // existent réellement dans les axes déclarés — on ne peut pas inventer
  // un SKU hors du catalogue de variantes.
  if (combo !== null) {
    for (const [type, value] of Object.entries(combo)) {
      const { rows: [match] } = await dbPool.query(
        `SELECT 1 FROM product_variants
          WHERE product_id = $1 AND variant_type = $2 AND variant_value = $3`,
        [productId, type, value]
      );
      if (!match) {
        const e = new Error(`variant_combo invalide : ${type}=${value} n'existe pas dans les axes déclarés pour ce produit`);
        e.status = 400; throw e;
      }
    }
  }

  const isActive = payload.is_active !== undefined ? !!payload.is_active : true;
  const skuLabel = payload.sku ? (String(payload.sku).trim() || null) : null;
  const conflictClause = combo === null
    ? 'ON CONFLICT (product_id) WHERE variant_combo IS NULL'
    : 'ON CONFLICT (product_id, variant_combo) WHERE variant_combo IS NOT NULL';

  const { rows: [row] } = await dbPool.query(
    `INSERT INTO product_skus (product_id, sku, variant_combo, stock, price_kmf, is_active)
     VALUES ($1, $2, $3, $4, $5, $6)
     ${conflictClause}
     DO UPDATE SET sku = EXCLUDED.sku, stock = EXCLUDED.stock,
                   price_kmf = EXCLUDED.price_kmf, is_active = EXCLUDED.is_active
     RETURNING *`,
    [productId, skuLabel, combo === null ? null : JSON.stringify(combo), payload.stock, payload.price_kmf ?? null, isActive]
  );

  return { message: `SKU ${row.sku || row.id} enregistré pour "${product.name}"`, sku: row };
}

/**
 * Désactive un SKU (soft — jamais de DELETE, cohérent avec la doctrine
 * "produit désactivé, non supprimé" appliquée ailleurs au catalogue).
 */
async function deactivateProductSku(dbPool, productId, skuId) {
  const { rows: [row] } = await dbPool.query(
    `UPDATE product_skus SET is_active = false
      WHERE id = $1 AND product_id = $2
      RETURNING id, sku, variant_combo, is_active`,
    [skuId, productId]
  );
  if (!row) return { status: 404, body: { error: 'SKU introuvable pour ce produit' } };
  return { status: 200, body: { message: 'SKU désactivé', sku: row } };
}

/**
 * Audit READY / NOT_READY — conditions nécessaires avant que le Lot 5 puisse
 * basculer products.inventory_model vers 'SKU'. Lecture seule, ne modifie
 * jamais inventory_model (la bascule reste un acte explicite séparé).
 */
async function auditProductSkuReadiness(dbPool, productId) {
  const { rows: [product] } = await dbPool.query(
    'SELECT id, name, has_variants, inventory_model FROM products WHERE id = $1',
    [productId]
  );
  if (!product) { const e = new Error('Produit introuvable'); e.status = 404; throw e; }

  if (product.inventory_model === 'SKU') {
    return { product_id: product.id, ready: true, already_sku: true, reasons: ['Déjà en mode SKU'] };
  }

  const reasons = [];

  if (!product.has_variants) {
    const { rows: [defaultSku] } = await dbPool.query(
      `SELECT id, stock, is_active FROM product_skus WHERE product_id = $1 AND variant_combo IS NULL`,
      [productId]
    );
    if (!defaultSku) reasons.push('Aucun SKU par défaut déclaré pour ce produit sans variantes');
    else if (!defaultSku.is_active) reasons.push('Le SKU par défaut existe mais est désactivé');
    return {
      product_id: product.id, ready: reasons.length === 0, reasons,
      active_sku_count: (defaultSku && defaultSku.is_active) ? 1 : 0,
    };
  }

  const { rows: activeSkus } = await dbPool.query(
    `SELECT id, variant_combo FROM product_skus
      WHERE product_id = $1 AND is_active = true AND variant_combo IS NOT NULL`,
    [productId]
  );
  if (activeSkus.length === 0) {
    reasons.push('Aucun SKU actif déclaré pour ce produit à variantes');
  }

  // SKU actifs qui référencent des couples type/valeur qui n'existent plus
  // dans product_variants (axe modifié après déclaration du SKU).
  const { rows: axisRows } = await dbPool.query(
    `SELECT variant_type, variant_value FROM product_variants WHERE product_id = $1`,
    [productId]
  );
  const axisSet = new Set(axisRows.map(r => `${r.variant_type}::${r.variant_value}`));
  const orphaned = [];
  for (const row of activeSkus) {
    for (const [type, value] of Object.entries(row.variant_combo || {})) {
      if (!axisSet.has(`${type}::${value}`)) orphaned.push({ sku_id: row.id, type, value });
    }
  }
  if (orphaned.length > 0) {
    reasons.push(`${orphaned.length} SKU actif(s) référencent des valeurs d'axe qui n'existent plus`);
  }

  return {
    product_id: product.id,
    ready: reasons.length === 0,
    reasons,
    active_sku_count: activeSkus.length,
    orphaned,
  };
}

// ── Gestion du stock ──────────────────────────────────────────────────────────

/**
 * Ajuste le stock de produits (et de leurs variantes) en une seule opération.
 * SEUL chemin d'écriture autorisé sur `products.stock`, `product_variants.stock`
 * et `product_skus.stock` pour les features externes (orders, logistics).
 * Feature catalog = owner.
 *
 * Lot 7 (PDC-7, cf. docs/specs/DECISION_MODELE_STOCK_SKU.md) : le moteur choisi
 * PAR ITEM est gouverné EXCLUSIVEMENT par `item.inventory_model`
 * ('SKU' | 'LEGACY_VARIANTS'), jamais par la seule présence de `item.sku_id`.
 * Un produit `inventory_model = 'SKU'` sans `sku_id` renseigné n'est PAS un
 * item legacy déguisé — c'est un bug de l'appelant (résolution SKU manquée
 * en amont), et adjustStock() échoue bruyamment plutôt que de retomber sur
 * `products.stock` / `product_variants.stock`. Aucun fallback silencieux.
 *
 * @param {object}  dbClient    Client de transaction actif
 * @param {Array}   items       Articles à ajuster :
 *   [{ product_id, quantity, inventory_model?, sku_id?, has_variants?, variant_combo? }]
 *   inventory_model === 'SKU'  → chemin SKU (UPDATE product_skus uniquement),
 *                                sku_id obligatoire, erreur bloquante sinon.
 *   inventory_model === autre chose (ou absent, compat appelants historiques)
 *                              → chemin legacy (products.stock + product_variants.stock).
 * @param {'increment'|'decrement'} direction
 *   'decrement' → stock - quantity  (paiement confirmé)
 *   'increment' → stock + quantity  (annulation, restauration backorder)
 */
async function adjustStock(dbClient, items, direction) {
  const op = direction === 'decrement' ? '-' : '+';

  for (const item of items) {
    if (item.inventory_model === 'SKU') {
      await adjustSkuStock(dbClient, item, op);
      continue;
    }
    await adjustLegacyStock(dbClient, item, op);
  }
}

/**
 * Chemin SKU (Lot 7) : un seul UPDATE, une seule table, jamais de lecture ni
 * d'écriture sur products.stock / product_variants.stock pour cet item.
 * Le CHECK stock >= 0 (migration 104) transforme tout dépassement en erreur
 * bloquante plutôt qu'un silence — comportement voulu (§6 decision doc).
 */
async function adjustSkuStock(dbClient, item, op) {
  if (!item.sku_id) {
    const e = new Error(
      `[adjustStock] Produit ${item.product_id} déclaré inventory_model='SKU' sans sku_id — ` +
      `refus explicite, aucun fallback vers products.stock/product_variants.stock`
    );
    e.status = 500;
    throw e;
  }

  const { rows: [row] } = await dbClient.query(
    `UPDATE product_skus SET stock = stock ${op} $1
      WHERE id = $2 AND product_id = $3
      RETURNING id`,
    [item.quantity, item.sku_id, item.product_id]
  );

  if (!row) {
    const e = new Error(
      `[adjustStock] SKU introuvable pour cet ajustement (sku_id=${item.sku_id}, product_id=${item.product_id})`
    );
    e.status = 500;
    throw e;
  }
}

/**
 * Chemin legacy (deux axes indépendants — cf. DECISION_MODELE_STOCK_SKU.md §A).
 */
async function adjustLegacyStock(dbClient, item, op) {
  await dbClient.query(
    `UPDATE products SET stock = stock ${op} $1 WHERE id = $2`,
    [item.quantity, item.product_id]
  );

  if (item.has_variants && item.variant_combo) {
    for (const [vType, vValue] of Object.entries(item.variant_combo)) {
      await dbClient.query(
        `UPDATE product_variants
            SET stock = stock ${op} $1
          WHERE product_id = $2
            AND variant_type = $3
            AND variant_value = $4
            AND stock IS NOT NULL`,
        [item.quantity, item.product_id, vType, vValue]
      );
    }
  }
}

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
  canonicalizeVariantCombo: _canonicalCombo,
  upsertProductSku,
  deactivateProductSku,
  auditProductSkuReadiness,
  adjustStock,
};
