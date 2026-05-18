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
const { validate } = require('../middleware/validate');
const { products } = require('../validators');
const { recordProductPriceChange } = require('../services/product-price-audit');
const { auditProductStockChange, validatePublicationUpdate } = require('../services/product-publication-guard');

// ─── UUID validation helper ──────────────────────────────────────────────────
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireUUID(req, res, next) {
  if (!UUID_RE.test(req.params.id)) {
    return res.status(400).json({ error: 'ID produit invalide' });
  }
  next();
}

// ─── GET /api/products ───────────────────────────────────────────────────────

router.get('/', async (req, res, next) => {
  try {
    const {
      category,
      subcategory,
      search,
      min_price,
      max_price,
      in_stock,
      limit  = 1000,
      offset = 0,
    } = req.query;

    const conditions = ['p.is_active = TRUE'];
    const params     = [];
    let   pi         = 1;

    if (category) {
      conditions.push(`p.category = $${pi++}`);
      params.push(category);
    }
    if (subcategory) {
      conditions.push(`p.subcategory = $${pi++}`);
      params.push(subcategory);
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
         p.sku,
         p.name,
         p.description,
         p.category,
         p.subcategory,
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
         p.has_variants,
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
    next(err);
  }
});

// ─── GET /api/products/categories ───────────────────────────────────────────

router.get('/categories', async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT category, COUNT(*) AS count,
              array_agg(DISTINCT subcategory) FILTER (WHERE subcategory IS NOT NULL) AS subcategories
       FROM products
       WHERE is_active = TRUE
       GROUP BY category
       ORDER BY category`
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});


// ─── GET /api/products/subcategories ────────────────────────────────────────

router.get('/subcategories', async (req, res, next) => {
  try {
    const { category } = req.query;
    const conditions = ['is_active = TRUE', 'subcategory IS NOT NULL'];
    const params = [];
    let pi = 1;

    if (category) {
      conditions.push(`category = $${pi++}`);
      params.push(category);
    }

    const { rows } = await db.query(
      `SELECT category, subcategory, COUNT(*) AS count
       FROM products
       WHERE ${conditions.join(' AND ')}
       GROUP BY category, subcategory
       ORDER BY category, subcategory`,
      params
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/products/:id ───────────────────────────────────────────────────
// P0-003 fix: UUID validation + next(err)
// VAGUE 3: charge product_variants si product.has_variants = true

router.get('/:id', requireUUID, async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT * FROM products WHERE id = $1 AND is_active = TRUE`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Produit introuvable' });

    const product = rows[0];

    if (product.has_variants) {
      const { rows: vRows } = await db.query(
        `SELECT variant_type, variant_value, stock, price_kmf, image_url, sku, display_order
           FROM product_variants
          WHERE product_id = $1
          ORDER BY variant_type, display_order ASC, variant_value ASC`,
        [product.id]
      );
      const variants = {};
      for (const v of vRows) {
        if (!variants[v.variant_type]) variants[v.variant_type] = [];
        variants[v.variant_type].push({
          value:     v.variant_value,
          stock:     v.stock,
          price_kmf: v.price_kmf,
          image_url: v.image_url,
          sku:       v.sku,
        });
      }
      product.variants = variants;
    }

    res.json(product);
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/products (admin) ──────────────────────────────────────────────

router.post('/', authenticate, requireRole(['admin']), validate(products.create), async (req, res, next) => {
  try {
    const {
      name,
      description,
      category,
      subcategory,
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

    const numericFields = { price_aed, price_kmf, price_eur, weight_kg, stock, customs_risk_coeff, sort_order, unsold_price_kmf };
    for (const [fname, val] of Object.entries(numericFields)) {
      if (val !== undefined && val !== null) {
        const num = Number(val);
        if (isNaN(num) || num < 0) {
          return res.status(400).json({ error: `${fname} doit être un nombre positif` });
        }
      }
    }

    const publicationCheck = validatePublicationUpdate({
      before: { is_active: true, is_available: req.body.is_available !== undefined ? req.body.is_available : true },
      patch: req.body,
    });
    if (!publicationCheck.ok) {
      return res.status(400).json(publicationCheck);
    }

    const { rows: [product] } = await db.query(
      `INSERT INTO products
         (name, description, category, subcategory, price_aed, price_kmf, price_eur,
          weight_kg, dimensions_cm, stock, image_url, images, badge,
          has_couture, customs_risk_coeff, sourcing_source, sort_order,
          requires_secure_transport, unsold_price_kmf, unsold_channel)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
       RETURNING *`,
      [name, description, category, subcategory || null, price_aed, price_kmf, price_eur,
       weight_kg, dimensions_cm, stock, image_url, images ? JSON.stringify(images) : null,
       badge, has_couture, customs_risk_coeff, sourcing_source, sort_order,
       requires_secure_transport, unsold_price_kmf || null, unsold_channel]
    );

    await recordProductPriceChange(db, {
      productId: product.id,
      oldPriceKmf: 0,
      newPriceKmf: product.price_kmf,
      source: 'product_create',
      appliedBy: req.user?.id || null,
      note: 'Création produit catalogue',
    });

    if (product.stock !== undefined) {
      await auditProductStockChange(db, {
        productId: product.id,
        oldStock: null,
        newStock: product.stock,
        actor: req.user?.id || null,
        source: 'product_create',
        note: 'Création produit catalogue',
      });
    }

    res.status(201).json(product);
  } catch (err) {
    next(err);
  }
});

// ─── PUT /api/products/:id (admin) ───────────────────────────────────────────

router.put('/:id', authenticate, requireRole(['admin']), requireUUID, validate(products.update), async (req, res, next) => {
  try {
    const fields = [
      'name', 'description', 'category', 'subcategory', 'price_aed', 'price_kmf', 'price_eur',
      'weight_kg', 'dimensions_cm', 'stock', 'image_url', 'images', 'badge',
      'has_couture', 'customs_risk_coeff', 'sourcing_source', 'sort_order',
      'is_active', 'is_available',
      'requires_secure_transport', 'unsold_price_kmf', 'unsold_channel',
    ];

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

    const { rows: [before] } = await db.query(
      'SELECT id, name, category, price_kmf, stock, is_active, is_available FROM products WHERE id = $1',
      [req.params.id]
    );
    if (!before) return res.status(404).json({ error: 'Produit introuvable' });

    const publicationCheck = validatePublicationUpdate({ before, patch: req.body });
    if (!publicationCheck.ok) {
      return res.status(400).json(publicationCheck);
    }

    values.push(req.params.id);
    const { rows: [product] } = await db.query(
      `UPDATE products SET ${updates.join(', ')}, updated_at = NOW()
       WHERE id = $${pi} RETURNING *`,
      values
    );

    if (!product) return res.status(404).json({ error: 'Produit introuvable' });

    if (req.body.price_kmf !== undefined) {
      await recordProductPriceChange(db, {
        productId: product.id,
        oldPriceKmf: before.price_kmf,
        newPriceKmf: product.price_kmf,
        source: 'product_update',
        appliedBy: req.user?.id || null,
        note: 'Modification directe catalogue',
      });
    }

    if (req.body.stock !== undefined) {
      await auditProductStockChange(db, {
        productId: product.id,
        oldStock: before.stock,
        newStock: product.stock,
        actor: req.user?.id || null,
        source: 'product_update',
        note: 'Modification directe catalogue',
      });
    }

    res.json(product);
  } catch (err) {
    next(err);
  }
});

// ─── DELETE /api/products/:id (admin) ────────────────────────────────────────

router.delete('/:id', authenticate, requireRole(['admin']), requireUUID, validate(products.delete), async (req, res, next) => {
  try {
    await db.query(
      `UPDATE products SET is_active = FALSE, updated_at = NOW() WHERE id = $1`,
      [req.params.id]
    );
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/products/:id/image (admin) — D1/BUG-016 ──────────────────────
// Upload une image produit (multipart/form-data, champ "image")

router.post('/:id/image', authenticate, requireRole(['admin']), requireUUID, upload.single('image'), async (req, res, next) => {
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
      const fs = require('fs');
      try { fs.unlinkSync(req.file.path); } catch (_) {}
      return res.status(404).json({ error: 'Produit introuvable' });
    }

    console.log(`📷 Image uploadée pour "${product.name}" → ${imageUrl}`);
    res.json({ success: true, image_url: imageUrl, product });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/products/:id/images (admin) — Upload multiple ─────────────────

router.post('/:id/images', authenticate, requireRole(['admin']), requireUUID, upload.array('images', 5), async (req, res, next) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'Aucune image envoyée. Champ attendu : "images" (max 5)' });
    }

    const imageUrls = req.files.map(f => `/uploads/products/${f.filename}`);

    const { rows: [product] } = await db.query(
      'SELECT id, name, images FROM products WHERE id = $1 AND is_active = TRUE',
      [req.params.id]
    );

    if (!product) {
      const fs = require('fs');
      req.files.forEach(f => { try { fs.unlinkSync(f.path); } catch (_) {} });
      return res.status(404).json({ error: 'Produit introuvable' });
    }

    const existing = product.images ? (typeof product.images === 'string' ? JSON.parse(product.images) : product.images) : [];
    const merged = [...existing, ...imageUrls];

    if (existing.length === 0) {
      await db.query(
        `UPDATE products SET images = $1, image_url = $2, updated_at = NOW() WHERE id = $3`,
        [JSON.stringify(merged), imageUrls[0], req.params.id]
      );
    } else {
      await db.query(
        `UPDATE products SET images = $1, updated_at = NOW() WHERE id = $2`,
        [JSON.stringify(merged), req.params.id]
      );
    }

    console.log(`📷 ${imageUrls.length} images uploadées pour "${product.name}"`);
    res.json({ success: true, images: merged, new_images: imageUrls });
  } catch (err) {
    next(err);
  }
});

// ─── VAGUE 3 — Admin variantes ───────────────────────────────────────────────

router.get('/:id/variants', authenticate, requireRole(['admin']), requireUUID, async (req, res, next) => {
  try {
    const { rows: [product] } = await db.query(
      'SELECT id, name, has_variants FROM products WHERE id = $1',
      [req.params.id]
    );
    if (!product) return res.status(404).json({ error: 'Produit introuvable' });

    const { rows: variants } = await db.query(
      `SELECT id, variant_type, variant_value, sku, stock, price_kmf,
              image_url, display_order, created_at, updated_at
         FROM product_variants
        WHERE product_id = $1
        ORDER BY variant_type, display_order ASC, variant_value ASC`,
      [req.params.id]
    );

    res.json({
      product_id:   product.id,
      product_name: product.name,
      has_variants: product.has_variants,
      variants,
      count: variants.length,
    });
  } catch (err) { next(err); }
});

router.put('/:id/variants', authenticate, requireRole(['admin']), requireUUID, async (req, res, next) => {
  const client = await db.getClient();
  try {
    const { variants } = req.body;

    if (!Array.isArray(variants)) {
      return res.status(400).json({ error: 'variants doit être un tableau' });
    }
    if (variants.length > 200) {
      return res.status(400).json({ error: 'Maximum 200 variantes par produit' });
    }

    for (const v of variants) {
      if (!v.type || typeof v.type !== 'string' || v.type.trim().length === 0) {
        return res.status(400).json({ error: 'Chaque variante doit avoir un "type" (ex: "Taille")' });
      }
      if (!v.value || typeof v.value !== 'string' || v.value.trim().length === 0) {
        return res.status(400).json({ error: 'Chaque variante doit avoir une "value" (ex: "M")' });
      }
      if (v.stock !== undefined && v.stock !== null && (typeof v.stock !== 'number' || v.stock < 0)) {
        return res.status(400).json({ error: `stock invalide pour ${v.type}:${v.value} — entier >= 0 ou null` });
      }
      if (v.price_kmf !== undefined && v.price_kmf !== null && (typeof v.price_kmf !== 'number' || v.price_kmf < 0)) {
        return res.status(400).json({ error: `price_kmf invalide pour ${v.type}:${v.value} — entier >= 0 ou null` });
      }
    }

    await client.query('BEGIN');

    const { rows: [product] } = await client.query(
      'SELECT id, name FROM products WHERE id = $1 FOR UPDATE',
      [req.params.id]
    );
    if (!product) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Produit introuvable' });
    }

    if (variants.length === 0) {
      const { rows: [pending] } = await client.query(
        `SELECT COUNT(*)::int AS cnt
           FROM order_items oi
           JOIN orders o ON o.id = oi.order_id
          WHERE oi.product_id = $1
            AND oi.variant_combo IS NOT NULL
            AND o.status NOT IN ('collected', 'cancelled', 'refunded')`,
        [req.params.id]
      );
      if (pending.cnt > 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: `Impossible de supprimer les variantes : ${pending.cnt} commande(s) en cours y font référence`,
          hint: 'Attendez que les commandes en cours soient finalisées ou annulées',
        });
      }
    }

    await client.query('DELETE FROM product_variants WHERE product_id = $1', [req.params.id]);

    const inserted = [];
    for (let i = 0; i < variants.length; i++) {
      const v = variants[i];
      const { rows: [row] } = await client.query(
        `INSERT INTO product_variants
           (product_id, variant_type, variant_value, sku, stock, price_kmf, image_url, display_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [
          req.params.id,
          v.type.trim(),
          v.value.trim(),
          v.sku    || null,
          v.stock  !== undefined ? v.stock : 0,
          v.price_kmf || null,
          v.image_url || null,
          v.display_order !== undefined ? v.display_order : i,
        ]
      );
      inserted.push(row);
    }

    await client.query('COMMIT');

    const { rows: [updated] } = await db.query(
      'SELECT id, name, has_variants FROM products WHERE id = $1',
      [req.params.id]
    );

    res.json({
      message:      `${inserted.length} variante(s) enregistrée(s) pour "${product.name}"`,
      product_id:   req.params.id,
      has_variants: updated.has_variants,
      count:        inserted.length,
      variants:     inserted,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code === '23505') {
      return res.status(409).json({
        error: 'Doublon détecté — deux variantes ont le même type et la même valeur',
        detail: err.detail,
      });
    }
    next(err);
  } finally {
    client.release();
  }
});

router.delete('/:id/variants/:variantId', authenticate, requireRole(['admin']), requireUUID, async (req, res, next) => {
  try {
    const { variantId } = req.params;

    const { rows: [pending] } = await db.query(
      `SELECT COUNT(*)::int AS cnt
         FROM order_items oi
         JOIN orders o ON o.id = oi.order_id
         JOIN product_variants pv ON pv.product_id = oi.product_id
        WHERE pv.id = $1
          AND oi.variant_combo IS NOT NULL
          AND oi.variant_combo ->> pv.variant_type = pv.variant_value
          AND o.status NOT IN ('collected', 'cancelled', 'refunded')`,
      [variantId]
    );

    if (pending.cnt > 0) {
      return res.status(409).json({
        error: `Impossible de supprimer : ${pending.cnt} commande(s) en cours référence cette variante`,
        hint: 'Attendez que les commandes soient finalisées ou annulées',
      });
    }

    const { rows } = await db.query(
      'DELETE FROM product_variants WHERE id = $1 AND product_id = $2 RETURNING *',
      [variantId, req.params.id]
    );

    if (!rows.length) return res.status(404).json({ error: 'Variante introuvable' });

    res.json({
      message: `Variante "${rows[0].variant_type}: ${rows[0].variant_value}" supprimée`,
      deleted: rows[0],
    });
  } catch (err) { next(err); }
});

module.exports = router;
