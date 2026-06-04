/**
 * KOMERCE — Routes admin boutique_categories / boutique_subcategories
 *
 * Permet à l'admin de gérer les catégories et sous-catégories boutique
 * directement en base, sans toucher au JS frontend.
 *
 * Categories:
 *   GET    /api/admin/boutique-categories          → liste complète avec subcats
 *   GET    /api/admin/boutique-categories/:key     → détail
 *   POST   /api/admin/boutique-categories          → créer
 *   PUT    /api/admin/boutique-categories/:key     → modifier
 *   DELETE /api/admin/boutique-categories/:key     → soft-delete
 *
 * Subcategories (nested):
 *   GET    /api/admin/boutique-categories/:key/subcategories          → liste
 *   POST   /api/admin/boutique-categories/:key/subcategories          → créer
 *   PUT    /api/admin/boutique-categories/:key/subcategories/:subKey  → modifier
 *   DELETE /api/admin/boutique-categories/:key/subcategories/:subKey  → soft-delete (is_active=FALSE) | ?hard=true pour purge
 */

'use strict';

const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const { invalidateCategoriesCache } = require('../utils/categories-cache');

const guard = [authenticate, requireRole(['admin'])];

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getCategoryWithSubcats(key) {
  const { rows: [cat] } = await db.query(
    'SELECT * FROM boutique_categories WHERE key = $1', [key]
  );
  if (!cat) return null;

  const { rows: subs } = await db.query(
    'SELECT * FROM boutique_subcategories WHERE category_key = $1 ORDER BY display_order',
    [key]
  );
  cat.subcategories = subs;
  return cat;
}

// ─── GET /api/admin/boutique-categories ──────────────────────────────────────
router.get('/', ...guard, async (req, res, next) => {
  try {
    const { active } = req.query;

    let catSql = 'SELECT * FROM boutique_categories';
    const params = [];
    if (active !== undefined) {
      catSql += ' WHERE is_active = $1';
      params.push(active === 'true' || active === '1');
    }
    catSql += ' ORDER BY display_order';

    const { rows: cats } = await db.query(catSql, params);

    // Charger les sous-catégories en une seule requête
    const { rows: allSubs } = await db.query(
      'SELECT * FROM boutique_subcategories ORDER BY category_key, display_order'
    );

    const subsByCat = {};
    allSubs.forEach(s => {
      if (!subsByCat[s.category_key]) subsByCat[s.category_key] = [];
      subsByCat[s.category_key].push(s);
    });

    cats.forEach(c => { c.subcategories = subsByCat[c.key] || []; });

    res.json(cats);
  } catch (err) {
    if (err.code === '42P01') return res.json([]);
    next(err);
  }
});

// ─── GET /api/admin/boutique-categories/:key ──────────────────────────────────
router.get('/:key', ...guard, async (req, res, next) => {
  try {
    const cat = await getCategoryWithSubcats(req.params.key);
    if (!cat) return res.status(404).json({ error: 'Catégorie introuvable' });
    res.json(cat);
  } catch (err) { next(err); }
});

// ─── POST /api/admin/boutique-categories ─────────────────────────────────────
router.post('/', ...guard, async (req, res, next) => {
  try {
    const b = req.body;
    if (!b.key || !b.label) {
      return res.status(400).json({ error: 'key et label obligatoires' });
    }

    const dup = await db.query(
      'SELECT 1 FROM boutique_categories WHERE key = $1', [b.key]
    );
    if (dup.rows.length) {
      return res.status(409).json({ error: 'Une catégorie avec cette clé existe déjà' });
    }

    const { rows: [row] } = await db.query(`
      INSERT INTO boutique_categories
        (key, label, short_label, section_emoji, icon_svg, db_keys,
         filter_type, display_order, show_in_rail, show_in_sections, is_active)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      RETURNING *`,
      [
        b.key,
        b.label,
        b.short_label   || b.label,
        b.section_emoji || '📦',
        b.icon_svg      || null,
        b.db_keys       || [],
        b.filter_type   || null,
        b.display_order !== undefined ? b.display_order : 99,
        b.show_in_rail      !== false,
        b.show_in_sections  !== false,
        b.is_active         !== false,
      ]
    );
    row.subcategories = [];
    invalidateCategoriesCache();
    res.status(201).json(row);
  } catch (err) { next(err); }
});

// ─── PUT /api/admin/boutique-categories/:key ──────────────────────────────────
router.put('/:key', ...guard, async (req, res, next) => {
  try {
    const allowed = [
      'label', 'short_label', 'section_emoji', 'icon_svg',
      'db_keys', 'filter_type', 'display_order',
      'show_in_rail', 'show_in_sections', 'is_active',
    ];
    const updates = [], values = [];
    let pi = 1;
    for (const f of allowed) {
      if (req.body[f] !== undefined) {
        updates.push(`${f} = $${pi++}`);
        values.push(req.body[f]);
      }
    }
    if (!updates.length) {
      return res.status(400).json({ error: 'Aucun champ à mettre à jour' });
    }
    values.push(req.params.key);
    const { rows: [row] } = await db.query(
      `UPDATE boutique_categories
          SET ${updates.join(', ')}, updated_at = NOW()
        WHERE key = $${pi} RETURNING *`,
      values
    );
    if (!row) return res.status(404).json({ error: 'Catégorie introuvable' });
    invalidateCategoriesCache();
    res.json(await getCategoryWithSubcats(row.key));
  } catch (err) { next(err); }
});

// ─── DELETE /api/admin/boutique-categories/:key ───────────────────────────────
// Soft-delete: is_active = FALSE (les produits référencent la catégorie en texte libre)
router.delete('/:key', ...guard, async (req, res, next) => {
  try {
    const { rows: [row] } = await db.query(
      `UPDATE boutique_categories
          SET is_active = FALSE, updated_at = NOW()
        WHERE key = $1 RETURNING *`,
      [req.params.key]
    );
    if (!row) return res.status(404).json({ error: 'Catégorie introuvable' });
    invalidateCategoriesCache();
    res.json({ deactivated: true, category: row });
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// SUBCATEGORIES
// ═══════════════════════════════════════════════════════════════════════════════

// ─── GET /api/admin/boutique-categories/:key/subcategories ────────────────────
router.get('/:key/subcategories', ...guard, async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT * FROM boutique_subcategories
        WHERE category_key = $1 ORDER BY display_order`,
      [req.params.key]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// ─── POST /api/admin/boutique-categories/:key/subcategories ──────────────────
router.post('/:key/subcategories', ...guard, async (req, res, next) => {
  try {
    const catKey = req.params.key;
    const b = req.body;
    if (!b.key || !b.label) {
      return res.status(400).json({ error: 'key et label obligatoires' });
    }

    // Vérifier que la catégorie parente existe
    const parent = await db.query(
      'SELECT 1 FROM boutique_categories WHERE key = $1', [catKey]
    );
    if (!parent.rows.length) {
      return res.status(404).json({ error: 'Catégorie parente introuvable' });
    }

    const { rows: [row] } = await db.query(`
      INSERT INTO boutique_subcategories
        (category_key, key, label, short_label, icon, display_order, is_active)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      RETURNING *`,
      [
        catKey,
        b.key,
        b.label,
        b.short_label   || b.label,
        b.icon          || '✨',
        b.display_order !== undefined ? b.display_order : 99,
        b.is_active     !== false,
      ]
    );
    invalidateCategoriesCache();
    res.status(201).json(row);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Une sous-catégorie avec cette clé existe déjà dans cette catégorie' });
    }
    next(err);
  }
});

// ─── PUT /api/admin/boutique-categories/:key/subcategories/:subKey ────────────
router.put('/:key/subcategories/:subKey', ...guard, async (req, res, next) => {
  try {
    const allowed = ['label', 'short_label', 'icon', 'display_order', 'is_active'];
    const updates = [], values = [];
    let pi = 1;
    for (const f of allowed) {
      if (req.body[f] !== undefined) {
        updates.push(`${f} = $${pi++}`);
        values.push(req.body[f]);
      }
    }
    if (!updates.length) {
      return res.status(400).json({ error: 'Aucun champ à mettre à jour' });
    }
    values.push(req.params.key, req.params.subKey);
    const { rows: [row] } = await db.query(
      `UPDATE boutique_subcategories
          SET ${updates.join(', ')}
        WHERE category_key = $${pi} AND key = $${pi + 1}
        RETURNING *`,
      values
    );
    if (!row) return res.status(404).json({ error: 'Sous-catégorie introuvable' });
    invalidateCategoriesCache();
    res.json(row);
  } catch (err) { next(err); }
});

// ─── DELETE /api/admin/boutique-categories/:key/subcategories/:subKey ─────────
// DSC-B2 — Soft-delete : is_active = FALSE (les produits référencent subcategory en texte libre)
router.delete('/:key/subcategories/:subKey', ...guard, async (req, res, next) => {
  try {
    // ?hard=true réservé admin pour purge explicite
    const hardDelete = req.query.hard === 'true';

    let row;
    if (hardDelete) {
      ({ rows: [row] } = await db.query(
        `DELETE FROM boutique_subcategories
          WHERE category_key = $1 AND key = $2
          RETURNING *`,
        [req.params.key, req.params.subKey]
      ));
    } else {
      ({ rows: [row] } = await db.query(
        `UPDATE boutique_subcategories
            SET is_active = FALSE
          WHERE category_key = $1 AND key = $2
          RETURNING *`,
        [req.params.key, req.params.subKey]
      ));
    }
    if (!row) return res.status(404).json({ error: 'Sous-catégorie introuvable' });
    invalidateCategoriesCache();
    res.json(hardDelete
      ? { deleted: true, subcategory: row }
      : { deactivated: true, subcategory: row });
  } catch (err) { next(err); }
});

module.exports = router;
