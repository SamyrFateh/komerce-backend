'use strict';

/**
 * product-admin-service.js
 *
 * Logique métier extraite de routes/products.js (R8).
 *
 * Exports :
 *   validateProductTaxonomyPayload(db, { category, subcategory })
 *     → { ok: true } | { ok: false, status, body }
 *
 *   replaceVariants(db, productId, variants)
 *     → { message, product_id, has_variants, count, variants }
 *     ✗ throws on 404/409/23505 (codes portés dans err.status / err.code)
 */

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
          v.sku        || null,
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

module.exports = { validateProductTaxonomyPayload, replaceVariants };
