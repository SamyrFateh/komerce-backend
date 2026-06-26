/**
 * @komerce-arch
 * @role          dashboard-admin-customs-categories
 * @domain        douane
 * @layer         route
 * @criticality   high
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db.js, middleware/auth.js, services/*
 * @used-by       bootstrap/api-routes.js
 * @db-read       customs_categories
 * @db-write      customs_categories
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  dashboard, admin-dashboard
 * @version       2026-06
 */


'use strict';
/**
 * KOMERCE — Routes admin pour customs_categories (Étape 0 audit)
 *
 * Permet à l'admin de gérer les catégories douanières dans la BDD au lieu
 * d'avoir les 8 catégories en dur dans le JS du pricing.
 *
 * GET    /api/admin/customs-categories         → liste
 * GET    /api/admin/customs-categories/:key    → détail
 * POST   /api/admin/customs-categories         → créer
 * PUT    /api/admin/customs-categories/:key    → modifier
 * DELETE /api/admin/customs-categories/:key    → soft-delete (is_active = false)
 */

const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');

const guard = [authenticate, requireRole(['admin'])];

// ─── GET /api/admin/customs-categories ─────────────────────────────
router.get('/', ...guard, async (req, res, next) => {
  try {
    const { active } = req.query;
    let sql = 'SELECT * FROM customs_categories';
    const params = [];
    if (active !== undefined) {
      sql += ' WHERE is_active = $1';
      params.push(active === 'true' || active === '1');
    }
    sql += ' ORDER BY display_order, label';
    const { rows } = await db.query(sql, params);
    res.json(rows);
  } catch (err) {
    // Table not yet created (migration 036 not run) → fallback empty
    res.json([]);
  }
});

// ─── GET /api/admin/customs-categories/:key ────────────────────────
router.get('/:key', ...guard, async (req, res, next) => {
  try {
    const { rows: [row] } = await db.query(
      'SELECT * FROM customs_categories WHERE key = $1', [req.params.key]
    );
    if (!row) return res.status(404).json({ error: 'Catégorie introuvable' });
    res.json(row);
  } catch (err) { next(err); }
});

// ─── POST /api/admin/customs-categories ────────────────────────────
router.post('/', ...guard, async (req, res, next) => {
  try {
    const b = req.body;
    if (!b.key || !b.label) {
      return res.status(400).json({ error: 'key et label obligatoires' });
    }
    // Vérifier unicité
    const dup = await db.query('SELECT 1 FROM customs_categories WHERE key = $1', [b.key]);
    if (dup.rows.length) {
      return res.status(409).json({ error: 'Une catégorie avec cette clé existe déjà' });
    }

    const { rows: [row] } = await db.query(
      `INSERT INTO customs_categories (
         key, label, sub_label, emoji,
         douane_pct, tva_pct, taxe_add_pct,
         default_dim_l_cm, default_dim_w_cm, default_dim_h_cm,
         sh_code, hint, default_margin_pct,
         display_order, is_active
       ) VALUES (
         $1, $2, $3, $4,
         $5, $6, $7,
         $8, $9, $10,
         $11, $12, $13,
         $14, $15
       ) RETURNING *`,
      [
        b.key, b.label, b.sub_label || null, b.emoji || null,
        b.douane_pct || 0, b.tva_pct || 10, b.taxe_add_pct || 0,
        b.default_dim_l_cm || null, b.default_dim_w_cm || null, b.default_dim_h_cm || null,
        b.sh_code || null, b.hint || null, b.default_margin_pct || null,
        b.display_order || 99, b.is_active !== false
      ]
    );
    res.status(201).json(row);
  } catch (err) { next(err); }
});

// ─── PUT /api/admin/customs-categories/:key ────────────────────────
router.put('/:key', ...guard, async (req, res, next) => {
  try {
    const allowed = [
      'label', 'sub_label', 'emoji',
      'douane_pct', 'tva_pct', 'taxe_add_pct',
      'default_dim_l_cm', 'default_dim_w_cm', 'default_dim_h_cm',
      'sh_code', 'hint', 'default_margin_pct',
      'display_order', 'is_active'
    ];
    const updates = [], values = [];
    let pi = 1;
    for (const f of allowed) {
      if (req.body[f] !== undefined) {
        updates.push(`${f} = $${pi++}`);
        values.push(req.body[f]);
      }
    }
    if (!updates.length) return res.status(400).json({ error: 'Aucun champ à mettre à jour' });
    values.push(req.params.key);
    const { rows: [row] } = await db.query(
      `UPDATE customs_categories SET ${updates.join(', ')}, updated_at = NOW()
        WHERE key = $${pi} RETURNING *`, values
    );
    if (!row) return res.status(404).json({ error: 'Catégorie introuvable' });
    res.json(row);
  } catch (err) { next(err); }
});

// ─── PUT /api/admin/customs-categories/:key/toggle ─────────────────
// Raccourci pour toggle is_active sans avoir à connaître la valeur actuelle.
router.put('/:key/toggle', ...guard, async (req, res, next) => {
  try {
    const { rows: [row] } = await db.query(
      `UPDATE customs_categories
          SET is_active = NOT is_active, updated_at = NOW()
        WHERE key = $1 RETURNING *`,
      [req.params.key]
    );
    if (!row) return res.status(404).json({ error: 'Catégorie introuvable' });
    res.json(row);
  } catch (err) { next(err); }
});

// ─── DELETE /api/admin/customs-categories/:key ─────────────────────
// Soft-delete (is_active = false) car les products référencent la category par sa clé.
router.delete('/:key', ...guard, async (req, res, next) => {
  try {
    const { rows: [row] } = await db.query(
      `UPDATE customs_categories SET is_active = FALSE, updated_at = NOW()
        WHERE key = $1 RETURNING *`,
      [req.params.key]
    );
    if (!row) return res.status(404).json({ error: 'Catégorie introuvable' });
    res.json({ deactivated: true, category: row });
  } catch (err) { next(err); }
});

module.exports = router;

