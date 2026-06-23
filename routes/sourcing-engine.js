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
 * @db-read       product_variants, products
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
 * GET  /api/admin/sourcing/products/:id/variants → sourcingAnalysis.getProductVariants()
 * PUT  /api/admin/sourcing/products/:id/variants → sourcingMutations.replaceVariants()
 *
 * Doctrine : route = auth + validation + appel service + réponse.
 * Mutations → services/sourcing-mutations.js
 * Lectures  → services/sourcing-analysis.js
 *
 * Invariant I-08 : pas de coefficient dur. Config lue via sourcing-analysis.
 * Voir : docs/chantier/REFACTO_ROUTES_STATUS.md (LOT R2), B1 (BACKEND_GOLIVE_ROADMAP.md)
 */

'use strict';

const express = require('express');
const router  = express.Router();

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
    const result = await sourcingAnalysis.getProductVariants(req.params.id);
    if (!result) return res.status(404).json({ error: 'Produit introuvable' });
    res.json(result);
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
