'use strict';

/**
 * KOMERCE — Routes Radar Dashboard (pilotage opérationnel temps réel)
 *
 * R9 — Façade mince : auth + appel service + réponse.
 * Toute la logique de lecture vit dans services/radar-queries.js
 * (cache mémoire, seuils business_rules, calcul status_detail).
 *
 * Endpoints :
 *   GET  /api/admin/radar/                         — synthèse légère (alert_count)
 *   GET  /api/admin/radar/alerts                   — alertes critiques du jour
 *   GET  /api/admin/radar/money                    — money cards comparées
 *   GET  /api/admin/radar/status-details           — distribution fine des status_detail
 *   GET  /api/admin/radar/orders-by-detail/:detail — drill-down par status_detail
 *   POST /api/admin/radar/cache/invalidate         — refresh manuel du cache
 */

const express = require('express');
const router  = express.Router();

const { authenticate, requireAdmin } = require('../middleware/auth');
const radar = require('../services/radar-queries');

// 0. Synthèse
router.get('/', authenticate, requireAdmin, async (req, res, next) => {
  try {
    res.json(await radar.getRadarSummary());
  } catch (err) { next(err); }
});

// 1. Alertes
router.get('/alerts', authenticate, requireAdmin, async (req, res, next) => {
  try {
    res.json(await radar.getAlerts());
  } catch (err) { next(err); }
});

// 2. Money cards
router.get('/money', authenticate, requireAdmin, async (req, res, next) => {
  try {
    res.json(await radar.getMoneyCards());
  } catch (err) { next(err); }
});

// 3. Distribution status_detail
router.get('/status-details', authenticate, requireAdmin, async (req, res, next) => {
  try {
    res.json(await radar.getStatusDetails());
  } catch (err) { next(err); }
});

// 4. Drill-down par status_detail
router.get('/orders-by-detail/:detail', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const detail = String(req.params.detail);
    if (!radar.ALLOWED_DETAILS.includes(detail)) {
      return res.status(400).json({ error: 'status_detail invalide' });
    }
    res.json(await radar.getOrdersByDetail(detail));
  } catch (err) { next(err); }
});

// 5. Invalidation manuelle du cache
router.post('/cache/invalidate', authenticate, requireAdmin, (req, res) => {
  radar.invalidateCache();
  res.json({ success: true, message: 'Cache radar invalidé.' });
});

module.exports = router;
