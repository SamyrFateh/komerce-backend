/**
 * @komerce-arch
 * @role          catalog-product-detail-http
 * @domain        catalog
 * @layer         route
 * @criticality   high
 * @inputs        product_id, optional_market_code
 * @outputs       public_product_detail_v1
 * @depends       db.js, services/catalog-product-detail.js, services/catalog-public-view.js, services/market-local-price-resolution-service.js
 * @used-by       routes/products.js, public/boutique/js/b-modal-product-detail-bootstrap.js
 * @db-read       product_skus, product_variants, products
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_PRODUCT_DETAIL_CONTRACT.md, only_LOCAL_ACTIVE_is_buyer_effective
 * @impact-areas  catalog, product-detail, modal, market-autonomy
 * @version       2026-09
 */

'use strict';

const express = require('express');
const db = require('../db');
const { getProductDetail } = require('../services/catalog-product-detail');
const { applyActiveMarketPricesToCatalogRows } = require('../services/market-local-price-resolution-service');
const {
  isExcludedPublicProductRef,
  isSyntheticPublicMediaUrl,
} = require('../services/catalog-public-view');

const router = express.Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isPublicDetail(detail) {
  if (!detail || isExcludedPublicProductRef(detail.product?.reference)) return false;
  const media = Array.isArray(detail.media) ? detail.media : [];
  return media.some((item) => {
    const url = String(item?.url || '').trim();
    return url && !isSyntheticPublicMediaUrl(url);
  });
}

router.get('/:id/detail', async (req, res, next) => {
  try {
    if (!UUID_RE.test(req.params.id)) {
      return res.status(400).json({ error: 'ID produit invalide' });
    }

    const detail = await getProductDetail(db, req.params.id);
    if (!isPublicDetail(detail)) {
      return res.status(404).json({ error: 'Produit introuvable' });
    }

    if (req.query.market) {
      const { rows: [priceProduct] } = await db.query(
        `SELECT id, price_kmf, promo_pct, is_promo, promo_until
           FROM products
          WHERE id = $1 AND is_active = TRUE`,
        [req.params.id]
      );
      if (priceProduct) {
        const [marketProduct] = await applyActiveMarketPricesToCatalogRows(db, {
          marketCode: req.query.market,
          products: [priceProduct],
        });
        if (marketProduct?.market_price_source === 'LOCAL_ACTIVE') {
          detail.pricing.price_kmf = marketProduct.price_kmf;
          detail.pricing.old_price_kmf = marketProduct.market_price_promo_applied
            ? marketProduct.market_price_base_kmf
            : null;
          detail.pricing.promo_pct = marketProduct.market_price_promo_applied
            ? Number(priceProduct.promo_pct) || null
            : null;
          if (Array.isArray(detail.sellable_units)) {
            detail.sellable_units = detail.sellable_units.map(unit => ({
              ...unit,
              price_kmf: marketProduct.price_kmf,
            }));
          }
        }
      }
    }

    return res.json(detail);
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
