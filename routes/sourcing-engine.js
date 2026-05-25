/**
 * KOMERCE — Moteur de lecture sourcing
 *
 * Philosophie :
 * "Le moteur ne remplace pas le jugement terrain.
 *  Il l'éclaire, le cadre, puis apprend de lui."
 *
 * Endpoints :
 *   GET  /api/admin/sourcing/analysis          — analyse complète du portefeuille
 *   GET  /api/admin/sourcing/analysis/:id       — analyse d'un produit
 *   GET  /api/admin/sourcing/synthesis          — synthèse portefeuille (KPIs)
 *   PUT  /api/admin/sourcing/products/:id       — enrichir les métadonnées sourcing
 *   POST /api/admin/sourcing/bulk-rail          — assigner un rail à N produits
 *   GET  /api/admin/sourcing/config             — lire les seuils sourcing
 *   GET  /api/admin/sourcing/products/:id/variants  — lire variantes (Vague 3)
 *   PUT  /api/admin/sourcing/products/:id/variants  — poser variantes (Vague 3)
 *
 * Toutes routes : admin only
 * Tous seuils : lus depuis finance_config (variabilisés)
 *
 * GOD-FILES-5 (2026-05-25) : logique de lecture extraite vers
 * services/sourcing-analysis.js. Les mutations restent ici.
 */

'use strict';

const express = require('express');
const router  = express.Router();

const db = require('../db');
const { authenticate, requireAdmin } = require('../middleware/auth');
const sourcingAnalysis = require('../services/sourcing-analysis');

// ══════════════════════════════════════════════════════════════════════════
// Helpers LOT I — conservés ici pour les handlers de mutation (PUT/POST)
// qui font des écritures synchronisées cost_kmf/weight_kg.
// ══════════════════════════════════════════════════════════════════════════
//
// La table products a accumulé des colonnes en doublon :
//   - cost_kmf (initial, INTEGER)  vs cost_price_kmf (ajouté plus tard, INTEGER)
//   - weight_kg (initial, NUMERIC) vs weight_g (ajouté plus tard, INTEGER)
//
// Solution :
//   - Écriture : la mutation PUT /products/:id écrit les 2 colonnes en parallèle.
//   - Lecture : déléguée à services/sourcing-analysis.js
//

// ══════════════════════════════════════════════════════════════════════════
// 1. GET /analysis — analyse complète du portefeuille
// ══════════════════════════════════════════════════════════════════════════
router.get('/analysis', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const data = await sourcingAnalysis.getAnalysis(req.query);
    res.json(data);
  } catch (err) { next(err); }
});

// ══════════════════════════════════════════════════════════════════════════
// 2. GET /analysis/:id — analyse d'un produit
// ══════════════════════════════════════════════════════════════════════════
router.get('/analysis/:id', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const analysis = await sourcingAnalysis.getAnalysisById(req.params.id);
    if (!analysis) return res.status(404).json({ error: 'Produit introuvable' });
    res.json(analysis);
  } catch (err) { next(err); }
});

// ══════════════════════════════════════════════════════════════════════════
// 3. GET /synthesis — synthèse portefeuille (KPIs)
// ══════════════════════════════════════════════════════════════════════════
router.get('/synthesis', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const data = await sourcingAnalysis.getSynthesis();
    res.json(data);
  } catch (err) { next(err); }
});

// ══════════════════════════════════════════════════════════════════════════
// 4. PUT /products/:id — enrichir les métadonnées sourcing
// ══════════════════════════════════════════════════════════════════════════
router.put('/products/:id', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const allowed = [
      'sourcing_rail', 'cost_price_kmf', 'weight_g', 'volume_class',
      'fragility', 'sale_mode', 'exposure_mode', 'lifecycle_status',
      'quality_validated', 'real_weight_known', 'real_price_validated',
      'delivery_delay_days', 'supplier_notes',
    ];

    const sets = [];
    const vals = [];
    let idx = 1;

    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        sets.push(`${key} = $${idx}`);
        vals.push(req.body[key]);
        idx++;

        // Lot I : sync vers la colonne soeur en parallèle
        // pour que pricing-engine voit aussi la mise à jour.
        if (key === 'cost_price_kmf') {
          sets.push(`cost_kmf = $${idx}`);
          vals.push(req.body[key]);
          idx++;
        }
        if (key === 'weight_g') {
          sets.push(`weight_kg = $${idx}`);
          // Conversion grammes → kg avec 2 décimales
          const w = Number(req.body[key]);
          vals.push(isFinite(w) && w > 0 ? Math.round((w / 1000) * 100) / 100 : null);
          idx++;
        }
      }
    }

    if (sets.length === 0) {
      return res.status(400).json({ error: 'Aucun champ à mettre à jour' });
    }

    // Always update last_review_at
    sets.push(`last_review_at = NOW()`);

    vals.push(req.params.id);
    const { rows } = await db.query(
      `UPDATE products SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
      vals
    );

    if (!rows.length) return res.status(404).json({ error: 'Produit introuvable' });

    // Return fresh analysis
    const cfg = await sourcingAnalysis.loadSourcingConfig();
    const salesMap = await sourcingAnalysis.getSales30d();
    const analysis = sourcingAnalysis.analyzeProduct(rows[0], cfg, salesMap);

    res.json({ success: true, product: analysis });
  } catch (err) { next(err); }
});

// ══════════════════════════════════════════════════════════════════════════
// 5. POST /bulk-rail — assigner un rail à plusieurs produits
// ══════════════════════════════════════════════════════════════════════════
router.post('/bulk-rail', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { product_ids, rail } = req.body;
    if (!product_ids || !Array.isArray(product_ids) || !rail) {
      return res.status(400).json({ error: 'product_ids (array) et rail (A/B/C/D) requis' });
    }
    if (!['A', 'B', 'C', 'D'].includes(rail.toUpperCase())) {
      return res.status(400).json({ error: 'Rail invalide — A, B, C ou D' });
    }

    const { rowCount } = await db.query(
      `UPDATE products SET sourcing_rail = $1, last_review_at = NOW() WHERE id = ANY($2)`,
      [rail.toUpperCase(), product_ids]
    );

    res.json({ success: true, updated: rowCount });
  } catch (err) { next(err); }
});

// ══════════════════════════════════════════════════════════════════════════
// 6. GET /config — lire les seuils sourcing actuels
// ══════════════════════════════════════════════════════════════════════════
router.get('/config', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const data = await sourcingAnalysis.getConfig();
    res.json(data);
  } catch (err) { next(err); }
});

// ══════════════════════════════════════════════════════════════════════════
// 7. GET /products/:id/variants — lire les variantes d'un produit (Vague 3)
// ══════════════════════════════════════════════════════════════════════════
router.get('/products/:id/variants', authenticate, requireAdmin, async (req, res, next) => {
  try {
    // Vérifier que le produit existe
    const { rows: prodRows } = await db.query(
      `SELECT id, has_variants FROM products WHERE id = $1`,
      [req.params.id]
    );
    if (!prodRows.length) return res.status(404).json({ error: 'Produit introuvable' });

    const { rows } = await db.query(
      `SELECT id, variant_type, variant_value, sku, stock, price_kmf, image_url, display_order,
              created_at, updated_at
         FROM product_variants
        WHERE product_id = $1
        ORDER BY variant_type ASC, display_order ASC, variant_value ASC`,
      [req.params.id]
    );

    res.json({
      product_id:    req.params.id,
      has_variants:  prodRows[0].has_variants,
      variants:      rows,
      total:         rows.length,
    });
  } catch (err) { next(err); }
});

// ══════════════════════════════════════════════════════════════════════════
// 8. PUT /products/:id/variants — poser/remplacer toutes les variantes (Vague 3)
// ══════════════════════════════════════════════════════════════════════════
// Body : { variants: [{ type, value, stock?, price_kmf?, image_url?, sku?, display_order? }, ...] }
//
// Comportement : remplace ATOMIQUEMENT toutes les variantes du produit par
// celles fournies. Si tableau vide → supprime toutes les variantes et passe
// has_variants = false. Sinon → ajoute toutes et passe has_variants = true.
//
// Garde-fou : refuse si une variante actuellement référencée dans des
// order_items pending sera supprimée par l'opération.
//
// Réponse : { success: true, count, variants: [...] }
router.put('/products/:id/variants', authenticate, requireAdmin, async (req, res, next) => {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    const { variants = [] } = req.body || {};
    if (!Array.isArray(variants)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'variants doit être un tableau' });
    }
    if (variants.length > 50) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Maximum 50 variantes par produit' });
    }

    // Vérifier que le produit existe
    const { rows: prodRows } = await client.query(
      `SELECT id FROM products WHERE id = $1 FOR UPDATE`,
      [req.params.id]
    );
    if (!prodRows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Produit introuvable' });
    }

    // ── Validation des entrées ─────────────────────────────────────────────
    // (whitelist inline cohérente avec le pattern de PUT /products/:id existant)
    for (let i = 0; i < variants.length; i++) {
      const v = variants[i];
      if (!v || typeof v !== 'object') {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `variants[${i}] doit être un objet` });
      }
      if (!v.type || typeof v.type !== 'string' || !v.type.trim()) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `variants[${i}].type requis` });
      }
      if (!v.value || typeof v.value !== 'string' || !v.value.trim()) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `variants[${i}].value requis` });
      }
      if (v.type.length > 50) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `variants[${i}].type trop long (max 50)` });
      }
      if (v.value.length > 50) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `variants[${i}].value trop long (max 50)` });
      }
      if (v.stock !== undefined && v.stock !== null) {
        const n = Number(v.stock);
        if (!Number.isInteger(n) || n < 0) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: `variants[${i}].stock invalide (entier >=0 ou null)` });
        }
      }
      if (v.price_kmf !== undefined && v.price_kmf !== null) {
        const n = Number(v.price_kmf);
        if (!Number.isInteger(n) || n < 0) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: `variants[${i}].price_kmf invalide (entier >=0 ou null)` });
        }
      }
    }

    // ── Détection doublons (type, value) ──────────────────────────────────
    const seen = new Set();
    for (const v of variants) {
      const key = v.type + '||' + v.value;
      if (seen.has(key)) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `Doublon : ${v.type}=${v.value}` });
      }
      seen.add(key);
    }

    // ── Garde-fou commandes pending ───────────────────────────────────────
    // Vérifier qu'aucune variante actuellement utilisée dans une commande
    // non finalisée ne va disparaître. On compare l'ancien set au nouveau.
    const { rows: oldRows } = await client.query(
      `SELECT variant_type, variant_value FROM product_variants WHERE product_id = $1`,
      [req.params.id]
    );
    const newKeys = new Set(variants.map(v => v.type + '||' + v.value));
    const removed = oldRows
      .map(r => ({ type: r.variant_type, value: r.variant_value }))
      .filter(o => !newKeys.has(o.type + '||' + o.value));

    if (removed.length > 0) {
      // Vérifier qu'aucune order_items pending ne référence ces combos
      // Statuts pending = avant 'confirmed' (paiement reçu).
      const { rows: pendingItems } = await client.query(
        `SELECT oi.variant_combo, o.status
           FROM order_items oi
           JOIN orders o ON o.id = oi.order_id
          WHERE oi.product_id = $1
            AND oi.variant_combo IS NOT NULL
            AND o.status IN ('pending', 'pending_group_payment')`,
        [req.params.id]
      );
      for (const item of pendingItems) {
        for (const r of removed) {
          if (item.variant_combo && item.variant_combo[r.type] === r.value) {
            await client.query('ROLLBACK');
            return res.status(409).json({
              error: `Variante ${r.type}=${r.value} référencée dans une commande en cours, impossible de la supprimer`,
            });
          }
        }
      }
    }

    // ── Wipe + recréation atomique ────────────────────────────────────────
    await client.query(
      `DELETE FROM product_variants WHERE product_id = $1`,
      [req.params.id]
    );

    for (const v of variants) {
      await client.query(
        `INSERT INTO product_variants
           (product_id, variant_type, variant_value, sku, stock, price_kmf, image_url, display_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          req.params.id,
          v.type.trim(),
          v.value.trim(),
          v.sku ? String(v.sku).trim() : null,
          v.stock === undefined || v.stock === null ? null : Number(v.stock),
          v.price_kmf === undefined || v.price_kmf === null ? null : Number(v.price_kmf),
          v.image_url ? String(v.image_url).trim() : null,
          v.display_order != null ? Number(v.display_order) : 0,
        ]
      );
    }

    // ── Mise à jour du flag has_variants ──────────────────────────────────
    await client.query(
      `UPDATE products
          SET has_variants = $1, updated_at = NOW()
        WHERE id = $2`,
      [variants.length > 0, req.params.id]
    );

    await client.query('COMMIT');

    // Re-lire pour retourner l'état frais
    const { rows: freshRows } = await db.query(
      `SELECT id, variant_type, variant_value, sku, stock, price_kmf, image_url, display_order
         FROM product_variants
        WHERE product_id = $1
        ORDER BY variant_type ASC, display_order ASC, variant_value ASC`,
      [req.params.id]
    );

    res.json({
      success:      true,
      count:        variants.length,
      has_variants: variants.length > 0,
      variants:     freshRows,
    });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    next(err);
  } finally {
    client.release();
  }
});

module.exports = router;
