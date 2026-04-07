/**
 * KOMERCE — Hub Terrain API (R2 compliant)
 *
 * 3 actions opérateur : scan → pack → seal
 * Auth: admin, agent_hub
 * Tous les changements de statut via parcelSync (R1)
 *
 * POST /api/hub/scan     — Scanner un colis (réception hub)
 * POST /api/hub/pack     — Marquer colis emballé
 * POST /api/hub/seal     — Sceller colis, prêt à expédier
 * GET  /api/hub/pending  — Colis en attente de traitement
 * GET  /api/hub/today    — Stats du jour
 */

'use strict';

const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { hub } = require('../validators');
const { safeSyncScanToParcels } = require('../utils/parcelSync');

const hubAuth = [authenticate, requireRole(['admin', 'agent_hub'])];

// ── POST /scan — Scan parcel QR code (hub receives item) ────────────────────

router.post('/scan', ...hubAuth, validate({ body: hub.scan }), async (req, res) => {
  try {
    const { parcel_ref, notes } = req.body;

    // Find parcel by reference
    const { rows } = await db.query(
      `SELECT p.id, p.order_id, p.status, p.reference
       FROM parcels p
       WHERE p.reference = $1 AND p.status != 'cancelled'`,
      [parcel_ref]
    );

    if (!rows.length) {
      return res.status(404).json({ error: `Colis ${parcel_ref} introuvable` });
    }

    const parcel = rows[0];

    // R1: Use parcelSync for status change → preparation
    const syncResult = await safeSyncScanToParcels({
      order_id: parcel.order_id,
      step: 'hub_preparation',
      scan_id: null,
      scanned_by: req.user.id,
      notes: notes || `Hub scan: ${parcel.reference}`,
    });

    // Fetch updated parcel
    const updated = await db.query('SELECT * FROM parcels WHERE id = $1', [parcel.id]);

    res.json({
      message: `Colis ${parcel.reference} scanné au hub`,
      parcel: updated.rows[0],
      sync: syncResult,
    });
  } catch (err) {
    console.error('Hub scan error:', err.message);
    res.status(500).json({ error: 'Erreur scan hub' });
  }
});

// ── POST /pack — Mark parcel as packed ───────────────────────────────────────

router.post('/pack', ...hubAuth, validate({ body: hub.pack }), async (req, res) => {
  try {
    const { parcel_id, box_label, notes } = req.body;

    // Validate parcel exists and is in preparation
    const { rows } = await db.query(
      `SELECT id, order_id, status, reference
       FROM parcels WHERE id = $1 AND status != 'cancelled'`,
      [parcel_id]
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'Colis introuvable' });
    }

    const parcel = rows[0];

    if (parcel.status !== 'preparation') {
      return res.status(400).json({
        error: `Colis ${parcel.reference} n'est pas en préparation (statut: ${parcel.status})`,
      });
    }

    // Record pack metadata (no status change — pack is an intermediate step)
    const packNote = `[PACKED] ${new Date().toISOString()} by ${req.user.id}` +
      (box_label ? ` | Box: ${box_label}` : '') +
      (notes ? ` | ${notes}` : '');

    await db.query(
      `UPDATE parcels
       SET notes = CASE
             WHEN notes IS NULL THEN $1
             ELSE notes || E'\n' || $1
           END,
           updated_at = NOW()
       WHERE id = $2`,
      [packNote, parcel_id]
    );

    const updated = await db.query('SELECT * FROM parcels WHERE id = $1', [parcel_id]);

    res.json({
      message: `Colis ${parcel.reference} emballé`,
      parcel: updated.rows[0],
    });
  } catch (err) {
    console.error('Hub pack error:', err.message);
    res.status(500).json({ error: 'Erreur emballage hub' });
  }
});

// ── POST /seal — Seal parcel, ready to ship ──────────────────────────────────

router.post('/seal', ...hubAuth, validate({ body: hub.seal }), async (req, res) => {
  try {
    const { parcel_id, notes } = req.body;

    const { rows } = await db.query(
      `SELECT id, order_id, status, reference
       FROM parcels WHERE id = $1 AND status != 'cancelled'`,
      [parcel_id]
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'Colis introuvable' });
    }

    const parcel = rows[0];

    if (parcel.status !== 'preparation') {
      return res.status(400).json({
        error: `Colis ${parcel.reference} doit être en préparation pour être scellé (statut: ${parcel.status})`,
      });
    }

    // R1: Use parcelSync to advance to 'shipped'
    const syncResult = await safeSyncScanToParcels({
      order_id: parcel.order_id,
      step: 'shipped',
      scan_id: null,
      scanned_by: req.user.id,
      notes: notes || `Hub seal: ${parcel.reference}`,
    });

    const updated = await db.query('SELECT * FROM parcels WHERE id = $1', [parcel_id]);

    res.json({
      message: `Colis ${parcel.reference} scellé — prêt à expédier`,
      parcel: updated.rows[0],
      sync: syncResult,
    });
  } catch (err) {
    console.error('Hub seal error:', err.message);
    res.status(500).json({ error: 'Erreur scellage hub' });
  }
});

// ── GET /pending — Parcels awaiting processing ──────────────────────────────

router.get('/pending', ...hubAuth, async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT p.id, p.reference, p.status, p.type, p.order_id, p.notes,
             p.created_at, p.updated_at,
             o.reference AS order_reference,
             u.full_name AS client_name,
             (SELECT COUNT(*) FROM parcel_items pi WHERE pi.parcel_id = p.id) AS items_count
      FROM parcels p
      LEFT JOIN orders o ON o.id = p.order_id
      LEFT JOIN users u ON u.id = o.user_id
      WHERE p.status IN ('draft', 'preparation')
      ORDER BY p.created_at ASC
    `);

    res.json({ data: rows, count: rows.length });
  } catch (err) {
    console.error('Hub pending error:', err.message);
    res.status(500).json({ error: 'Erreur liste colis en attente' });
  }
});

// ── GET /today — Today's hub stats ──────────────────────────────────────────

router.get('/today', ...hubAuth, async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'preparation'
                         AND prepared_at >= CURRENT_DATE)       AS scanned_today,
        COUNT(*) FILTER (WHERE notes ILIKE '%[PACKED]%'
                         AND updated_at >= CURRENT_DATE)        AS packed_today,
        COUNT(*) FILTER (WHERE status = 'shipped'
                         AND shipped_at >= CURRENT_DATE)        AS sealed_today,
        COUNT(*) FILTER (WHERE status IN ('draft', 'preparation')) AS pending_total
      FROM parcels
    `);

    res.json(rows[0]);
  } catch (err) {
    console.error('Hub today stats error:', err.message);
    res.status(500).json({ error: 'Erreur stats hub' });
  }
});

module.exports = router;
