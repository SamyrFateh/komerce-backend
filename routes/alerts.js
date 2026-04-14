/**
 * KOMERCE — Routes alertes v1.0
 * 
 * GET  /api/v2/alerts           — Liste alertes actives
 * POST /api/v2/alerts/run       — Lancer détection manuellement
 * POST /api/v2/alerts/:id/ack   — Acquitter une alerte
 */

'use strict';

const express = require('express');
const router = express.Router();
const { authenticate, requireRole } = require('../middleware/auth');
const AlertEngine = require('../services/alert-engine');

router.use(authenticate, requireRole(['admin']));

// GET /api/v2/alerts — Alertes actives
router.get('/', async (req, res, next) => {
  try {
    const { type, severity } = req.query;
    const alerts = await AlertEngine.getActiveAlerts({ type, severity });
    res.json({ alerts, total: alerts.length });
  } catch (err) { next(err); }
});

// POST /api/v2/alerts/run — Lancer la détection manuellement
router.post('/run', async (req, res, next) => {
  try {
    const newAlerts = await AlertEngine.runAll();
    const alerts = await AlertEngine.getActiveAlerts();
    res.json({
      message: `Détection terminée — ${newAlerts.length} nouvelle(s) alerte(s)`,
      new_alerts: newAlerts.length,
      total_active: alerts.length,
      alerts
    });
  } catch (err) { next(err); }
});

// POST /api/v2/alerts/:id/ack — Acquitter
router.post('/:id/ack', async (req, res, next) => {
  try {
    const updated = await AlertEngine.acknowledgeAlert(req.params.id, req.user?.full_name || 'admin');
    if (!updated) return res.status(404).json({ error: 'Alerte non trouvée ou déjà traitée' });
    res.json({ message: 'Alerte acquittée', alert: updated });
  } catch (err) { next(err); }
});

module.exports = router;
