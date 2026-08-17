/**
 * @komerce-arch
 * @role          dashboard-admin-customs-shipments
 * @domain        customs
 * @layer         route
 * @criticality   high
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db.js, middleware/auth.js, services/*
 * @used-by       bootstrap/api-routes.js
 * @db-read       customs_shipment_parcels, customs_shipments
 * @db-write      customs_shipment_parcels, customs_shipments, orders, parcels
 * @db-write-via:customs-invoice transaction_documents
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  dashboard, admin-dashboard
 * @version       2026-06
 */

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

// POST /api/admin/customs-shipments/:id/declare
// Deuxième étape du workflow douane : saisie du montant réel payé.
// Déclenche automatiquement toute la chaîne de ventilation.
// Corps : { customs_paid_kmf, freight_kmf?, notes? }
router.post('/:id/declare', ...guard, async (req, res, next) => {
  try {
    const result = await svc.declareCustomsPayment(
      db,
      req.params.id,
      req.body,
      req.user.id
    );
    res.json(result);
  } catch (err) { next(err); }
});

// GET /api/admin/customs-shipments/pending
// Liste les expéditions en attente de déclaration douanière.
router.get('/status/pending', ...guard, async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT
         cs.id, cs.reference, cs.shipment_date, cs.transitaire_name,
         cs.transport_mode, cs.cif_value_kmf, cs.nb_parcels,
         cs.created_at,
         COUNT(csp.parcel_id) AS parcels_linked
       FROM customs_shipments cs
       LEFT JOIN customs_shipment_parcels csp ON csp.shipment_id = cs.id
       WHERE cs.status = 'pending' AND cs.is_active = TRUE
       GROUP BY cs.id
       ORDER BY cs.shipment_date ASC`
    );
    res.json({ shipments: rows, count: rows.length });
  } catch (err) { next(err); }
});

// ── Lot C : analytics écart déclaré/payé ─────────────────────────────────────
// Doctrine DOUANE_DECLARATION_PIVOT — §4 "Côté mesure"
// Lecture seule. Disponible uniquement sur expéditions declared/confirmed.

const analytics = require('../services/customs-analytics');

// GET /api/admin/customs-shipments/analytics
// Liste toutes les expéditions déclarées avec leur écart attendu/réel.
// Query params : from (date), to (date), transitaire (string partiel)
router.get('/analytics', ...guard, async (req, res, next) => {
  try {
    const { from, to, transitaire } = req.query;
    const rows = await analytics.listShipmentsAnalytics(db, { from, to, transitaire });
    res.json({ shipments: rows, count: rows.length });
  } catch (err) { next(err); }
});

// GET /api/admin/customs-shipments/analytics/trends
// Agrégats mensuels : variance moyenne, taux effectif moyen.
// Query param : months (défaut 12)
router.get('/analytics/trends', ...guard, async (req, res, next) => {
  try {
    const months = parseInt(req.query.months) || 12;
    const rows = await analytics.getTrendAnalytics(db, { months });
    res.json({ trends: rows, months });
  } catch (err) { next(err); }
});

// GET /api/admin/customs-shipments/:id/analytics
// Écart détaillé pour une expédition spécifique.
router.get('/:id/analytics', ...guard, async (req, res, next) => {
  try {
    const result = await analytics.getShipmentAnalytics(db, req.params.id);
    if (!result) return res.status(404).json({ error: 'Expédition introuvable ou non déclarée' });
    res.json(result);
  } catch (err) { next(err); }
});
