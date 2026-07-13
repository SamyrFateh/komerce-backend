/**
 * @komerce-arch
 * @role          catalog-product-detail-http
 * @domain        catalog
 * @layer         route
 * @criticality   high
 * @inputs        product_id
 * @outputs       public_product_detail_v1
 * @depends       db.js, services/catalog-product-detail.js
 * @used-by       routes/products.js, public/boutique/js/b-modal-product-detail-bootstrap.js
 * @db-read       product_skus, product_variants, products
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/doctrine/DOCTRINE_PRODUCT_DETAIL_CONTRACT.md
 * @impact-areas  catalog, product-detail, modal
 * @version       2026-07
 */

'use strict';

const express = require('express');
const db = require('../db');
const { getProductDetail } = require('../services/catalog-product-detail');

const router = express.Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

router.get('/:id/detail', async (req, res, next) => {
  try {
    if (!UUID_RE.test(req.params.id)) {
      return res.status(400).json({ error: 'ID produit invalide' });
    }

    const detail = await getProductDetail(db, req.params.id);
    if (!detail) {
      return res.status(404).json({ error: 'Produit introuvable' });
    }

    return res.json(detail);
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
