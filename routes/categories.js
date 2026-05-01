/**
 * KOMERCE — Route publique GET /api/categories
 *
 * Retourne le schéma complet de la boutique (catégories + sous-catégories)
 * depuis les tables boutique_categories et boutique_subcategories.
 *
 * Consommé par shop-schema.js au boot de la boutique et par l'admin.
 *
 * Cache-Control: 5 min (les catégories changent rarement).
 * Fallback: si les tables n'existent pas encore (pre-migration), retourne [].
 */

'use strict';

const express = require('express');
const router  = express.Router();
const db      = require('../db');

// ─── GET /api/categories ──────────────────────────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const { rows } = await db.query(`
      SELECT
        bc.key,
        bc.label,
        bc.short_label,
        bc.section_emoji,
        bc.icon_svg,
        bc.db_keys,
        bc.filter_type,
        bc.display_order,
        bc.show_in_rail,
        bc.show_in_sections,
        COALESCE(
          json_agg(
            json_build_object(
              'key',           bs.key,
              'label',         bs.label,
              'short_label',   COALESCE(bs.short_label, bs.label),
              'icon',          bs.icon,
              'display_order', bs.display_order
            ) ORDER BY bs.display_order
          ) FILTER (WHERE bs.key IS NOT NULL AND bs.is_active = TRUE),
          '[]'::json
        ) AS subcategories
      FROM  boutique_categories bc
      LEFT  JOIN boutique_subcategories bs ON bs.category_key = bc.key
      WHERE bc.is_active = TRUE
      GROUP BY bc.key, bc.label, bc.short_label, bc.section_emoji, bc.icon_svg,
               bc.db_keys, bc.filter_type, bc.display_order,
               bc.show_in_rail, bc.show_in_sections
      ORDER BY bc.display_order
    `);

    res.setHeader('Cache-Control', 'public, max-age=300');
    res.json(rows);
  } catch (err) {
    // Table absente (migration non encore jouée) → retour gracieux
    if (err.code === '42P01') {
      res.setHeader('Cache-Control', 'no-store');
      return res.json([]);
    }
    next(err);
  }
});

module.exports = router;
