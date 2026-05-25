'use strict';

const express = require('express');
const router  = express.Router();
const { authenticate, requireRole } = require('../../middleware/auth');
const log = require('../../utils/logger').child({ module: 'admin/customs' });

const guard = [authenticate, requireRole(['admin'])];

// ─── GET /api/admin/customs ────────────────────────────────────────
router.get('/customs', ...guard, async (req, res, next) => {
  try {
    // customs_history table may not exist yet
    res.json({ history: [], by_category: [], anomalies: [], period_days: 90, note: 'customs_history non implémenté' });
  } catch(err) { next(err); }
});

module.exports = router;
