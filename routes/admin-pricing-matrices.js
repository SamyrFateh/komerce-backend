/**
 * @komerce-arch
 * @role          economic-engine-admin-pricing-matrices
 * @domain        economic-engine
 * @layer         route
 * @criticality   high
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db.js, middleware/auth.js, services/*
 * @used-by       bootstrap/api-routes.js
 * @db-read       pricing_category_dims, pricing_category_taxes, users
 * @db-write      pricing_category_dims, pricing_category_taxes, pricing_matrices_audit
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  economic-engine, admin-dashboard
 * @version       2026-06
 */

/**
 * KOMERCE — Routes admin pour piloter les matrices pricing
 *
 * Deux tables :
 *   - pricing_category_taxes : douane/tva/taxe_add par catégorie
 *   - pricing_category_dims  : length/width/height par catégorie
 *
 * Endpoints :
 *   GET  /api/admin/pricing-matrices/taxes           — Toutes les taxes
 *   PUT  /api/admin/pricing-matrices/taxes/:category — Modifier taxes d'une catégorie
 *   GET  /api/admin/pricing-matrices/dims            — Toutes les dimensions
 *   PUT  /api/admin/pricing-matrices/dims/:category  — Modifier dims d'une catégorie
 *
 * Sécurité : admin only
 * Impact : CRITIQUE — modifie directement le calcul de pricing
 */

'use strict';

const express = require('express');
const router  = express.Router();

const db      = require('../db');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { invalidatePricingMatricesCache } = require('../utils/pricing-cache');
const log = require('../utils/logger').child({ module: 'admin-pricing-matrices' });

const ALLOWED_CATEGORIES = ['electronique', 'maison', 'mariage', 'mode_beaute', 'enfants'];

// ── GET /api/admin/pricing-matrices/taxes ──────────────────────────────────
router.get('/taxes', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { rows } = await db.query(`
      SELECT category, label_fr,
             douane_pct, tva_pct, taxe_add_pct,
             updated_at,
             (SELECT full_name FROM users WHERE id = t.updated_by) AS updated_by_name
      FROM pricing_category_taxes t
      ORDER BY category
    `);
    res.json({ taxes: rows });
  } catch (err) { next(err); }
});

// ── PUT /api/admin/pricing-matrices/taxes/:category ────────────────────────
router.put('/taxes/:category', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const category = String(req.params.category).toLowerCase();
    if (!ALLOWED_CATEGORIES.includes(category)) {
      return res.status(400).json({ error: 'Catégorie inconnue' });
    }

    const { douane_pct, tva_pct, taxe_add_pct, reason } = req.body || {};

    // Justification obligatoire (matrices = critiques)
    if (!reason || typeof reason !== 'string' || reason.trim().length < 10) {
      return res.status(400).json({
        error: 'La justification est obligatoire (minimum 10 caractères).'
      });
    }

    // Validation valeurs (0-1 = 0-100%)
    for (const [k, v] of Object.entries({ douane_pct, tva_pct, taxe_add_pct })) {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0 || n > 1) {
        return res.status(400).json({
          error: `${k} doit être un nombre entre 0 et 1 (ex: 0.15 pour 15%)`
        });
      }
    }

    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      // Récupérer l'ancienne valeur pour audit
      const { rows: [oldRow] } = await client.query(
        'SELECT * FROM pricing_category_taxes WHERE category = $1',
        [category]
      );

      if (!oldRow) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Catégorie non initialisée' });
      }

      // Update
      const { rows: [newRow] } = await client.query(`
        UPDATE pricing_category_taxes
        SET douane_pct = $1, tva_pct = $2, taxe_add_pct = $3,
            updated_at = NOW(), updated_by = $4
        WHERE category = $5
        RETURNING *
      `, [douane_pct, tva_pct, taxe_add_pct, req.user.id, category]);

      // Audit log : créer une entrée dans business_rules_history
      // (on utilise la même table d'audit pour centraliser)
      try {
        await client.query('SAVEPOINT sp_pricing_matrices_audit_taxes');
        await client.query(`
          INSERT INTO pricing_matrices_audit
            (matrix_type, category, old_value, new_value, changed_by, change_reason)
          VALUES ('taxes', $1, $2, $3, $4, $5)
        `, [
          category,
          JSON.stringify({ douane_pct: oldRow.douane_pct, tva_pct: oldRow.tva_pct, taxe_add_pct: oldRow.taxe_add_pct }),
          JSON.stringify({ douane_pct, tva_pct, taxe_add_pct }),
          req.user.id,
          reason.trim().slice(0, 500)
        ]);
        await client.query('RELEASE SAVEPOINT sp_pricing_matrices_audit_taxes');
      } catch (auditErr) {
        // Audit best-effort, ne bloque pas l'update — sans SAVEPOINT, cette
        // erreur aborterait la transaction et le COMMIT suivant deviendrait
        // un ROLLBACK silencieux (RED-2/RED-2b, PR563 — twin de TXG-01, même
        // fichier, route /taxes au lieu de /dims).
        await client.query('ROLLBACK TO SAVEPOINT sp_pricing_matrices_audit_taxes').catch(() => {});
        log.warn('[PRICING] Audit taxes skipped:', auditErr.message);
      }

      await client.query('COMMIT');
      invalidatePricingMatricesCache();

      res.json({
        success: true,
        taxes: newRow,
        message: `Taxes "${category}" mises à jour. Cache invalidé.`
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally { client.release(); }
  } catch (err) { next(err); }
});

// ── GET /api/admin/pricing-matrices/dims ───────────────────────────────────
router.get('/dims', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { rows } = await db.query(`
      SELECT category, label_fr,
             length_cm, width_cm, height_cm,
             updated_at,
             (SELECT full_name FROM users WHERE id = d.updated_by) AS updated_by_name
      FROM pricing_category_dims d
      ORDER BY category
    `);
    res.json({ dims: rows });
  } catch (err) { next(err); }
});

// ── PUT /api/admin/pricing-matrices/dims/:category ─────────────────────────
router.put('/dims/:category', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const category = String(req.params.category).toLowerCase();
    if (!ALLOWED_CATEGORIES.includes(category)) {
      return res.status(400).json({ error: 'Catégorie inconnue' });
    }

    const { length_cm, width_cm, height_cm, reason } = req.body || {};

    if (!reason || typeof reason !== 'string' || reason.trim().length < 10) {
      return res.status(400).json({
        error: 'La justification est obligatoire (minimum 10 caractères).'
      });
    }

    // Validation dimensions (positives, max 200 cm)
    for (const [k, v] of Object.entries({ length_cm, width_cm, height_cm })) {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1 || n > 200) {
        return res.status(400).json({
          error: `${k} doit être un entier entre 1 et 200 cm`
        });
      }
    }

    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      const { rows: [oldRow] } = await client.query(
        'SELECT * FROM pricing_category_dims WHERE category = $1',
        [category]
      );

      if (!oldRow) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Catégorie non initialisée' });
      }

      const { rows: [newRow] } = await client.query(`
        UPDATE pricing_category_dims
        SET length_cm = $1, width_cm = $2, height_cm = $3,
            updated_at = NOW(), updated_by = $4
        WHERE category = $5
        RETURNING *
      `, [length_cm, width_cm, height_cm, req.user.id, category]);

      try {
        await client.query('SAVEPOINT sp_pricing_matrices_audit');
        await client.query(`
          INSERT INTO pricing_matrices_audit
            (matrix_type, category, old_value, new_value, changed_by, change_reason)
          VALUES ('dims', $1, $2, $3, $4, $5)
        `, [
          category,
          JSON.stringify({ length_cm: oldRow.length_cm, width_cm: oldRow.width_cm, height_cm: oldRow.height_cm }),
          JSON.stringify({ length_cm, width_cm, height_cm }),
          req.user.id,
          reason.trim().slice(0, 500)
        ]);
        await client.query('RELEASE SAVEPOINT sp_pricing_matrices_audit');
      } catch (auditErr) {
        // Audit best-effort, ne bloque pas l'update — sans SAVEPOINT, cette
        // erreur aborterait la transaction et le COMMIT suivant deviendrait
        // un ROLLBACK silencieux (RED-2/RED-2b, PR563).
        await client.query('ROLLBACK TO SAVEPOINT sp_pricing_matrices_audit').catch(() => {});
        log.warn('[PRICING] Audit dims skipped:', auditErr.message);
      }

      await client.query('COMMIT');
      invalidatePricingMatricesCache();

      res.json({
        success: true,
        dims: newRow,
        message: `Dimensions "${category}" mises à jour. Cache invalidé.`
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally { client.release(); }
  } catch (err) { next(err); }
});

module.exports = router;
