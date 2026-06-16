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

  // Lire avant
  const { rows: [before] } = await db.query(
    'SELECT id, name, category, subcategory, price_kmf, stock, is_active, is_available FROM products WHERE id = $1',
    [productId]
  );
  if (!before) return { status: 404, body: { error: 'Produit introuvable' } };

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

  const setClauses = fields.map((f, i) => `${f} = $${i + 1}`).join(', ');
  const values     = fields.map(f => payload[f]);
  values.push(productId);

  let updated;
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
           (product_id, variant_type, variant_value, sku, stock, price_kmf, image_url, display_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [
          productId,
          v.type.trim(),
          v.value.trim(),
          v.sku           || null,
          v.stock      !== undefined ? v.stock : 0,
          v.price_kmf  || null,
          v.image_url  || null,
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
};
