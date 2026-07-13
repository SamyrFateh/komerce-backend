/**
 * @komerce-arch
 * @role          products-http-facade
 * @domain        catalog
 * @layer         route
 * @criticality   high
 * @inputs        product_filters, product_id, admin_product_payload
 * @outputs       product_list, product_detail, product_mutation_result
 * @depends       db.js, validators.js, middleware/auth.js
 * @used-by       bootstrap/api-routes.js, public/boutique/js/b-catalog.js, public/boutique/js/b-modal-core.js, komerce-api.js
 * @db-read       product_skus, product_variants, products
 * @db-write      none
 * @db-txn        product_reference_stable, deactivate_not_delete
 * @doctrine      catalogue_source_db, produit_reference_stable, produit_desactive_non_supprime
 * @impact-areas  catalog, product-discovery, modal, admin-products, suggestions
 * @version       2026-06
 */


'use strict';
/**
 * KOMERCE — Catalogue produits
 *
 * GET /api/products            — liste paginée + filtres
 * GET /api/products/:id        — détail produit
 * POST /api/products           — créer un produit (admin)
 * PUT  /api/products/:id       — modifier un produit (admin)
 * DELETE /api/products/:id     — désactiver (admin)
 *
 * R8B : create/update/delete/image/images/variants délégués à
 * services/product-admin-service.js — routes = auth + validation + appel
 * service + réponse.
 */

const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const upload = require('../middleware/upload');
const { validate } = require('../middleware/validate');
const { products } = require('../validators');
const productAdminService = require('../services/product-admin-service');
const { publicProductColumns, toPublicProduct } = require('../services/catalog-public-view');
const log = require('../utils/logger').child({ module: 'products' });

// ─── UUID validation helper ───────────────────────────────────────────────────
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireUUID(req, res, next) {
  if (!UUID_RE.test(req.params.id)) {
    return res.status(400).json({ error: 'ID produit invalide' });
  }
  next();
}

// ─── GET /api/products ───────────────────────────────────────

router.get('/', async (req, res, next) => {
  try {
    const {
      category,
      subcategory,
      search,
      min_price,
      max_price,
      in_stock,
      limit  = 100,
      offset = 0,
    } = req.query;

    const MAX_LIMIT = 1000;
    const safeLimit = Math.min(Math.max(1, parseInt(limit, 10) || 100), MAX_LIMIT);

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
         ${publicProductColumns('p')}
       FROM products p
       WHERE ${where}
       ORDER BY p.sort_order ASC, p.created_at DESC
       LIMIT $${pi} OFFSET $${pi + 1}`,
      [...params, safeLimit, Number(offset)]
    );

    const { rows: [{ count }] } = await db.query(
      `SELECT COUNT(*) FROM products p WHERE ${where}`,
      params
    );

    res.json({
      products: rows,
      total: Number(count),
      limit: safeLimit,
      offset: Number(offset),
    });

  } catch (err) {
    next(err);
  }
});

// ─── GET /api/products/categories ────────────────────────────

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


// ─── GET /api/products/subcategories ─────────────────────────

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

// ─── Product Detail Contract v1 ───────────────────────────────────
router.use(require('./catalog-product-detail'));

// ─── GET /api/products/:id ───────────────────────────────────
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
        `SELECT variant_type, variant_value, stock, price_kmf, image_url, images, sku, display_order
           FROM product_variants
          WHERE product_id = $1
          ORDER BY variant_type, display_order ASC, variant_value ASC`,
        [product.id]
      );
      const variants = {};
      for (const v of vRows) {
        if (!variants[v.variant_type]) variants[v.variant_type] = [];
        // Normalisation images : images[] prioritaire, fallback image_url
        let imgs = Array.isArray(v.images) && v.images.length > 0
          ? v.images
          : (v.image_url ? [v.image_url] : []);
        variants[v.variant_type].push({
          value:     v.variant_value,
          stock:     v.stock,
          price_kmf: v.price_kmf,
          image_url: v.image_url,
          images:    imgs,
          sku:       v.sku,
        });
      }
      product.variants = variants;
    }

    // Doctrine catalogue : la boutique ne lit que les champs publiés — les
    // champs de cuisine (name_source, content_source, enrichment_version...)
    // ne quittent jamais ce endpoint, même si la ligne DB les porte.
    res.json(toPublicProduct(product));
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/products (admin) ──────────────────────────────


// ─── POST /api/products (admin) ──────────────────────────────

router.post('/', authenticate, requireRole(['admin']), validate(products.create), async (req, res, next) => {
  try {
    const result = await productAdminService.createProduct(db, req.body, req.user);
    return res.status(result.status).json(result.body);
  } catch (err) {
    next(err);
  }
});

// ─── PUT /api/products/:id (admin) ───────────────────────────

router.put('/:id', authenticate, requireRole(['admin']), requireUUID, validate(products.update), async (req, res, next) => {
  try {
    const result = await productAdminService.updateProduct(db, req.params.id, req.body, req.user);
    return res.status(result.status).json(result.body);
  } catch (err) {
    next(err);
  }
});

// ─── DELETE /api/products/:id (admin) ────────────────────────

router.delete('/:id', authenticate, requireRole(['admin']), requireUUID, validate(products.delete), async (req, res, next) => {
  try {
    const result = await productAdminService.deleteProduct(db, req.params.id);
    return res.status(result.status).json(result.body);
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/products/:id/image (admin) ────────────────────
// Upload une image produit (multipart/form-data, champ "image")

router.post('/:id/image', authenticate, requireRole(['admin']), requireUUID, upload.single('image'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Aucune image envoyée. Champ attendu : "image" (multipart/form-data)' });
    }

    const imageUrl = `/uploads/products/${req.file.filename}`;
    const result = await productAdminService.setMainImage(db, req.params.id, imageUrl);

    if (result.status === 404) {
      const fs = require('fs');
      try { fs.unlinkSync(req.file.path); } catch (_) {}
      return res.status(404).json(result.body);
    }

    log.info(`Image uploadée pour "${result.body.product.name}" — ${imageUrl}`);
    return res.json(result.body);
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/products/:id/images (admin) ───────────────────

router.post('/:id/images', authenticate, requireRole(['admin']), requireUUID, upload.array('images', 5), async (req, res, next) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'Aucune image envoyée. Champ attendu : "images" (max 5)' });
    }

    const imageUrls = req.files.map(f => `/uploads/products/${f.filename}`);
    const result = await productAdminService.appendImages(db, req.params.id, imageUrls);

    if (result.status === 404) {
      const fs = require('fs');
      req.files.forEach(f => { try { fs.unlinkSync(f.path); } catch (_) {} });
      return res.status(404).json(result.body);
    }

    const { product_name, ...body } = result.body;
    log.info(`${imageUrls.length} images uploadées pour "${product_name}"`);
    return res.json(body);
  } catch (err) {
    next(err);
  }
});

// ─── VAGUE 3 — Admin variantes ────────────────────────────────

router.get('/:id/variants', authenticate, requireRole(['admin']), requireUUID, async (req, res, next) => {
  try {
    const { rows: [product] } = await db.query(
      'SELECT id, name, has_variants FROM products WHERE id = $1',
      [req.params.id]
    );
    if (!product) return res.status(404).json({ error: 'Produit introuvable' });

    const { rows: variants } = await db.query(
      `SELECT id, variant_type, variant_value, sku, stock, price_kmf,
              image_url, images, display_order, created_at, updated_at
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
  try {
    const result = await productAdminService.replaceVariants(db, req.params.id, req.body.variants);
    res.json(result);
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ error: err.message });
    if (err.status === 404) return res.status(404).json({ error: err.message });
    if (err.status === 409) return res.status(409).json({ error: err.message, hint: err.hint });
    if (err.code === '23505') return res.status(409).json({ error: 'Doublon détecté — deux variantes ont le même type et la même valeur', detail: err.detail });
    next(err);
  }
});

router.delete('/:id/variants/:variantId', authenticate, requireRole(['admin']), requireUUID, async (req, res, next) => {
  try {
    const result = await productAdminService.deleteVariant(db, req.params.id, req.params.variantId);
    return res.status(result.status).json(result.body);
  } catch (err) { next(err); }
});

// ─── SKU (Lot 1 — préparation/déclaration, cf. DECISION_MODELE_STOCK_SKU.md) ──
// Ne pilote jamais products.stock ni product_variants.stock. Ne suppose
// jamais inventory_model — la bascule est un acte séparé (Lot 5).

router.get('/:id/skus', authenticate, requireRole(['admin']), requireUUID, async (req, res, next) => {
  try {
    if (req.query.candidates === '1') {
      const result = await productAdminService.getSkuCandidates(db, req.params.id);
      return res.json(result);
    }
    const { rows: [product] } = await db.query(
      'SELECT id, name, has_variants, inventory_model FROM products WHERE id = $1',
      [req.params.id]
    );
    if (!product) return res.status(404).json({ error: 'Produit introuvable' });

    const { rows: skus } = await db.query(
      `SELECT id, sku, variant_combo, stock, price_kmf, is_active, created_at, updated_at
         FROM product_skus WHERE product_id = $1
         ORDER BY variant_combo NULLS FIRST, created_at`,
      [req.params.id]
    );
    res.json({
      product_id: product.id, product_name: product.name,
      inventory_model: product.inventory_model, skus, count: skus.length,
    });
  } catch (err) { next(err); }
});

router.get('/:id/skus/readiness', authenticate, requireRole(['admin']), requireUUID, async (req, res, next) => {
  try {
    const result = await productAdminService.auditProductSkuReadiness(db, req.params.id);
    res.json(result);
  } catch (err) {
    if (err.status === 404) return res.status(404).json({ error: err.message });
    next(err);
  }
});

router.post('/:id/skus', authenticate, requireRole(['admin']), requireUUID, async (req, res, next) => {
  try {
    const result = await productAdminService.upsertProductSku(db, req.params.id, req.body);
    res.status(201).json(result);
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ error: err.message });
    if (err.status === 404) return res.status(404).json({ error: err.message });
    if (err.status === 409) return res.status(409).json({ error: err.message });
    next(err);
  }
});

router.delete('/:id/skus/:skuId', authenticate, requireRole(['admin']), requireUUID, async (req, res, next) => {
  try {
    const result = await productAdminService.deactivateProductSku(db, req.params.id, req.params.skuId);
    return res.status(result.status).json(result.body);
  } catch (err) { next(err); }
});

module.exports = router;
