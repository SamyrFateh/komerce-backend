'use strict';

/**
 * Admin collective repair routes.
 *
 * These endpoints expose the I-SWEEP-4A/4B repair services that were already
 * implemented but not reachable from the runtime P0 helper.
 */

const express = require('express');
const router = express.Router();
const { authenticate, requireRole } = require('../middleware/auth');
const { repairCollectiveReadyToCapture } = require('../services/repair-collective-ready-to-capture');
const { repairCollectiveStockReservations } = require('../services/repair-collective-stock-reservations');

const guard = [authenticate, requireRole(['admin'])];

function toBool(value, fallback = true) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return !['false', '0', 'no'].includes(value.toLowerCase());
  return Boolean(value);
}

router.post('/repair-ready-to-capture', ...guard, async (req, res, next) => {
  try {
    const result = await repairCollectiveReadyToCapture({
      dryRun: toBool(req.body?.dry_run, true),
      limit: req.body?.limit,
      minAgeMinutes: req.body?.min_age_minutes ?? req.body?.minAgeMinutes,
      user: req.user,
    });

    return res.status(result.status).json(result.body);
  } catch (err) {
    return next(err);
  }
});

router.post('/repair-stock-reservations', ...guard, async (req, res, next) => {
  try {
    const result = await repairCollectiveStockReservations({
      dryRun: toBool(req.body?.dry_run, true),
      limit: req.body?.limit,
      user: req.user,
    });

    return res.status(result.status).json(result.body);
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
