/**
 * @komerce-arch
 * @role          catalog-product-variant-service
 * @domain        catalog
 * @layer         service
 * @criticality   high
 * @inputs        product_id, variant_id, variants_payload
 * @outputs       product_variants_row, response_or_domain_result
 * @depends       none
 * @used-by       services/product-admin-service.js (réexport), routes/products.js (via product-admin-service.js)
 * @db-read       order_items, orders, product_variants, products
 * @db-write      product_variants
 * @db-txn        replaceVariants (DELETE+INSERT en tx)
 * @doctrine      docs/doctrine/DOCTRINE_CATALOGUE.md §5, §7
 * @impact-areas  catalog, admin-dashboard
 * @version       2026-08 (extrait de product-admin-service.js, nettoyage taille de fichier)
 */

'use strict';

/**
 * product-variant-service.js
 *
 * Sous-domaine legacy variants extrait de services/product-admin-service.js.
 * Ces deux fonctions gèrent exclusivement product_variants (le modèle
 * LEGACY_VARIANTS, distinct des product_skus — cf. product-sku-service.js
 * et docs/specs/DECISION_MODELE_STOCK_SKU.md). Copie exacte du comportement
 * d'origine : mêmes requêtes SQL, même ordre de contrôles, mêmes codes
 * d'erreur (err.status / err.code), même transaction pour replaceVariants.
 *
 * product-admin-service.js réexporte replaceVariants et deleteVariant pour
 * que son API publique reste inchangée : aucun appelant externe
 * (routes/products.js) n'est modifié.
 *
 * Exports :
 *   replaceVariants(dbPool, productId, variants)
 *     → { message, product_id, has_variants, count, variants }
 *     ✗ throws on 404/409/23505 (codes portés dans err.status / err.code)
 *
 *   deleteVariant(db, productId, variantId) → { status, body }
 */

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

module.exports = {
  replaceVariants,
  deleteVariant,
};
