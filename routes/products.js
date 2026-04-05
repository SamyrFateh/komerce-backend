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
const upload = require('../middleware/upload');

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
         p.requires_secure_transport,
         p.unsold_price_kmf,
         p.unsold_channel,
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

router.post('/', authenticate, requireRole(['admin']), validate(products.create), async (req, res) => {
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
      has_couture                = false,
      customs_risk_coeff          = 1.0,
      sourcing_source,
      sort_order                  = 0,
      requires_secure_transport   = false,
      unsold_price_kmf,
      unsold_channel              = 'both',
    } = req.body;

    if (!name || !category || !price_kmf) {
      return res.status(400).json({ error: 'name, category et price_kmf sont obligatoires' });
    }

    // Validate numeric fields
    const numericFields = { price_aed, price_kmf, price_eur, weight_kg, stock, customs_risk_coeff, sort_order, unsold_price_kmf };
    for (const [fname, val] of Object.entries(numericFields)) {
      if (val !== undefined && val !== null) {
        const num = Number(val);
        if (isNaN(num) || num < 0) {
          return res.status(400).json({ error: `${fname} doit être un nombre positif` });
        }
      }
    }

    const { rows: [product] } = await db.query(
      `INSERT INTO products
         (name, description, category, price_aed, price_kmf, price_eur,
          weight_kg, dimensions_cm, stock, image_url, images, badge,
          has_couture, customs_risk_coeff, sourcing_source, sort_order,
          requires_secure_transport, unsold_price_kmf, unsold_channel)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
       RETURNING *`,
      [name, description, category, price_aed, price_kmf, price_eur,
       weight_kg, dimensions_cm, stock, image_url, images ? JSON.stringify(images) : null,
       badge, has_couture, customs_risk_coeff, sourcing_source, sort_order,
       requires_secure_transport, unsold_price_kmf || null, unsold_channel]
    );

    res.status(201).json(product);
  } catch (err) {
    console.error('Create product error:', err.message);
    res.status(500).json({ error: 'Erreur création produit' });
  }
});

// ─── PUT /api/products/:id (admin) ───────────────────────────────────────────

router.put('/:id', authenticate, requireRole(['admin']), validate(products.update), async (req, res) => {
  try {
    const fields = [
      'name', 'description', 'category', 'price_aed', 'price_kmf', 'price_eur',
      'weight_kg', 'dimensions_cm', 'stock', 'image_url', 'images', 'badge',
      'has_couture', 'customs_risk_coeff', 'sourcing_source', 'sort_order',
      'is_active', 'is_available',
      'requires_secure_transport', 'unsold_price_kmf', 'unsold_channel',
    ];

    // Validate numeric fields if present
    const numericFieldNames = ['price_aed', 'price_kmf', 'price_eur', 'weight_kg', 'stock', 'customs_risk_coeff', 'sort_order', 'unsold_price_kmf'];
    for (const fname of numericFieldNames) {
      const val = req.body[fname];
      if (val !== undefined && val !== null) {
        const num = Number(val);
        if (isNaN(num) || num < 0) {
          return res.status(400).json({ error: `${fname} doit être un nombre positif` });
        }
      }
    }

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

router.delete('/:id', authenticate, requireRole(['admin']), validate(products.delete), async (req, res) => {
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

// ─── POST /api/products/:id/image (admin) — D1/BUG-016 ──────────────────────
// Upload une image produit (multipart/form-data, champ "image")
// Stocke dans public/uploads/products/ et met à jour image_url en DB

router.post('/:id/image', authenticate, requireRole(['admin']), upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Aucune image envoyée. Champ attendu : "image" (multipart/form-data)' });
    }

    const imageUrl = `/uploads/products/${req.file.filename}`;

    const { rows: [product] } = await db.query(
      `UPDATE products SET image_url = $1, updated_at = NOW()
       WHERE id = $2 AND is_active = TRUE RETURNING id, name, image_url`,
      [imageUrl, req.params.id]
    );

    if (!product) {
      // Nettoyer le fichier uploadé si produit introuvable
      const fs = require('fs');
      try { fs.unlinkSync(req.file.path); } catch (_) {}
      return res.status(404).json({ error: 'Produit introuvable' });
    }

    console.log(`📷 Image uploadée pour "${product.name}" → ${imageUrl}`);
    res.json({ success: true, image_url: imageUrl, product });
  } catch (err) {
    console.error('Upload image error:', err.message);
    res.status(500).json({ error: 'Erreur upload image' });
  }
});

// ─── POST /api/products/:id/images (admin) — Upload multiple ─────────────────
// Upload jusqu'à 5 images supplémentaires pour un produit

router.post('/:id/images', authenticate, requireRole(['admin']), upload.array('images', 5), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'Aucune image envoyée. Champ attendu : "images" (max 5)' });
    }

    const imageUrls = req.files.map(f => `/uploads/products/${f.filename}`);

    // Récupérer les images existantes
    const { rows: [product] } = await db.query(
      'SELECT id, name, images FROM products WHERE id = $1 AND is_active = TRUE',
      [req.params.id]
    );

    if (!product) {
      const fs = require('fs');
const { validate } = require('../middleware/validate');
const { products } = require('../validators');
      req.files.forEach(f => { try { fs.unlinkSync(f.path); } catch (_) {} });
      return res.status(404).json({ error: 'Produit introuvable' });
    }

    const existing = product.images ? (typeof product.images === 'string' ? JSON.parse(product.images) : product.images) : [];
    const merged = [...existing, ...imageUrls];

    // Si pas d'image principale, utiliser la première uploadée
    const setMain = existing.length === 0 ? `, image_url = '${imageUrls[0]}'` : '';

    await db.query(
      `UPDATE products SET images = $1${setMain}, updated_at = NOW() WHERE id = $2`,
      [JSON.stringify(merged), req.params.id]
    );

    console.log(`📷 ${imageUrls.length} images uploadées pour "${product.name}"`);
    res.json({ success: true, images: merged, new_images: imageUrls });
  } catch (err) {
    console.error('Upload images error:', err.message);
    res.status(500).json({ error: 'Erreur upload images' });
  }
});

module.exports = router;
