/**
 * @komerce-arch
 * @role          sourcing-engine
 * @domain        unknown
 * @layer         route
 * @criticality   medium
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db.js, middleware/auth.js, services/*
 * @used-by       bootstrap/api-routes.js
 * @db-read       @unknown
 * @db-write      @unknown
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  unknown
 * @version       2026-06
 */

/**
 * KOMERCE — Moteur sourcing admin (REFACTO-R2) — façade mince
 *
 * GET  /api/admin/sourcing/analysis          → sourcingAnalysis.getAnalysis()
 * GET  /api/admin/sourcing/analysis/:id      → sourcingAnalysis.getAnalysisById()
 * GET  /api/admin/sourcing/synthesis         → sourcingAnalysis.getSynthesis()
 * PUT  /api/admin/sourcing/products/:id      → sourcingMutations.updateProduct()
 * POST /api/admin/sourcing/bulk-rail         → sourcingMutations.bulkAssignRail()
 * GET  /api/admin/sourcing/config            → sourcingAnalysis.getConfig()
 * GET  /api/admin/sourcing/products/:id/variants → lecture seule (reste ici)
 * PUT  /api/admin/sourcing/products/:id/variants → sourcingMutations.replaceVariants()
 *
 * Doctrine : route = auth + validation + appel service + réponse.
 * Mutations → services/sourcing-mutations.js
 * Lectures  → services/sourcing-analysis.js (inchangé)
 *
 * Invariant I-08 : pas de coefficient dur. Config lue via sourcing-analysis.
 * Voir : docs/chantier/REFACTO_ROUTES_STATUS.md (LOT R2)
 */

'use strict';

const express = require('express');
const router  = express.Router();

const db = require('../db');
const { authenticate, requireAdmin } = require('../middleware/auth');
const sourcingAnalysis  = require('../services/sourcing-analysis');
const sourcingMutations = require('../services/sourcing-mutations');

// ── GET /analysis ────────────────────────────────────────────────────────────
router.get('/analysis', authenticate, requireAdmin, async (req, res, next) => {
  try {
    res.json(await sourcingAnalysis.getAnalysis(req.query));
  } catch (err) { next(err); }
});

// ── GET /analysis/:id ────────────────────────────────────────────────────────
router.get('/analysis/:id', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const analysis = await sourcingAnalysis.getAnalysisById(req.params.id);
    if (!analysis) return res.status(404).json({ error: 'Produit introuvable' });
    res.json(analysis);
  } catch (err) { next(err); }
});

// ── GET /synthesis ───────────────────────────────────────────────────────────
router.get('/synthesis', authenticate, requireAdmin, async (req, res, next) => {
  try {
    res.json(await sourcingAnalysis.getSynthesis());
  } catch (err) { next(err); }
});

// ── PUT /products/:id ────────────────────────────────────────────────────────
router.put('/products/:id', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const result = await sourcingMutations.updateProduct(req.params.id, req.body);
    res.status(result.status).json(result.body);
  } catch (err) { next(err); }
});

// ── POST /bulk-rail ──────────────────────────────────────────────────────────
router.post('/bulk-rail', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { product_ids, rail } = req.body;
    const result = await sourcingMutations.bulkAssignRail(product_ids, rail);
    res.status(result.status).json(result.body);
  } catch (err) { next(err); }
});

// ── GET /config ──────────────────────────────────────────────────────────────
router.get('/config', authenticate, requireAdmin, async (req, res, next) => {
  try {
    res.json(await sourcingAnalysis.getConfig());
  } catch (err) { next(err); }
});

// ── GET /products/:id/variants ───────────────────────────────────────────────
router.get('/products/:id/variants', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { rows: prodRows } = await db.query(
      `SELECT id, has_variants FROM products WHERE id = $1`,
      [req.params.id]
    );
    if (!prodRows.length) return res.status(404).json({ error: 'Produit introuvable' });

    const { rows } = await db.query(
      `SELECT id, variant_type, variant_value, sku, stock, price_kmf, image_url, display_order,
              created_at, updated_at
         FROM product_variants
        WHERE product_id = $1
        ORDER BY variant_type ASC, display_order ASC, variant_value ASC`,
      [req.params.id]
    );

    res.json({
      product_id:   req.params.id,
      has_variants: prodRows[0].has_variants,
      variants:     rows,
      total:        rows.length,
    });
  } catch (err) { next(err); }
});

// ── PUT /products/:id/variants ───────────────────────────────────────────────
router.put('/products/:id/variants', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { variants = [] } = req.body || {};
    const result = await sourcingMutations.replaceVariants(req.params.id, variants);
    res.status(result.status).json(result.body);
  } catch (err) { next(err); }
});

module.exports = router;
