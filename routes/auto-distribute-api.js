/**
 * KOMERCE — Auto-Distribution API v3
 *
 * POST /api/hub/auto-distribute        — distribute all unassigned orders
 * GET  /api/hub/auto-distribute         — get distribution overview
 * POST /api/hub/auto-distribute/cleanup — delete ghost parcels
 */

'use strict';

const express = require('express');
const router = express.Router();
const { requireRole } = require('../middleware/auth');
const autoParcel = require('../services/auto-parcel');

// POST /api/hub/auto-distribute — run distribution
router.post('/auto-distribute', requireRole('admin', 'agent_hub'), async (req, res) => {
  try {
    // First cleanup ghost parcels
    const cleanup = await autoParcel.cleanupGhostParcels();

    // Then distribute
    const result = await autoParcel.distributeAll();

    res.json({
      message: `${result.distributed} commande(s) répartie(s), ${result.queued} en file, ${cleanup.deleted} colis fantômes supprimés`,
      ...result,
      cleanup
    });
  } catch (e) {
    console.error('[AUTO-DISTRIBUTE]', e);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/hub/auto-distribute — overview for dashboard
router.get('/auto-distribute', requireRole('admin', 'agent_hub'), async (req, res) => {
  try {
    const data = await autoParcel.getDistribution();
    res.json(data);
  } catch (e) {
    console.error('[AUTO-DISTRIBUTE]', e);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/hub/auto-distribute/cleanup — manual ghost cleanup
router.post('/auto-distribute/cleanup', requireRole('admin', 'agent_hub'), async (req, res) => {
  try {
    const result = await autoParcel.cleanupGhostParcels();
    res.json({ message: `${result.deleted} colis fantômes supprimés`, ...result });
  } catch (e) {
    console.error('[AUTO-DISTRIBUTE]', e);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
