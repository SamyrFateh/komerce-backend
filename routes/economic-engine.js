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
router.get('/executive', async (req, res) => {
  try {
    res.json(await buildExecutiveSummary());
  } catch (err) {
    log.error('[Economic] Executive error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /variables
router.get('/variables', async (req, res) => {
  try {
    res.json(await getVariables());
  } catch (err) {
    log.error('[Economic] Variables error:', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /variables/:key
router.put('/variables/:key', async (req, res) => {
  try {
    const key = req.params.key;
    const result = await updateVariable(key, req.body);
    if (result.error) return res.status(result.status || 400).json({ error: result.error });
    ecoBridge.invalidateEcoCache();
    ecoBridge.invalidateChargesCache();
    res.json(result);
  } catch (err) {
    log.error('[Economic] Update variable error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /charges
router.get('/charges', async (req, res) => {
  try {
    res.json(await getCharges());
  } catch (err) {
    log.error('[Economic] Charges error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /charges
router.post('/charges', async (req, res) => {
  try {
    const result = await createCharge(req.body);
    if (result.error) return res.status(result.status || 400).json({ error: result.error });
    ecoBridge.invalidateEcoCache();
    ecoBridge.invalidateChargesCache();
    res.json(result);
  } catch (err) {
    log.error('[Economic] Create charge error:', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /charges/:id
router.put('/charges/:id', async (req, res) => {
  try {
    const result = await updateCharge(req.params.id, req.body);
    if (result.error) return res.status(result.status || 400).json({ error: result.error });
    ecoBridge.invalidateEcoCache();
    ecoBridge.invalidateChargesCache();
    res.json(result);
  } catch (err) {
    log.error('[Economic] Update charge error:', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /charges/:id/toggle
router.put('/charges/:id/toggle', async (req, res) => {
  try {
    const result = await toggleCharge(req.params.id);
    if (result.error) return res.status(result.status || 404).json({ error: result.error });
    ecoBridge.invalidateEcoCache();
    ecoBridge.invalidateChargesCache();
    res.json(result);
  } catch (err) {
    log.error('[Economic] Toggle charge error:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /charges/:id
router.delete('/charges/:id', async (req, res) => {
  try {
    const force = req.query.force === 'true' || req.query.force === '1';
    const result = await deleteCharge(req.params.id, force);
    if (result.error) return res.status(result.status || 400).json({ error: result.error, hint: result.hint });
    ecoBridge.invalidateEcoCache();
    ecoBridge.invalidateChargesCache();
    res.json(result);
  } catch (err) {
    log.error('[Economic] Delete charge error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /coherence
router.get('/coherence', async (req, res) => {
  try {
    res.json(await getCoherence());
  } catch (err) {
    log.error('[Economic] Coherence error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /history
router.get('/history', async (req, res) => {
  try {
    res.json(await getHistory());
  } catch (err) {
    log.error('[Economic] History error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /redistribute
router.post('/redistribute', async (req, res) => {
  try {
    await redistribute('manual_force');
    res.json(await buildExecutiveSummary());
  } catch (err) {
    log.error('[Economic] Redistribute error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
