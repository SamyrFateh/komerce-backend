/**
 * KOMERCE — Catalogue produits
 *
 * GET /api/products            → liste paginée + filtres
 * GET /api/products/:id        → détail produit
 * POST /api/products           → créer un produit (admin)
 * PUT  /api/products/:id       → modifier un produit (admin)
 * DELETE /api/products/:id     → désactiver (admin)
 */

const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');

// ─── GET /api/products ───────────────────────────────────────────────────────

router.get('/', async (req, res) => {
  try {
    const {
      category,
      search,
      min_price,
      max_price,
      in_stock,
      limit  = 50,
      offset = 0,
    } = req.query;

    const conditions = ['p.is_active = TRUE'];
    const params     = [];
    let   pi         = 1;

    if (category) {
      conditions.push(`p.category = $${pi++}`);
      params.push(category);
    }
    if (search) {
      conditions.push(`(p.name ILIKE $${pi} OR p.description ILIKE $${pi})`);
      params.push(`%${search}%`);
      pi++;
    }
    if (min_price) {
      conditions.push(`p.price_kmf >= $${pi++}`);
      params.push(Number(min_price));
    }
    if (max_price) {
      conditions.push(`p.price_kmf <= $${pi++}`);
      params.push(Number(max_price));
    }
    if (in_stock === 'true') {
      conditions.push('(p.stock IS NULL OR p.stock > 0)');
    }

    const where = conditions.join(' AND ');

    const { rows } = await db.query(
      `SELECT
         p.id,
         p.name,
         p.description,
         p.category,
         p.price_aed,
         p.price_kmf,
         p.price_eur,
         p.weight_kg,
         p.dimensions_cm,
         p.stock,
         p.image_url,
         p.images,
         p.badge,
         p.emoji,
         p.promo_pct,
         p.is_available,
         p.customs_risk_coeff,
         p.has_couture,
         p.sourcing_source,
         p.created_at
       FROM products p
       WHERE ${where}
       ORDER BY p.sort_order ASC, p.created_at DESC
       LIMIT $${pi} OFFSET $${pi + 1}`,
      [...params, Number(limit), Number(offset)]
    );

    const { rows: [{ count }] } = await db.query(
      `SELECT COUNT(*) FROM products p WHERE ${where}`,
      params
    );

    res.json({
      products: rows,
      total: Number(count),
      limit: Number(limit),
      offset: Number(offset),
    });

  } catch (err) {
    console.error('Products list error:', err.message);
    res.status(500).json({ error: 'Erreur chargement catalogue' });
  }
});

// ─── GET /api/products/categories ───────────────────────────────────────────

router.get('/categories', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT category, COUNT(*) AS count
       FROM products
       WHERE is_active = TRUE
       GROUP BY category
       ORDER BY category`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Erreur catégories' });
  }
});

// ─── GET /api/products/:id ───────────────────────────────────────────────────

router.get('/:id', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT * FROM products WHERE id = $1 AND is_active = TRUE`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Produit introuvable' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ─── POST /api/products (admin) ──────────────────────────────────────────────

router.post('/', authenticate, requireRole(['admin']), async (req, res) => {
  try {
    const {
      name,
      description,
      category,
      price_aed,
      price_kmf,
      price_eur,
      weight_kg,
      dimensions_cm,
      stock,
      image_url,
      images,
      badge,
      has_couture       = false,
      customs_risk_coeff = 1.0,
      sourcing_source,
      sort_order        = 0,
    } = req.body;

    if (!name || !category || !price_kmf) {
      return res.status(400).json({ error: 'name, category et price_kmf sont obligatoires' });
    }

    const { rows: [product] } = await db.query(
      `INSERT INTO products
         (name, description, category, price_aed, price_kmf, price_eur,
          weight_kg, dimensions_cm, stock, image_url, images, badge,
          has_couture, customs_risk_coeff, sourcing_source, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       RETURNING *`,
      [name, description, category, price_aed, price_kmf, price_eur,
       weight_kg, dimensions_cm, stock, image_url, images ? JSON.stringify(images) : null,
       badge, has_couture, customs_risk_coeff, sourcing_source, sort_order]
    );

    res.status(201).json(product);
  } catch (err) {
    console.error('Create product error:', err.message);
    res.status(500).json({ error: 'Erreur création produit' });
  }
});

// ─── PUT /api/products/:id (admin) ───────────────────────────────────────────

router.put('/:id', authenticate, requireRole(['admin']), async (req, res) => {
  try {
    const fields = [
      'name', 'description', 'category', 'price_aed', 'price_kmf', 'price_eur',
      'weight_kg', 'dimensions_cm', 'stock', 'image_url', 'images', 'badge',
      'has_couture', 'customs_risk_coeff', 'sourcing_source', 'sort_order',
      'is_active', 'is_available',
    ];

    const updates = [];
    const values  = [];
    let   pi      = 1;

    for (const field of fields) {
      if (req.body[field] !== undefined) {
        updates.push(`${field} = $${pi++}`);
        values.push(req.body[field]);
      }
    }

    if (!updates.length) {
      return res.status(400).json({ error: 'Aucun champ à mettre à jour' });
    }

    values.push(req.params.id);
    const { rows: [product] } = await db.query(
      `UPDATE products SET ${updates.join(', ')}, updated_at = NOW()
       WHERE id = $${pi} RETURNING *`,
      values
    );

    if (!product) return res.status(404).json({ error: 'Produit introuvable' });
    res.json(product);
  } catch (err) {
    console.error('Update product error:', err.message);
    res.status(500).json({ error: 'Erreur mise à jour produit' });
  }
});

// ─── DELETE /api/products/:id (admin) ────────────────────────────────────────

router.delete('/:id', authenticate, requireRole(['admin']), async (req, res) => {
  try {
    await db.query(
      `UPDATE products SET is_active = FALSE, updated_at = NOW() WHERE id = $1`,
      [req.params.id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Erreur suppression produit' });
  }
});

module.exports = router;
