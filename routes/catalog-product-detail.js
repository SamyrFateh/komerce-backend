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
 * @db-read       product_skus, product_variants, products, product_market_exposure, product_market_price_drafts, markets
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_PRODUCT_DETAIL_CONTRACT.md, only_LOCAL_ACTIVE_is_buyer_effective, visible_means_sellable
 * @impact-areas  catalog, product-detail, modal, market-autonomy
 * @version       2026-09-business-truth
 */

'use strict';

const express = require('express');
const db = require('../db');
const { getProductDetail } = require('../services/catalog-product-detail');
const { applyActiveMarketPricesToCatalogRows } = require('../services/market-local-price-resolution-service');
const {
  isExcludedPublicProductRef,
  isSyntheticPublicMediaUrl,
  publicCatalogVisibilitySql,
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

    const rawMarket = req.query.market || null;
    if (rawMarket && !/^[A-Z]{2}$/i.test(rawMarket)) {
      return res.status(400).json({ error: 'Code marché invalide' });
    }
    const marketCode = rawMarket ? String(rawMarket).toUpperCase() : null;

    let visibleProduct = null;

    // La vérité « Visible » est market-scoped. Dès qu'un marché est fourni
    // (cas Boutique), la fiche directe passe exactement la même frontière que
    // la grille /api/products : produit publiable + unité vendable + exposition
    // ENABLED + prix LOCAL_ACTIVE sur CE marché.
    //
    // Sans marché, on conserve le contrat historique du détail public : cette
    // lecture non autorisante ne prétend pas qu'un produit est « Visible » dans
    // un pays. Cela préserve les consommateurs legacy tout en gardant le gate
    // commercial strict sur tous les parcours Boutique market-scoped.
    if (marketCode) {
      const visibilitySql = publicCatalogVisibilitySql('p', { marketCodeParamIndex: 2 });
      const { rows: [row] } = await db.query(
        `SELECT p.id, p.price_kmf, p.promo_pct, p.is_promo, p.promo_until
           FROM products p
          WHERE p.id = $1
            AND ${visibilitySql}
          LIMIT 1`,
        [req.params.id, marketCode]
      );
      visibleProduct = row || null;
      if (!visibleProduct) {
        return res.status(404).json({ error: 'Produit non disponible sur ce marché' });
      }
    }

    const detail = await getProductDetail(db, req.params.id);
    if (!isPublicDetail(detail)) {
      return res.status(404).json({ error: 'Produit introuvable' });
    }

    if (marketCode) {
      const [marketProduct] = await applyActiveMarketPricesToCatalogRows(db, {
        marketCode,
        products: [visibleProduct],
      });
      if (marketProduct?.purchasable === false) {
        return res.status(404).json({ error: 'Produit non disponible sur ce marché' });
      }
      if (marketProduct?.market_price_source === 'LOCAL_ACTIVE') {
        detail.pricing.price_kmf = marketProduct.price_kmf;
        detail.pricing.old_price_kmf = marketProduct.market_price_promo_applied
          ? marketProduct.market_price_base_kmf
          : null;
        detail.pricing.promo_pct = marketProduct.market_price_promo_applied
          ? Number(visibleProduct.promo_pct) || null
          : null;
        if (Array.isArray(detail.sellable_units)) {
          detail.sellable_units = detail.sellable_units.map(unit => ({
            ...unit,
            price_kmf: marketProduct.price_kmf,
          }));
        }
      }
    }

    return res.json(detail);
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
