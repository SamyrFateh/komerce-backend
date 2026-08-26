/**
 * @komerce-arch
 * @role          boutique-taxonomy-admin-api
 * @domain        catalog
 * @layer         route
 * @criticality   high
 * @inputs        admin_category_payload, subcategory_payload, ordering
 * @outputs       category_config, subcategory_config, taxonomy_mutation_result
 * @depends       middleware/auth.js, services/boutique-taxonomy-admin.js
 * @used-by       bootstrap/api-routes.js, admin-dashboard, shop-schema-sync
 * @db-read       none
 * @db-write      none
 * @db-txn        delegated_to_taxonomy_admin_service
 * @doctrine      categories_maj_sans_code, taxonomy_source_db, single_taxonomy_mutation_authority
 * @impact-areas  catalog, boutique-admin, category-navigation, product-discovery
 * @version       2026-08
 */

'use strict';

const express = require('express');
const router = express.Router();
const { authenticate, requireRole } = require('../middleware/auth');
const taxonomy = require('../services/boutique-taxonomy-admin');

const guard = [authenticate, requireRole(['admin'])];

function handleTaxonomyError(err, res, next) {
  if (err instanceof taxonomy.TaxonomyAdminError || err.status) {
    return res.status(err.status || 400).json({ error: err.message, ...(err.code ? { code: err.code } : {}) });
  }
  return next(err);
}

router.get('/', ...guard, async (req, res, next) => {
  try {
    const active = req.query.active === undefined
      ? undefined
      : (req.query.active === 'true' || req.query.active === '1');
    res.json(await taxonomy.listCategories({ active }));
  } catch (err) {
    if (err.code === '42P01') return res.json([]);
    next(err);
  }
});

router.get('/:key', ...guard, async (req, res, next) => {
  try {
    const category = await taxonomy.getCategoryWithSubcats(req.params.key);
    if (!category) return res.status(404).json({ error: 'Catégorie introuvable' });
    res.json(category);
  } catch (err) { next(err); }
});

router.post('/', ...guard, async (req, res, next) => {
  try {
    res.status(201).json(await taxonomy.createCategory(req.body));
  } catch (err) { handleTaxonomyError(err, res, next); }
});

router.put('/:key', ...guard, async (req, res, next) => {
  try {
    res.json(await taxonomy.updateCategory(req.params.key, req.body));
  } catch (err) { handleTaxonomyError(err, res, next); }
});

router.delete('/:key', ...guard, async (req, res, next) => {
  try {
    res.json(await taxonomy.deactivateCategory(req.params.key));
  } catch (err) { handleTaxonomyError(err, res, next); }
});

router.get('/:key/subcategories', ...guard, async (req, res, next) => {
  try {
    const category = await taxonomy.getCategoryWithSubcats(req.params.key);
    res.json(category ? category.subcategories : []);
  } catch (err) { next(err); }
});

router.post('/:key/subcategories', ...guard, async (req, res, next) => {
  try {
    res.status(201).json(await taxonomy.createSubcategory(req.params.key, req.body));
  } catch (err) { handleTaxonomyError(err, res, next); }
});

router.put('/:key/subcategories/:subKey', ...guard, async (req, res, next) => {
  try {
    res.json(await taxonomy.updateSubcategory(req.params.key, req.params.subKey, req.body));
  } catch (err) { handleTaxonomyError(err, res, next); }
});

router.delete('/:key/subcategories/:subKey', ...guard, async (req, res, next) => {
  try {
    res.json(await taxonomy.deactivateSubcategory(
      req.params.key,
      req.params.subKey,
      { hard: req.query.hard === 'true' }
    ));
  } catch (err) { handleTaxonomyError(err, res, next); }
});

module.exports = router;
