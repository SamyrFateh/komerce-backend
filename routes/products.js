/**
 * KOMERCE — Routes produits
 *
 * GET  /api/products          → liste des produits actifs (avec filtre promo)
 * GET  /api/products/:id      → détail d'un produit
 * POST /api/products          → créer un produit (admin)
 * PUT  /api/products/:id      → modifier un produit (admin)
 */

const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');

// ── GET /api/products ─────────────────────────────────────────────────────────
// Retourne tous les produits actifs.
// Query params optionnels : ?promo=true | ?category=Téléphones
router.get('/', async (req, res) => {
  try {
    const { promo, category } = req.query;

    let sql    = 'SELECT * FROM products WHERE is_active = TRUE';
    const params = [];

    if (promo === 'true') {
      params.push(true);
      sql += ` AND is_promo = $${params.length}`;
    }
    if (category) {
      params.push(category);
      sql += ` AND category = $${params.length}`;
    }

    sql += ' ORDER BY is_promo DESC, created_at DESC';

    const { rows } = await db.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ── GET /api/products/:id ─────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT * FROM products WHERE id = $1 AND is_active = TRUE',
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Produit introuvable' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ── POST /api/products ────────────────────────────────────────────────────────
// Créer un produit — admin uniquement
router.post('/', authenticate, requireRole(['admin']), async (req, res) => {
  try {
    const {
      name, description, category, emoji,
      price_kmf, promo_pct, promo_until,
      stock, weight_kg, is_promo, image_url, sku
    } = req.body;

    if (!name || !price_kmf) {
      return res.status(400).json({ error: 'name et price_kmf sont requis' });
    }

    const { rows } = await db.query(
      `INSERT INTO products
        (sku, name, description, category, emoji, price_kmf, promo_pct,
         promo_until, stock, weight_kg, is_promo, image_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING *`,
      [sku, name, description, category, emoji, price_kmf, promo_pct,
       promo_until, stock || 0, weight_kg, is_promo || false, image_url]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ── PUT /api/products/:id ─────────────────────────────────────────────────────
// Modifier un produit (stock, prix, promo) — admin uniquement
router.put('/:id', authenticate, requireRole(['admin']), async (req, res) => {
  try {
    const fields  = req.body;
    const allowed = ['name','description','category','emoji','price_kmf',
                     'promo_pct','promo_until','stock','weight_kg',
                     'is_promo','is_active','image_url'];

    const updates = [];
    const values  = [];
    let   idx     = 1;

    for (const key of allowed) {
      if (fields[key] !== undefined) {
        updates.push(`${key} = $${idx++}`);
        values.push(fields[key]);
      }
    }
    if (!updates.length) return res.status(400).json({ error: 'Aucun champ à mettre à jour' });

    values.push(req.params.id);
    const { rows } = await db.query(
      `UPDATE products SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );
    if (!rows.length) return res.status(404).json({ error: 'Produit introuvable' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
