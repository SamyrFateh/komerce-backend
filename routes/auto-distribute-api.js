/**
 * KOMERCE — Auto-Distribution API
 *
 * POST /api/hub/auto-distribute       → Lancer la répartition automatique
 * GET  /api/hub/distribution          → Voir la répartition actuelle
 * POST /api/hub/reassign-order        → Déplacer une commande vers un autre colis
 */

'use strict';

const express = require('express');
const router = express.Router();
const { authenticate, requireRole } = require('../middleware/auth');
const autoParcel = require('../services/auto-parcel');

const hubAuth = [authenticate, requireRole(['admin', 'agent_hub'])];

// POST /api/hub/auto-distribute — Run auto-distribution
router.post('/auto-distribute', ...hubAuth, async (req, res, next) => {
  try {
    const result = await autoParcel.distributeAll();
    res.json({
      message: `${result.distributed} commande(s) répartie(s), ${result.already_assigned} déjà assignée(s)`,
      ...result
    });
  } catch (e) { next(e); }
});

// GET /api/hub/distribution — Current distribution overview
router.get('/distribution', ...hubAuth, async (req, res, next) => {
  try {
    const result = await autoParcel.getDistribution();
    res.json(result);
  } catch (e) { next(e); }
});

// POST /api/hub/reassign-order — Move order to a different parcel
router.post('/reassign-order', ...hubAuth, async (req, res, next) => {
  try {
    const { order_id, target_parcel_id } = req.body;
    if (!order_id || !target_parcel_id) {
      return res.status(400).json({ error: 'order_id et target_parcel_id requis' });
    }
    const result = await autoParcel.reassignOrder(order_id, target_parcel_id);
    if (!result.success) return res.status(400).json(result);
    res.json({ message: 'Commande réassignée', ...result });
  } catch (e) { next(e); }
});

module.exports = router;
