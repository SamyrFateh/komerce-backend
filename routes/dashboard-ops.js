/**
 * @komerce-arch
 * @role          dashboard-dashboard-ops
 * @domain        dashboard
 * @layer         route
 * @criticality   high
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db.js, middleware/auth.js, services/*
 * @used-by       bootstrap/api-routes.js
 * @db-read       @unknown
 * @db-write      @unknown
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  dashboard, admin-dashboard
 * @version       2026-06
 */

'use strict';

/**
 * routes/dashboard-ops.js — Façade R9
 * Toute la logique est dans services/dashboard-ops-queries.js
 */

const express = require('express');
const router  = express.Router();
const log     = require('../utils/logger').child({ module: 'dashboard' });
const { cached, setCache } = require('./dashboard-shared');
const {
  getOps,
  getPilotage,
  getPipeline,
  getRetards,
  getForecast,
  getGlobal,
  getStats,
} = require('../services/dashboard-ops-queries');

// GET /ops
router.get('/ops', async (req, res, next) => {
  try {
    const hit = cached('ops');
    if (hit) return res.json(hit);
    const result = await getOps();
    setCache('ops', result);
    res.json(result);
  } catch(err) { next(err); }
});

// GET /pilotage
router.get('/pilotage', async (req, res, next) => {
  try {
    const mois = req.query.mois || new Date().toISOString().slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(mois)) {
      return res.status(400).json({ error: 'Format mois invalide (YYYY-MM attendu)' });
    }
    const cacheKey = 'pilotage_' + mois;
    const hit = cached(cacheKey);
    if (hit) return res.json(hit);
    const result = await getPilotage(mois);
    setCache(cacheKey, result);
    res.json(result);
  } catch(err) { next(err); }
});

// GET /pipeline
router.get('/pipeline', async (req, res, next) => {
  try {
    const hit = cached('pipeline');
    if (hit) return res.json(hit);
    const result = await getPipeline();
    setCache('pipeline', result);
    res.json(result);
  } catch(err) { next(err); }
});

// GET /retards
router.get('/retards', async (req, res, next) => {
  try {
    res.json(await getRetards(req.query.niveau));
  } catch(err) { next(err); }
});

// GET /forecast
router.get('/forecast', async (req, res, next) => {
  try {
    const { target_date, ref_period = 30 } = req.query;
    if (!target_date) return res.status(400).json({ error: 'target_date obligatoire (YYYY-MM-DD)' });
    const targetDt = new Date(target_date);
    if (isNaN(targetDt.getTime()) || targetDt <= new Date()) {
      return res.status(400).json({ error: 'target_date doit être dans le futur' });
    }
    res.json(await getForecast({ target_date, ref_period }));
  } catch(err) { next(err); }
});

// GET /global
router.get('/global', async (req, res, next) => {
  try {
    const hit = cached('global');
    if (hit) return res.json(hit);
    const result = await getGlobal();
    setCache('global', result);
    res.json(result);
  } catch(err) { next(err); }
});

// GET /stats (alias /global avec mapping pilotage)
router.get('/stats', async (req, res, next) => {
  try {
    res.json(await getStats());
  } catch(err) { next(err); }
});

module.exports = router;
