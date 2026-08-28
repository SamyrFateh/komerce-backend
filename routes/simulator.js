/**
 * @komerce-arch
 * @role          simulator
 * @domain        operations
 * @layer         route
 * @criticality   medium
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db.js, middleware/auth.js, services/*
 * @used-by       bootstrap/api-routes.js
 * @db-read       none
 * @db-write      none
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  unknown
 * @version       2026-06
 */

/**
 * Komerce — Simulator API Route
 * POST /api/simulator/start   — Démarrer simulation
 * POST /api/simulator/stop    — Arrêter simulation
 * GET  /api/simulator/status  — Statut en temps réel
 * GET  /api/simulator/journal — Journal complet
 * POST /api/simulator/cleanup — Nettoyer données test
 */
'use strict';

const express = require('express');
const router = express.Router();
const { authenticate, requireRole } = require('../middleware/auth');
const { requireNonProduction } = require('../middleware/require-non-production');
const engine = require('../services/simulator/engine');
const journal = require('../services/simulator/journal');
const { cleanup } = require('../services/simulator/cleanup');

const adminAuth = [authenticate, requireRole(['admin']), requireNonProduction()];

// POST /start — Démarrer la simulation
router.post('/start', ...adminAuth, async (req, res, next) => {
  try {
    const config = {
      cadence_minutes: req.body.cadence_minutes || 3,
      max_orders: req.body.max_orders || 20,
      chaos_level: req.body.chaos_level || 0.1,
      scenarios: req.body.scenarios || ['nominal', 'abandoned', 'cancelled'],
    };
    const status = await engine.start(config);
    res.json({ message: '🚀 Simulation démarrée', ...status });
  } catch(e) {
    res.status(400).json({ error: e.message });
  }
});

// POST /stop — Arrêter la simulation
router.post('/stop', ...adminAuth, async (req, res, next) => {
  try {
    const status = await engine.stop();
    res.json({ message: '⏹️ Simulation arrêtée', ...status });
  } catch(e) {
    res.status(400).json({ error: e.message });
  }
});

// GET /status — Statut temps réel
router.get('/status', ...adminAuth, async (req, res, next) => {
  try {
    res.json(engine.getStatus());
  } catch(e) {
    res.json({ running: false, error: e.message });
  }
});

// GET /journal — Journal complet
router.get('/journal', ...adminAuth, async (req, res, next) => {
  try {
    res.json({ entries: journal.getAll() });
  } catch(e) {
    res.json({ entries: [], error: e.message });
  }
});

// POST /cleanup — Nettoyer les données de simulation
router.post('/cleanup', ...adminAuth, async (req, res, next) => {
  try {
    // Stop simulation first if running
    try { await engine.stop(); } catch(_) {}

    const results = await cleanup();
    res.json({
      message: '🧹 Nettoyage terminé',
      ...results
    });
  } catch(e) {
    next(e);
  }
});

module.exports = router;
