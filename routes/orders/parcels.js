/**
 * @komerce-arch
 * @role          orders-parcels
 * @domain        orders
 * @layer         route
 * @criticality   critical
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db.js, middleware/auth.js, services/*
 * @used-by       bootstrap/api-routes.js
 * @db-read       @unknown
 * @db-write      @unknown
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  orders, checkout, logistics
 * @version       2026-06
 */

/**
 * KOMERCE — Expédition partielle & colis (Parcel-Centric v2.0 — Phase 4)
 *
 * POST   /:id/mark-availability      → marquer la disponibilité des articles
 * POST   /:id/partial-ship           → créer une expédition partielle (parcels)
 * GET    /:id/parcels                → liste des colis d'une commande
 * GET    /:id/sub-orders             → backward compat → redirect /parcels
 * PATCH  /parcels/:parcelId/status   → changer statut d'un colis
 * PATCH  /sub-orders/:subId/status   → backward compat
 * POST   /:id/cancel-backorder       → annuler un colis backorder
 *
 * R4 — Route = auth + validation + appel service + réponse.
 * Toute la logique métier (transactions, mutations DB) est dans :
 *   services/parcel-operations.js — markAvailability, partialShip, updateParcelStatus, cancelBackorder
 *   services/parcel-guards.js     — validations pures
 */

'use strict';

const express = require('express');
const router  = express.Router();
const db      = require('../../db');
const { authenticate, requireRole } = require('../../middleware/auth');
const { validate }                  = require('../../middleware/validate');
const { orders }                    = require('../../validators');
const { markAvailability, partialShip, updateParcelStatus, cancelBackorder } = require('../../services/parcel-operations');

// ─── POST /api/orders/:id/mark-availability ──────────────────────────────────

router.post('/:id/mark-availability', authenticate, requireRole(['admin', 'agent_hub']), validate(orders.markAvailability), async (req, res, next) => {
  try {
    const { status, body } = await markAvailability(req.params.id, req.body.items, req.user);
    res.status(status).json(body);
  } catch (err) { next(err); }
});

// ─── POST /api/orders/:id/partial-ship ───────────────────────────────────────

router.post('/:id/partial-ship', authenticate, requireRole(['admin', 'agent_hub']), validate(orders.partialShip), async (req, res, next) => {
  try {
    const { status, body } = await partialShip(req.params.id, req.body, req.user);
    res.status(status).json(body);
  } catch (err) { next(err); }
});

// ─── GET /api/orders/:id/sub-orders → backward compat redirect ───────────────

router.get('/:id/sub-orders', authenticate, (req, res) => {
  res.redirect(307, `/api/orders/${req.params.id}/parcels`);
});

// ─── GET /api/orders/:id/parcels ─────────────────────────────────────────────

router.get('/:id/parcels', authenticate, async (req, res, next) => {
  try {
    const { id } = req.params;

    const { rows: [order] } = await db.query(
      'SELECT id, reference, user_id, status FROM orders WHERE id = $1',
      [id]
    );
    if (!order) return res.status(404).json({ error: 'Commande introuvable' });

    const isPrivileged = ['admin', 'agent_hub', 'agent_relais'].includes(req.user.role);
    if (!isPrivileged && order.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Accès refusé' });
    }

    const { rows: parcelRows } = await db.query(
      `SELECT
         p.id, p.type, p.status, p.reference,
         p.label, p.estimated_date, p.shipped_at,
         p.available_at, p.collected_at, p.cancelled_at,
         p.cancel_reason, p.notes,
         p.created_at, p.updated_at
       FROM parcels p
       WHERE p.order_id = $1 AND p.status != 'cancelled'
       ORDER BY p.created_at ASC`,
      [id]
    );

    const enriched = [];
    for (const parcel of parcelRows) {
      const { rows: items } = await db.query(
        `SELECT
           pi.id, pi.order_item_id, pi.quantity,
           oi.price_kmf,
           p.name AS product_name, p.image_url AS product_image
         FROM parcel_items pi
         JOIN products p ON p.id = pi.product_id
         JOIN order_items oi ON oi.id = pi.order_item_id
         WHERE pi.parcel_id = $1
         ORDER BY pi.created_at ASC`,
        [parcel.id]
      );

      enriched.push({
        ...parcel,
        items,
        total_kmf: items.reduce((sum, i) => sum + (Number(i.price_kmf) * i.quantity), 0),
      });
    }

    res.json({
      order_reference: order.reference,
      order_status:    order.status,
      parcels:         enriched,
    });

  } catch(err) { next(err); }
});

// ─── PATCH /api/orders/parcels/:parcelId/status ──────────────────────────────

router.patch('/parcels/:parcelId/status', authenticate, requireRole(['admin', 'agent_hub', 'agent_relais']), validate(orders.parcelStatus), async (req, res, next) => {
  try {
    const { status, body } = await updateParcelStatus(req.params.parcelId, req.body, req.user);
    res.status(status).json(body);
  } catch (err) { next(err); }
});

// Backward compat: old sub-orders status endpoint
router.patch('/sub-orders/:subId/status', authenticate, requireRole(['admin', 'agent_hub', 'agent_relais']), (req, res, next) => {
  req.params.parcelId = req.params.subId;
  req.url = `/parcels/${req.params.subId}/status`;
  next();
});

// ─── POST /api/orders/:id/cancel-backorder ───────────────────────────────────

router.post('/:id/cancel-backorder', authenticate, validate(orders.cancelBackorder), async (req, res, next) => {
  try {
    const { status, body } = await cancelBackorder(req.params.id, req.body, req.user);
    res.status(status).json(body);
  } catch (err) { next(err); }
});

module.exports = router;
