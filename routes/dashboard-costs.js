/**
 * KOMERCE — Dashboard Coûts + SLA (V3.7)
 *
 * GET /api/dashboard/costs         — Cost report by carrier
 * GET /api/dashboard/sla           — SLA compliance report
 * GET /api/dashboard/sla/breaches  — Active SLA breaches
 * GET /api/dashboard/sms           — SMS queue stats
 *
 * All endpoints require admin role.
 */

'use strict';

const express = require('express');
const router = express.Router();
const { authenticate, requireRole } = require('../middleware/auth');
const slaService = require('../services/sla-service');
const { getQueueStats } = require('../services/sms-queue');

const adminOnly = [authenticate, requireRole(['admin'])];

// ── GET /costs — Cost report by carrier ─────────────────────────────────────

router.get('/costs', ...adminOnly, async (req, res, next) => {
  try {
    const period = req.query.period || '30d';
    const report = await slaService.getCostReport({ period });
    res.json(report);
  } catch (err) { next(err); }
});

// ── GET /sla — SLA compliance report ────────────────────────────────────────

router.get('/sla', ...adminOnly, async (req, res, next) => {
  try {
    const period = req.query.period || '30d';
    const report = await slaService.getSLAReport({ period });
    res.json(report);
  } catch (err) { next(err); }
});

// ── GET /sla/breaches — Active SLA breaches ─────────────────────────────────

router.get('/sla/breaches', ...adminOnly, async (req, res, next) => {
  try {
    const breaches = await slaService.getActiveBreaches();
    res.json({
      count: breaches.length,
      breaches,
    });
  } catch (err) { next(err); }
});

// ── GET /sms — SMS queue stats ──────────────────────────────────────────────

router.get('/sms', ...adminOnly, async (req, res, next) => {
  try {
    const stats = await getQueueStats();
    res.json(stats);
  } catch (err) { next(err); }
});

module.exports = router;
