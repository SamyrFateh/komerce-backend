'use strict';

/**
 * KOMERCE — Service mutations sourcing (REFACTO-R2)
 *
 * Extraction iso-comportement depuis routes/sourcing-engine.js :
 *   PUT /api/admin/sourcing/products/:id          → updateProduct(id, body)
 *   POST /api/admin/sourcing/bulk-rail            → bulkAssignRail(productIds, rail)
 *   PUT /api/admin/sourcing/products/:id/variants → replaceVariants(id, variants)
 *
 * Note dette colonne (Lot I) : la table `products` a deux paires de colonnes
 * en doublon (cost_kmf/cost_price_kmf, weight_kg/weight_g). Les mutations
 * écrivent les deux colonnes en parallèle pour que pricing-engine reste
 * synchronisé. Ce comportement est préservé iso. Résolution à faire dans
 * une migration dédiée (hors scope R2).
 *
 * Invariant I-08 : pas de coefficient dur ici. La config sourcing est toujours
 * lue via sourcing-analysis.js (loadSourcingConfig).
 *
 * Pattern de retour : { status: number, body: object }
 */

const db = require('../db');
const sourcingAnalysis = require('./sourcing-analysis');

// Champs autorisés pour PUT /products/:id (whitelist iso-comportement)
const ALLOWED_PRODUCT_FIELDS = [
  'sourcing_rail', 'cost_price_kmf', 'weight_g', 'volume_class',
  'fragility', 'sale_mode', 'exposure_mode', 'lifecycle_status',
  'quality_validated', 'real_weight_known', 'real_price_validated',
  'delivery_delay_days', 'supplier_notes',
];

const VALID_RAILS = ['A', 'B', 'C', 'D'];

// ── updateProduct ───────────────────────────────────────────────────────────

/**
 * Met à jour les métadonnées sourcing d'un produit.
 * Synchronise cost_kmf ↔ cost_price_kmf et weight_kg ↔ weight_g (dette Lot I).
 * Retourne une analyse fraîche du produit via sourcing-analysis.
 *
 * @param {string} productId
 * @param {object} body
 * @returns {Promise<{ status: number, body: object }>}
 */
async function updateProduct(productId, body) {
  const sets = [];
  const vals = [];
  let idx = 1;

  for (const key of ALLOWED_PRODUCT_FIELDS) {
    if (body[key] !== undefined) {
      sets.push(`${key} = $${idx}`);
      vals.push(body[key]);
      idx++;

      // Sync colonnes sœurs (dette Lot I)
      if (key === 'cost_price_kmf') {
        sets.push(`cost_kmf = $${idx}`);
        vals.push(body[key]);
        idx++;
      }
      if (key === 'weight_g') {
        sets.push(`weight_kg = $${idx}`);
        const w = Number(body[key]);
        vals.push(isFinite(w) && w > 0 ? Math.round((w / 1000) * 100) / 100 : null);
        idx++;
      }
    }
  }

  if (sets.length === 0) {
    return { status: 400, body: { error: 'Aucun champ à mettre à jour' } };
  }

  sets.push('last_review_at = NOW()');
  vals.push(productId);

  const { rows } = await db.query(
    `UPDATE products SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
    vals
  );

  if (!rows.length) {
    return { status: 404, body: { error: 'Produit introuvable' } };
  }

  const cfg      = await sourcingAnalysis.loadSourcingConfig();
  const salesMap = await sourcingAnalysis.getSales30d();
  const analysis = sourcingAnalysis.analyzeProduct(rows[0], cfg, salesMap);

  return { status: 200, body: { success: true, product: analysis } };
}

// ── bulkAssignRail ──────────────────────────────────────────────────────────

/**
 * Assigne un rail sourcing (A/B/C/D) à plusieurs produits en une seule query.
 *
 * @param {string[]} productIds
 * @param {string}   rail
 * @returns {Promise<{ status: number, body: object }>}
 */
async function bulkAssignRail(productIds, rail) {
  if (!productIds || !Array.isArray(productIds) || !rail) {
    return { status: 400, body: { error: 'product_ids (array) et rail (A/B/C/D) requis' } };
  }
  if (!VALID_RAILS.includes(rail.toUpperCase())) {
    return { status: 400, body: { error: 'Rail invalide — A, B, C ou D' } };
  }

  const { rowCount } = await db.query(
    `UPDATE products SET sourcing_rail = $1, last_review_at = NOW() WHERE id = ANY($2)`,
    [rail.toUpperCase(), productIds]
  );

  return { status: 200, body: { success: true, updated: rowCount } };
}

// ── replaceVariants ─────────────────────────────────────────────────────────

/**
 * Remplace ATOMIQUEMENT toutes les variantes d'un produit.
 * - Tableau vide → supprime tout + has_variants = false
 * - Tableau non vide → wipe + recréation + has_variants = true
 *
 * Garde-fou : refuse si une variante en cours de suppression est référencée
 * dans une commande `pending` ou `pending_group_payment`.
 *
 * @param {string} productId
 * @param {object[]} variants
 * @returns {Promise<{ status: number, body: object }>}
 */
async function replaceVariants(productId, variants) {
  const client = await db.getClient();
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

    // Vérifier que le produit existe (avec verrou)
    const { rows: prodRows } = await client.query(
      `SELECT id FROM products WHERE id = $1 FOR UPDATE`,
      [productId]
    );
    if (!prodRows.length) {
      await client.query('ROLLBACK');
      return { status: 404, body: { error: 'Produit introuvable' } };
    }

    // ── Validation des entrées ──────────────────────────────────────────
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

    // ── Détection doublons (type, value) ───────────────────────────────
    const seen = new Set();
    for (const v of variants) {
      const key = v.type + '||' + v.value;
      if (seen.has(key)) {
        await client.query('ROLLBACK');
        return { status: 400, body: { error: `Doublon : ${v.type}=${v.value}` } };
      }
      seen.add(key);
    }

    // ── Garde-fou commandes pending ────────────────────────────────────
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

    // ── Wipe + recréation atomique ─────────────────────────────────────
    await client.query(`DELETE FROM product_variants WHERE product_id = $1`, [productId]);

    for (const v of variants) {
      await client.query(
        `INSERT INTO product_variants
           (product_id, variant_type, variant_value, sku, stock, price_kmf, image_url, display_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          productId,
          v.type.trim(),
          v.value.trim(),
          v.sku        ? String(v.sku).trim()        : null,
          v.stock      === undefined || v.stock      === null ? null : Number(v.stock),
          v.price_kmf  === undefined || v.price_kmf  === null ? null : Number(v.price_kmf),
          v.image_url  ? String(v.image_url).trim()  : null,
          v.display_order != null ? Number(v.display_order) : 0,
        ]
      );
    }

    await client.query(
      `UPDATE products SET has_variants = $1, updated_at = NOW() WHERE id = $2`,
      [variants.length > 0, productId]
    );

    await client.query('COMMIT');

    const { rows: freshRows } = await db.query(
      `SELECT id, variant_type, variant_value, sku, stock, price_kmf, image_url, display_order
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

module.exports = { updateProduct, bulkAssignRail, replaceVariants };
