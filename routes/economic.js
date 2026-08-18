/**
 * @komerce-arch
 * @role          economic-router
 * @domain        economic-engine
 * @layer         route
 * @criticality   high
 * @inputs        admin_requests, variable_mutations, charge_mutations
 * @outputs       executive_summary, variables, charges, coherence, history
 * @depends       services/economic-engine-queries.js, utils/eco-bridge.js, middleware/auth.js
 * @used-by       bootstrap/api-routes.js, admin-dashboards
 * @db-read       none
 * @db-write      none
 * @db-txn        invalidate_cache_after_mutation, admin_only_mutation
 * @doctrine      moteur_economique_lisible, route_facade_service, invalidate_cache_after_mutation
 * @impact-areas  admin-dashboard, pricing, margin, cost-model, snapshots
 * @version       2026-06
 */

'use strict';

/**
 * routes/economic-engine.js — Façade R9
 * Toute la logique est dans services/economic-engine-queries.js
 */

const express = require('express');
const router  = express.Router();
const log     = require('../utils/logger').child({ module: 'economic-engine' });
const { authenticate, requireAdmin } = require('../middleware/auth');
const ecoBridge = require('../utils/eco-bridge');
const {
  seedEconomicData,
  buildExecutiveSummary,
  getVariables,
  getCharges,
  getCoherence,
  getHistory,
  updateVariable,
  createCharge,
  updateCharge,
  toggleCharge,
  deleteCharge,
  redistribute,
} = require('../services/economic-engine-queries');

router.use(authenticate, requireAdmin);

// Seed au démarrage
seedEconomicData().catch(err => log.error({ err }, '[Economic] Seed error'));

// GET /executive
router.get('/executive', async (req, res, next) => {
  try {
    res.json(await buildExecutiveSummary());
  } catch (err) {
    next(err);
  }
});

// GET /variables
router.get('/variables', async (req, res, next) => {
  try {
    res.json(await getVariables());
  } catch (err) {
    next(err);
  }
});

// PUT /variables/:key
router.put('/variables/:key', async (req, res, next) => {
  try {
    const key = req.params.key;
    const result = await updateVariable(key, req.body, req.user && req.user.id);
    if (result.error) return res.status(result.status || 400).json({ error: result.error });
    ecoBridge.invalidateEcoCache();
    ecoBridge.invalidateChargesCache();
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// GET /charges
router.get('/charges', async (req, res, next) => {
  try {
    res.json(await getCharges());
  } catch (err) {
    next(err);
  }
});

// POST /charges
router.post('/charges', async (req, res, next) => {
  try {
    const result = await createCharge(req.body);
    if (result.error) return res.status(result.status || 400).json({ error: result.error });
    ecoBridge.invalidateEcoCache();
    ecoBridge.invalidateChargesCache();
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// PUT /charges/:id
router.put('/charges/:id', async (req, res, next) => {
  try {
    const result = await updateCharge(req.params.id, req.body);
    if (result.error) return res.status(result.status || 400).json({ error: result.error });
    ecoBridge.invalidateEcoCache();
    ecoBridge.invalidateChargesCache();
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// PUT /charges/:id/toggle
router.put('/charges/:id/toggle', async (req, res, next) => {
  try {
    const result = await toggleCharge(req.params.id);
    if (result.error) return res.status(result.status || 404).json({ error: result.error });
    ecoBridge.invalidateEcoCache();
    ecoBridge.invalidateChargesCache();
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// DELETE /charges/:id
router.delete('/charges/:id', async (req, res, next) => {
  try {
    const force = req.query.force === 'true' || req.query.force === '1';
    const result = await deleteCharge(req.params.id, force);
    if (result.error) return res.status(result.status || 400).json({ error: result.error, hint: result.hint });
    ecoBridge.invalidateEcoCache();
    ecoBridge.invalidateChargesCache();
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// GET /coherence
router.get('/coherence', async (req, res, next) => {
  try {
    res.json(await getCoherence());
  } catch (err) {
    next(err);
  }
});

// GET /history
router.get('/history', async (req, res, next) => {
  try {
    res.json(await getHistory());
  } catch (err) {
    next(err);
  }
});

// POST /redistribute
router.post('/redistribute', async (req, res, next) => {
  try {
    await redistribute('manual_force');
    res.json(await buildExecutiveSummary());
  } catch (err) {
    next(err);
  }
});

module.exports = router;
