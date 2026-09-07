/**
 * @komerce-arch
 * @role          hub
 * @domain        logistics
 * @layer         route
 * @criticality   medium
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db.js, middleware/auth.js, middleware/require-market-scope.js, services/*
 * @used-by       bootstrap/api-routes.js
 * @db-read       orders, parcel_items, parcels, users
 * @db-write      none
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change, market_operator_scoping (GAP-1)
 * @impact-areas  logistics, market
 * @version       2026-09
 */

/**
 * KOMERCE — Hub Terrain API (REFACTO-R2) — façade mince
 *
 * POST /api/hub/scan        → hubOps.receiveParcel()
 * POST /api/hub/pack        → hubOps.packParcel()
 * POST /api/hub/seal        → hubOps.sealParcel()
 * POST /api/hub/batch-scan  → hubOps.batchScan()
 * GET  /api/hub/pending     — query lecture seule (reste ici)
 * GET  /api/hub/today       — query lecture seule (reste ici)
 * GET  /api/hub/search      — query lecture seule (reste ici)
 * GET  /api/hub/stats/week  — query lecture seule (reste ici)
 */

'use strict';

const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const { attachAuthorizedMarketsForOperator } = require('../middleware/require-market-scope');
const { validate } = require('../middleware/validate');
const { hub } = require('../validators');
const hubOps  = require('../services/hub-operations');
const uploadHub = require('../middleware/upload-hub');

// Les opérations physiques restent exclusivement terrain Hub.
const hubAuth = [authenticate, requireRole(['admin', 'agent_hub'])];
// Les lectures terrain peuvent être supervisées par un market_operator, mais
// uniquement sur les orders.market_id résolus depuis operator_market_scopes.
const hubRead = [authenticate, requireRole(['admin', 'agent_hub', 'market_operator']), attachAuthorizedMarketsForOperator];

function addMarketScope(req, conditions, params, column = 'o.market_id') {
  if (req.user.role !== 'market_operator') return;
  conditions.push(`${column} = ANY($${params.length + 1}::uuid[])`);
  params.push(req.authorizedMarkets ? Array.from(req.authorizedMarkets) : []);
}

// ── POST /scan ───────────────────────────────────────────────────────────────
router.post('/scan', ...hubAuth, validate({ body: hub.scan }), async (req, res, next) => {
  try {
    const { parcel_ref, notes } = req.body;
    const result = await hubOps.receiveParcel(parcel_ref, req.user.id, notes);
    res.status(result.status).json(result.body);
  } catch (err) { next(err); }
});

// ── POST /pack ───────────────────────────────────────────────────────────────
router.post('/pack', ...hubAuth, validate({ body: hub.pack }), async (req, res, next) => {
  try {
    const { parcel_id, box_label, notes } = req.body;
    const result = await hubOps.packParcel(parcel_id, req.user.id, box_label, notes);
    res.status(result.status).json(result.body);
  } catch (err) { next(err); }
});

// ── POST /seal ───────────────────────────────────────────────────────────────
router.post('/seal', ...hubAuth, validate({ body: hub.seal }), async (req, res, next) => {
  try {
    const { parcel_id, notes } = req.body;
    const result = await hubOps.sealParcel(parcel_id, req.user.id, notes);
    res.status(result.status).json(result.body);
  } catch (err) { next(err); }
});

// ── POST /volume ─────────────────────────────────────────────────────────────
router.post('/volume', ...hubAuth, validate({ body: hub.volume }), async (req, res, next) => {
  try {
    const { product_id, volume_cm3, repack_volume_cm3 } = req.body;
    const result = await hubOps.recordVolume(product_id, req.user.id, { volume_cm3, repack_volume_cm3 });
    res.status(result.status).json(result.body);
  } catch (err) { next(err); }
});

// ── POST /photo ──────────────────────────────────────────────────────────────
router.post('/photo', ...hubAuth, uploadHub.single('photo'), uploadHub.validateMagicBytes, async (req, res, next) => {
  const removeUploadedFile = () => {
    if (!req.file || !req.file.path) return;
    try { require('fs').unlinkSync(req.file.path); } catch (_) {}
  };

  try {
    if (!req.file) return res.status(400).json({ error: "Photo manquante (champ multipart 'photo')" });
    const { error, value } = hub.photo.validate({ parcel_id: req.body.parcel_id, notes: req.body.notes });
    if (error) {
      removeUploadedFile();
      return res.status(400).json({ error: error.details[0].message });
    }
    const photoUrl = uploadHub.PUBLIC_PREFIX + req.file.filename;
    const result = await hubOps.recordSealPhoto(value.parcel_id, req.user.id, photoUrl, value.notes || null);
    if (result.status >= 400) removeUploadedFile();
    res.status(result.status).json(result.body);
  } catch (err) {
    removeUploadedFile();
    next(err);
  }
});

// ── POST /batch-scan ─────────────────────────────────────────────────────────
router.post('/batch-scan', ...hubAuth, async (req, res, next) => {
  try {
    const { parcel_refs, notes } = req.body;
    const result = await hubOps.batchScan(parcel_refs, req.user.id, notes);
    res.status(result.status).json(result.body);
  } catch (err) { next(err); }
});

// ── GET /search ──────────────────────────────────────────────────────────────
router.get('/search', ...hubRead, async (req, res, next) => {
  try {
    const { q, status, island, limit = 50, offset = 0 } = req.query;
    const conditions = ['1=1'];
    const params = [];
    let pi = 1;

    if (q) {
      conditions.push(`(p.reference ILIKE $${pi} OR o.reference ILIKE $${pi} OR u.full_name ILIKE $${pi})`);
      params.push(`%${q}%`);
      pi++;
    }
    if (status) {
      conditions.push(`p.status = $${pi}`);
      params.push(status);
      pi++;
    }
    if (island) {
      conditions.push(`o.destination_island = $${pi}`);
      params.push(island);
      pi++;
    }
    addMarketScope(req, conditions, params);
    pi = params.length + 1;
    const where = conditions.join(' AND ');

    const { rows } = await db.query(`
      SELECT p.id, p.reference, p.status, p.type, p.order_id, p.notes,
             p.created_at, p.updated_at,
             o.reference AS order_reference,
             o.destination_island, o.routing_mode, o.transit_hub,
             u.full_name AS client_name,
             (SELECT COUNT(*) FROM parcel_items pi2 WHERE pi2.parcel_id = p.id) AS items_count
      FROM parcels p
      LEFT JOIN orders o ON o.id = p.order_id
      LEFT JOIN users u ON u.id = o.user_id
      WHERE ${where}
      ORDER BY p.updated_at DESC
      LIMIT $${pi} OFFSET $${pi + 1}
    `, [...params, Number(limit), Number(offset)]);

    const { rows: [{ count }] } = await db.query(`
      SELECT COUNT(*) FROM parcels p
      LEFT JOIN orders o ON o.id = p.order_id
      LEFT JOIN users u ON u.id = o.user_id
      WHERE ${where}
    `, params);

    res.json({ data: rows, total: Number(count) });
  } catch (err) { next(err); }
});

// ── GET /stats/week ──────────────────────────────────────────────────────────
router.get('/stats/week', ...hubRead, async (req, res, next) => {
  try {
    const conditions = ["p.created_at >= CURRENT_DATE - INTERVAL '7 days'"];
    const params = [];
    addMarketScope(req, conditions, params);
    const where = conditions.join(' AND ');

    const { rows } = await db.query(`
      SELECT
        DATE(p.created_at) AS day,
        COUNT(*) FILTER (WHERE p.status = 'preparation')   AS scanned,
        COUNT(*) FILTER (WHERE p.notes ILIKE '%[PACKED]%') AS packed,
        COUNT(*) FILTER (WHERE p.status = 'shipped')       AS sealed,
        COUNT(*)                                            AS total
      FROM parcels p
      LEFT JOIN orders o ON o.id = p.order_id
      WHERE ${where}
      GROUP BY DATE(p.created_at)
      ORDER BY day ASC
    `, params);

    const totalConditions = ['1=1'];
    const totalParams = [];
    addMarketScope(req, totalConditions, totalParams);
    const totalWhere = totalConditions.join(' AND ');
    const { rows: [totals] } = await db.query(`
      SELECT
        COUNT(*) FILTER (WHERE p.status IN ('draft', 'preparation')) AS pending,
        COUNT(*) FILTER (WHERE p.status = 'shipped'
                         AND p.shipped_at >= CURRENT_DATE)           AS shipped_today,
        AVG(EXTRACT(EPOCH FROM (p.shipped_at - p.prepared_at)) / 3600)
          FILTER (WHERE p.shipped_at IS NOT NULL
                  AND p.prepared_at IS NOT NULL
                  AND p.shipped_at >= CURRENT_DATE - INTERVAL '7 days')
          AS avg_processing_hours
      FROM parcels p
      LEFT JOIN orders o ON o.id = p.order_id
      WHERE ${totalWhere}
    `, totalParams);

    res.json({
      daily: rows,
      summary: {
        pending: Number(totals.pending || 0),
        shipped_today: Number(totals.shipped_today || 0),
        avg_processing_hours: totals.avg_processing_hours
          ? Math.round(Number(totals.avg_processing_hours) * 10) / 10
          : null,
      },
    });
  } catch (err) { next(err); }
});

// ── GET /pending ─────────────────────────────────────────────────────────────
router.get('/pending', ...hubRead, async (req, res, next) => {
  try {
    const conditions = ["p.status IN ('draft', 'preparation')"];
    const params = [];
    addMarketScope(req, conditions, params);
    const where = conditions.join(' AND ');
    const { rows } = await db.query(`
      SELECT p.id, p.reference, p.status, p.type, p.order_id, p.notes,
             p.created_at, p.updated_at,
             o.reference AS order_reference,
             o.destination_island, o.routing_mode, o.transit_hub,
             u.full_name AS client_name,
             (SELECT COUNT(*) FROM parcel_items pi WHERE pi.parcel_id = p.id) AS items_count
      FROM parcels p
      LEFT JOIN orders o ON o.id = p.order_id
      LEFT JOIN users u ON u.id = o.user_id
      WHERE ${where}
      ORDER BY p.created_at ASC
    `, params);
    res.json({ data: rows, count: rows.length });
  } catch (err) { next(err); }
});

// ── GET /today ───────────────────────────────────────────────────────────────
router.get('/today', ...hubRead, async (req, res, next) => {
  try {
    const conditions = ['1=1'];
    const params = [];
    addMarketScope(req, conditions, params);
    const where = conditions.join(' AND ');
    const { rows } = await db.query(`
      SELECT
        COUNT(*) FILTER (WHERE p.status = 'preparation'
                         AND p.prepared_at >= CURRENT_DATE)       AS scanned_today,
        COUNT(*) FILTER (WHERE p.notes ILIKE '%[PACKED]%'
                         AND p.updated_at >= CURRENT_DATE)        AS packed_today,
        COUNT(*) FILTER (WHERE p.status = 'shipped'
                         AND p.shipped_at >= CURRENT_DATE)        AS sealed_today,
        COUNT(*) FILTER (WHERE p.status IN ('draft', 'preparation')) AS pending_total
      FROM parcels p
      LEFT JOIN orders o ON o.id = p.order_id
      WHERE ${where}
    `, params);
    res.json(rows[0]);
  } catch (err) { next(err); }
});

module.exports = router;
