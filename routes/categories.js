/**
 * KOMERCE — Route publique GET /api/categories
 *
 * DSC-B1 — Stratégie de cache (§4.3) :
 *   Cache-Control: no-cache    → revalidation systématique (pas de max-age fixe).
 *   ETag: "v<version>-<ts>"    → 304 Not Modified si le schéma n'a pas changé.
 *   X-Schema-Version: <n>      → debug / polling léger côté front.
 *
 *   Après une écriture admin (POST/PUT/DELETE), invalidateCategoriesCache()
 *   incrémente la version → le prochain GET reçoit un nouvel ETag → 200 + arbre.
 *
 * Retourne le schéma complet (catégories + sous-catégories actives) depuis
 * boutique_categories et boutique_subcategories.
 * Fallback : si les tables n'existent pas encore (pré-migration), retourne [].
 */

'use strict';

const express  = require('express');
const router   = express.Router();
const db       = require('../db');
const { getCategoriesETag, getCategoriesVersion } = require('../utils/categories-cache');

// ─── GET /api/categories ──────────────────────────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const etag = getCategoriesETag();

    // Revalidation : 304 si le client a déjà la bonne version
    if (req.headers['if-none-match'] === etag) {
      res.setHeader('ETag', etag);
      res.setHeader('X-Schema-Version', getCategoriesVersion());
      return res.status(304).end();
    }

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

    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('ETag', etag);
    res.setHeader('X-Schema-Version', getCategoriesVersion());
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
