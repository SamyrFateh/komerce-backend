/**
 * @komerce-arch
 * @role          canonical-supplier-360-route
 * @domain        admin-dashboard
 * @layer         route
 * @criticality   high
 * @inputs        authenticated_admin, supplier_uuid
 * @outputs       authorized_supplier_360_projection
 * @depends       middleware/auth, services/supplier-360
 * @used-by       bootstrap/api-routes.js
 * @db-read       suppliers, product_suppliers, products, purchase_orders, orders, supplier_execution_orders, supplier_execution_payments
 * @db-write      none
 * @db-txn        none
 * @doctrine      entity_360_reunites_without_recomputing, supplier_secrets_never_exposed
 * @impact-areas  admin-dashboard, purchasing, catalog, supplier-connectivity
 * @version       2026-10
 */
'use strict';

const express = require('express');
const { authenticate, requireRole } = require('../middleware/auth');
const supplier360 = require('../services/supplier-360');
const log = require('../utils/logger').child({ module: 'admin-supplier-360' });

const router = express.Router();

router.get('/suppliers/:supplierId', authenticate, requireRole(['admin']), async (req, res, next) => {
  try {
    const resolved = await supplier360.resolveSupplier(req.params.supplierId);
    if (resolved.invalid) {
      return res.status(400).json({ error: 'Identifiant fournisseur invalide', code: 'invalid_supplier_id' });
    }
    if (!resolved.supplier) {
      return res.status(404).json({ error: 'Fournisseur introuvable', code: 'supplier_not_found' });
    }
    res.set('Cache-Control', 'private, no-store');
    return res.json(await supplier360.loadSupplier360(resolved.supplier));
  } catch (err) {
    log.error({ err, supplierId: req.params.supplierId }, '[admin-supplier-360] read failed');
    return next(err);
  }
});

module.exports = router;
