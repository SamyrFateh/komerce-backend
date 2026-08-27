/**
 * @komerce-arch
 * @role          signals-legacy-facade
 * @domain        decision-signals
 * @layer         route
 * @criticality   medium
 * @inputs        authenticated_admin, legacy_signal_filters, legacy_signal_uuid
 * @outputs       legacy_signal_http_contract
 * @depends       middleware/auth.js, services/signal-admin-service.js, services/signal-service.js
 * @used-by       bootstrap/api-routes.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      legacy_http_isomorphic, signal_lifecycle_owned_by_service
 * @impact-areas  decision-signals, admin-dashboard
 * @version       2026-08
 */

'use strict';

/**
 * Signals API — Legacy compatibility facade
 * Routes: /api/admin/signals/*
 *
 * LOT 4G extracts all list/lifecycle SQL into signal-admin-service so Legacy
 * and Canonical share one authority. UUID parameters remain accepted here only
 * for backward compatibility; Canonical never uses them.
 */

const express = require('express');
const router = express.Router();
const { authenticate, requireAdmin } = require('../middleware/auth');
const signalService = require('../services/signal-service');
const signalAdminService = require('../services/signal-admin-service');

router.use(authenticate, requireAdmin);

router.get('/', async function(req, res, next) {
  try {
    res.json(await signalAdminService.listSignals(req.query || {}));
  } catch (err) {
    next(err);
  }
});

router.get('/stats', async function(req, res, next) {
  try {
    res.json(await signalAdminService.getStats());
  } catch (err) {
    next(err);
  }
});

router.post('/generate', async function(req, res, next) {
  try {
    const types = req.body.types || null;
    const result = await signalService.generateSignals(types);
    res.json({ ok: true, result });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/acknowledge', async function(req, res, next) {
  try {
    const signal = await signalAdminService.acknowledgeById(req.params.id);
    if (!signal) return res.status(404).json({ error: 'Signal not found or not open' });
    res.json({ ok: true, signal: { id: signal.id, status: signal.status } });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/snooze', async function(req, res, next) {
  try {
    const signal = await signalAdminService.snoozeById(req.params.id, req.body.hours);
    if (!signal) return res.status(404).json({ error: 'Signal not found' });
    res.json({
      ok: true,
      signal: {
        id: signal.id,
        status: signal.status,
        ...(signal.snoozed_until == null ? {} : { snoozed_until: signal.snoozed_until }),
      },
    });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/resolve', async function(req, res, next) {
  try {
    const signal = await signalAdminService.resolveById(req.params.id, req.user.id);
    if (!signal) return res.status(404).json({ error: 'Signal not found' });
    res.json({
      ok: true,
      signal: {
        id: signal.id,
        status: signal.status,
        ...(signal.resolved_at == null ? {} : { resolved_at: signal.resolved_at }),
      },
    });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async function(req, res, next) {
  try {
    const deleted = await signalAdminService.hardDeleteById(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Signal not found' });
    res.json({ ok: true, deleted: req.params.id });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
