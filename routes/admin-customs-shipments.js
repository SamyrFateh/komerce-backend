'use strict';

/**
 * routes/admin-customs-shipments.js  — façade R8
 *
 * Toute la logique métier est dans services/customs-shipment-service.js.
 * Ce fichier ne contient que du câblage Express.
 */

const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const svc = require('../services/customs-shipment-service');

const guard = [authenticate, requireRole(['admin'])];

// GET /api/admin/customs-shipments
router.get('/', ...guard, async (req, res, next) => {
  try {
    res.json(await svc.listShipments(db, req.query));
  } catch (err) { next(err); }
});

// GET /api/admin/customs-shipments/rates/effective
router.get('/rates/effective', ...guard, async (req, res, next) => {
  try {
    res.json(await svc.getEffectiveRates(db));
  } catch (err) {
    // Si la vue n'existe pas encore (migration pas passée)
    res.json({
      rates: {
        last_30d:  { nb_shipments: 0, total_cif_kmf: 0, total_customs_kmf: 0, rate_pct: 0 },
        last_90d:  { nb_shipments: 0, total_cif_kmf: 0, total_customs_kmf: 0, rate_pct: 0 },
        last_365d: { nb_shipments: 0, total_cif_kmf: 0, total_customs_kmf: 0, rate_pct: 0 },
      },
      fallback_rate_pct: 15,
      warning: 'customs_shipments table empty or migration not applied',
    });
  }
});

// GET /api/admin/customs-shipments/:id
router.get('/:id', ...guard, async (req, res, next) => {
  try {
    res.json(await svc.getShipment(db, req.params.id));
  } catch (err) { next(err); }
});

// POST /api/admin/customs-shipments
router.post('/', ...guard, async (req, res, next) => {
  try {
    res.status(201).json(await svc.createShipment(db, req.body, req.user.id));
  } catch (err) { next(err); }
});

// PATCH /api/admin/customs-shipments/:id
router.patch('/:id', ...guard, async (req, res, next) => {
  try {
    res.json(await svc.updateShipment(db, req.params.id, req.body));
  } catch (err) { next(err); }
});

// POST /api/admin/customs-shipments/:id/deactivate
router.post('/:id/deactivate', ...guard, async (req, res, next) => {
  try {
    res.json(await svc.deactivateShipment(db, req.params.id, req.body.reason));
  } catch (err) { next(err); }
});

// POST /api/admin/customs-shipments/:id/activate
router.post('/:id/activate', ...guard, async (req, res, next) => {
  try {
    res.json(await svc.activateShipment(db, req.params.id, req.body.parcel_ids));
  } catch (err) { next(err); }
});

// DELETE /api/admin/customs-shipments/:id
router.delete('/:id', ...guard, async (req, res, next) => {
  try {
    res.json(await svc.deleteShipment(db, req.params.id));
  } catch (err) { next(err); }
});

module.exports = router;
