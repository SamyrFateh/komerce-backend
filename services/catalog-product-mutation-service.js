/**
 * @komerce-arch
 * @role          catalog-product-mutation-service
 * @domain        catalog
 * @layer         service
 * @criticality   high
 * @inputs        product mutation command, pool_or_transaction_client
 * @outputs       updated catalog product state
 * @depends       db contract supplied by caller
 * @used-by       services/pricing-apply.js, services/apply-pricing-updates.js, services/pricing-strategy-service.js, services/sourcing-mutations.js
 * @db-read       order_items, orders, product_variants, products
 * @db-write      product_variants, products
 * @db-txn        caller transaction preserved; replaceVariantsForSourcing owns its legacy dedicated transaction
 * @doctrine      WRITES != OWNS — catalog owns products/product_variants lifecycle
 * @impact-areas  catalog, economic-engine
 * @version       2026-08
 */

'use strict';

/**
 * Internal owner boundary for cross-feature catalog mutations.
 *
 * economic-engine keeps pricing / sourcing decisions; catalog keeps the SQL
 * authority over `products` and `product_variants`. Functions accept the same
 * pool/client objects used by the former callers so transaction boundaries,
 * ordering, idempotence and error semantics remain unchanged.
 */

/**
 * Applique un nouveau prix produit (price_kmf). Utilisé par economic-engine
 * (services/pricing-apply.js, services/apply-pricing-updates.js,
 * services/pricing-strategy-service.js) qui reste propriétaire de la
 * décision de prix et de l'audit price_history ; catalog porte uniquement
 * l'écriture sur sa table `products`.
 *
 * @param {object} db - pool ou client de transaction
 * @param {string} productId
 * @param {number} priceKmf
 * @returns {Promise<{id:string, name:string, price_kmf:number}|null>}
 */
async function applyPrice(db, productId, priceKmf) {
  const { rows: [updated] } = await db.query(
    `UPDATE products SET price_kmf = $1, updated_at = NOW() WHERE id = $2 RETURNING id, name, price_kmf`,
    [priceKmf, productId]
  );
  return updated || null;
}

/**
 * Met à jour les métadonnées sourcing d'un produit (rail, poids, fragilité,
 * etc.). Extrait à l'identique de services/sourcing-mutations.js (moteur
 * margin/rail admin d'economic-engine, routes/sourcing.js) — même whitelist
 * de champs, même mapping legacy, même comportement.
 *
 * @param {object} db
 * @param {string} productId
 * @param {object} body
 * @returns {Promise<object|null>} la ligne products à jour, ou null si introuvable
 */
async function updateSourcingFields(db, productId, body) {
  const ALLOWED_FIELDS = [
    'sourcing_rail', 'volume_class',
    'fragility', 'sale_mode', 'exposure_mode', 'lifecycle_status',
    'quality_validated', 'real_weight_known', 'real_price_validated',
    'delivery_delay_days', 'supplier_notes',
  ];
  const LEGACY_FIELD_MAP = {
    cost_price_kmf: 'cost_kmf',
    weight_g: 'weight_kg',
  };

  const sets = [];
  const vals = [];
  let idx = 1;
  const written = new Set();

  const writeField = (column, value) => {
    if (written.has(column)) return;
    written.add(column);
    sets.push(`${column} = $${idx}`);
    vals.push(value);
    idx++;
  };

  for (const key of ALLOWED_FIELDS) {
    if (body[key] !== undefined) {
      writeField(key, body[key]);
    }
  }

  for (const [legacyKey, truthColumn] of Object.entries(LEGACY_FIELD_MAP)) {
    if (body[legacyKey] === undefined) continue;
    if (written.has(truthColumn)) continue;

    let value = body[legacyKey];
    if (legacyKey === 'weight_g') {
      const w = Number(value);
      value = isFinite(w) && w > 0 ? Math.round((w / 1000) * 100) / 100 : null;
    }
    writeField(truthColumn, value);
  }

  if (sets.length === 0) {
    const e = new Error('Aucun champ à mettre à jour'); e.status = 400; throw e;
  }

  sets.push('last_review_at = NOW()');
  vals.push(productId);

  const { rows } = await db.query(
    `UPDATE products SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
    vals
  );

  return rows[0] || null;
}

/**
 * Assigne un rail sourcing (A/B/C/D) à plusieurs produits en une requête.
 * Extrait à l'identique de services/sourcing-mutations.js.
 *
 * @param {object} db
 * @param {string[]} productIds
 * @param {string} rail
 * @returns {Promise<number>} nombre de lignes mises à jour
 */
async function bulkAssignSourcingRail(db, productIds, rail) {
  const { rowCount } = await db.query(
    `UPDATE products SET sourcing_rail = $1, last_review_at = NOW() WHERE id = ANY($2)`,
    [rail, productIds]
  );
  return rowCount;
}

/**
 * Remplace atomiquement toutes les variantes d'un produit pour le compte du
 * moteur sourcing/margin-rail d'economic-engine (routes/sourcing.js). Extrait
 * à l'identique de services/sourcing-mutations.js — comportement, garde-fous
 * (commandes pending) et limites (max 50) distincts de replaceVariants()
 * ci-dessus (usage admin catalogue), à ne pas fusionner sans vérifier les
 * deux appelants.
 *
 * @param {object} dbPool
 * @param {string} productId
 * @param {object[]} variants
 * @returns {Promise<{status:number, body:object}>}
 */
async function replaceVariantsForSourcing(dbPool, productId, variants) {
  const client = await dbPool.getClient();
  try {
    await client.query('BEGIN');

    if (!Array.isArray(variants)) {
      await client.query('ROLLBACK');
      return { status: 400, body: { error: 'variants doit être un tableau' } };
    }
    if (variants.length > 50) {
      await client.query('ROLLBACK');
      return { status: 400, body: { error: 'Maximum 50 variantes par produit' } };
    }

    const { rows: prodRows } = await client.query(
      `SELECT id FROM products WHERE id = $1 FOR UPDATE`,
      [productId]
    );
    if (!prodRows.length) {
      await client.query('ROLLBACK');
      return { status: 404, body: { error: 'Produit introuvable' } };
    }

    for (let i = 0; i < variants.length; i++) {
      const v = variants[i];
      if (!v || typeof v !== 'object') {
        await client.query('ROLLBACK');
        return { status: 400, body: { error: `variants[${i}] doit être un objet` } };
      }
      if (!v.type || typeof v.type !== 'string' || !v.type.trim()) {
        await client.query('ROLLBACK');
        return { status: 400, body: { error: `variants[${i}].type requis` } };
      }
      if (!v.value || typeof v.value !== 'string' || !v.value.trim()) {
        await client.query('ROLLBACK');
        return { status: 400, body: { error: `variants[${i}].value requis` } };
      }
      if (v.type.length > 50) {
        await client.query('ROLLBACK');
        return { status: 400, body: { error: `variants[${i}].type trop long (max 50)` } };
      }
      if (v.value.length > 50) {
        await client.query('ROLLBACK');
        return { status: 400, body: { error: `variants[${i}].value trop long (max 50)` } };
      }
      if (v.stock !== undefined && v.stock !== null) {
        const n = Number(v.stock);
        if (!Number.isInteger(n) || n < 0) {
          await client.query('ROLLBACK');
          return { status: 400, body: { error: `variants[${i}].stock invalide (entier >=0 ou null)` } };
        }
      }
      if (v.price_kmf !== undefined && v.price_kmf !== null) {
        const n = Number(v.price_kmf);
        if (!Number.isInteger(n) || n < 0) {
          await client.query('ROLLBACK');
          return { status: 400, body: { error: `variants[${i}].price_kmf invalide (entier >=0 ou null)` } };
        }
      }
    }

    const seen = new Set();
    for (const v of variants) {
      const key = v.type + '||' + v.value;
      if (seen.has(key)) {
        await client.query('ROLLBACK');
        return { status: 400, body: { error: `Doublon : ${v.type}=${v.value}` } };
      }
      seen.add(key);
    }

    const { rows: oldRows } = await client.query(
      `SELECT variant_type, variant_value FROM product_variants WHERE product_id = $1`,
      [productId]
    );
    const newKeys = new Set(variants.map(v => v.type + '||' + v.value));
    const removed = oldRows
      .map(r => ({ type: r.variant_type, value: r.variant_value }))
      .filter(o => !newKeys.has(o.type + '||' + o.value));

    if (removed.length > 0) {
      const { rows: pendingItems } = await client.query(
        `SELECT oi.variant_combo, o.status
           FROM order_items oi
           JOIN orders o ON o.id = oi.order_id
          WHERE oi.product_id = $1
            AND oi.variant_combo IS NOT NULL
            AND o.status IN ('pending', 'pending_group_payment')`,
        [productId]
      );
      for (const item of pendingItems) {
        for (const r of removed) {
          if (item.variant_combo && item.variant_combo[r.type] === r.value) {
            await client.query('ROLLBACK');
            return {
              status: 409,
              body: {
                error: `Variante ${r.type}=${r.value} référencée dans une commande en cours, impossible de la supprimer`,
              },
            };
          }
        }
      }
    }

    await client.query(`DELETE FROM product_variants WHERE product_id = $1`, [productId]);

    for (const v of variants) {
      await client.query(
        `INSERT INTO product_variants
           (product_id, variant_type, variant_value, sku, stock, price_kmf, image_url, images, display_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          productId,
          v.type.trim(),
          v.value.trim(),
          v.sku        ? String(v.sku).trim()        : null,
          v.stock      === undefined || v.stock      === null ? null : Number(v.stock),
          v.price_kmf  === undefined || v.price_kmf  === null ? null : Number(v.price_kmf),
          v.image_url  ? String(v.image_url).trim()  : null,
          JSON.stringify(Array.isArray(v.images) ? v.images : (v.image_url ? [String(v.image_url).trim()] : [])),
          v.display_order != null ? Number(v.display_order) : 0,
        ]
      );
    }

    await client.query(
      `UPDATE products SET has_variants = $1, updated_at = NOW() WHERE id = $2`,
      [variants.length > 0, productId]
    );

    await client.query('COMMIT');

    const { rows: freshRows } = await dbPool.query(
      `SELECT id, variant_type, variant_value, sku, stock, price_kmf, image_url, images, display_order
         FROM product_variants
        WHERE product_id = $1
        ORDER BY variant_type ASC, display_order ASC, variant_value ASC`,
      [productId]
    );

    return {
      status: 200,
      body: {
        success:      true,
        count:        variants.length,
        has_variants: variants.length > 0,
        variants:     freshRows,
      },
    };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  applyPrice,
  updateSourcingFields,
  bulkAssignSourcingRail,
  replaceVariantsForSourcing,
};
