/**
 * @komerce-arch
 * @role          logistics-scans
 * @domain        logistics
 * @layer         route
 * @criticality   medium
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db.js, middleware/auth.js, services/*
 * @used-by       bootstrap/api-routes.js
 * @db-read       orders, product_suppliers, products, purchase_orders, scans, users
 * @db-write      @unknown
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  logistics
 * @version       2026-06
 */

/**
 * KOMERCE — Routes scan logistique (REFACTO-R3) — façade mince
 *
 * POST /api/scans             → scanOps.recordScan()
 * POST /api/scans/collect     → scanOps.collectParcel()
 * POST /api/scans/hub/receive → 501 (délègue purchasing — inchangé)
 * GET  /api/scans/hub/pending → lecture seule (reste ici)
 * POST /api/scans/verify-qr  → scanOps.verifyQr()
 * GET  /api/scans/:order_id  → lecture seule (reste ici)
 *
 * Doctrine : route = auth + validation + appel service + réponse.
 * Logique métier (transactions, anti-fraude, parcelSync) →
 * services/scan-operations.js
 *
 * Invariants préservés : I-01, I-03, I-04, I-09, I-10
 * triggerScan3 exporté depuis services/scan-operations.js (utilisé par purchasing.js)
 *
 * Voir : docs/chantier/REFACTO_ROUTES_STATUS.md (LOT R3)
 */

'use strict';

const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { scans } = require('../validators');
const scanOps = require('../services/scan-operations');

const requireAuth = authenticate;

// ── POST /api/scans ───────────────────────────────────────────────────────────
router.post('/', authenticate, validate(scans.create), async (req, res, next) => {
  try {
    const deviceId = req.headers['x-device-id'] || null;
    const result   = await scanOps.recordScan(req.body, req.user, deviceId);
    res.status(result.status).json(result.body);
  } catch (err) { next(err); }
});

// ── POST /api/scans/collect ───────────────────────────────────────────────────
router.post('/collect', authenticate, requireRole(['admin', 'agent_relais']), validate(scans.collect), async (req, res, next) => {
  try {
    const result = await scanOps.collectParcel(
      req.body,
      req.user,
      req.ip,
      req.get('user-agent')
    );
    res.status(result.status).json(result.body);
  } catch (err) { next(err); }
});

// ── POST /api/scans/hub/receive ───────────────────────────────────────────────
router.post('/hub/receive', requireAuth, requireRole(['admin', 'agent_hub']), validate(scans.hubReceive), async (req, res, next) => {
  const { qr_code, po_id } = req.body;
  try {
    let purchase_order_id = po_id;
    if (qr_code && !po_id) {
      const poRes = await db.query(
        `SELECT id FROM purchase_orders WHERE supplier_order_id = $1 AND status != 'cancelled'`,
        [qr_code]
      );
      if (!poRes.rows.length) {
        return res.status(404).json({ error: `QR code non reconnu : ${qr_code}` });
      }
      purchase_order_id = poRes.rows[0].id;
    }
    if (!purchase_order_id) {
      return res.status(400).json({ error: 'po_id ou qr_code requis' });
    }
    return res.status(501).json({
      error: 'Utilisez POST /api/purchasing/:po_id/receive directement',
      po_id: purchase_order_id,
    });
  } catch (err) { next(err); }
});

// ── GET /api/scans/hub/pending ────────────────────────────────────────────────
// IMPORTANT : doit rester AVANT /:order_id
router.get('/hub/pending', requireAuth, requireRole(['admin', 'agent_hub']), async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT
         o.id            AS order_id,
         o.reference,
         o.status,
         o.created_at,
         COUNT(po.id)    AS total_pos,
         SUM(CASE WHEN po.received_qty >= po.qty THEN 1 ELSE 0 END)  AS pos_recus,
         SUM(po.qty - po.received_qty) FILTER (
           WHERE po.status != 'cancelled' AND po.received_qty < po.qty
         )               AS qty_manquante,
         ARRAY_AGG(
           p.name || ' (' || po.received_qty || '/' || po.qty || ')'
           ORDER BY p.name
         )               AS articles
       FROM orders o
       JOIN purchase_orders po ON po.order_id = o.id
       JOIN product_suppliers ps ON ps.id = po.product_supplier_id
       JOIN products p ON p.id = ps.product_id
       WHERE o.status IN ('ordered', 'confirmed')
         AND po.status != 'cancelled'
       GROUP BY o.id, o.reference, o.status, o.created_at
       ORDER BY o.created_at ASC`
    );
    res.json({ count: result.rows.length, orders: result.rows });
  } catch (err) { next(err); }
});

// ── POST /api/scans/verify-qr ────────────────────────────────────────────────
router.post('/verify-qr', authenticate, requireRole(['admin', 'agent_relais']), validate(scans.verifyQr), async (req, res, next) => {
  try {
    const result = await scanOps.verifyQr(req.body, req.user);
    res.status(result.status).json(result.body);
  } catch (err) { next(err); }
});

// ── GET /api/scans/:order_id ──────────────────────────────────────────────────
// IMPORTANT : doit rester EN DERNIER (route générique)
router.get('/:order_id', authenticate, requireRole(['admin']), async (req, res, next) => {
  try {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(req.params.order_id)) {
      return res.status(400).json({ error: 'order_id invalide — UUID attendu' });
    }
    const { rows } = await db.query(
      `SELECT s.*, u.full_name AS scanned_by_name
       FROM scans s
       LEFT JOIN users u ON u.id = s.scanned_by
       WHERE s.order_id = $1
       ORDER BY s.created_at ASC`,
      [req.params.order_id]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// Export router + triggerScan3 (consommé par purchasing.js)
module.exports = router;
module.exports.triggerScan3 = scanOps.triggerScan3;
