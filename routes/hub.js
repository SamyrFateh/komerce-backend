/**
 * KOMERCE — Hub Terrain API (R2 compliant) — V2.3 Batch + Filtres
 *
 * EXISTING ENDPOINTS (unchanged):
 *   POST /api/hub/scan     — Scanner un colis (réception hub)
 *   POST /api/hub/pack     — Marquer colis emballé
 *   POST /api/hub/seal     — Sceller colis, prêt à expédier
 *   GET  /api/hub/pending  — Colis en attente de traitement
 *   GET  /api/hub/today    — Stats du jour
 *
 * V2.3 NEW ENDPOINTS:
 *   POST /api/hub/batch-scan  — Scanner plusieurs colis d'un coup
 *   GET  /api/hub/search      — Recherche de colis par référence/status
 *   GET  /api/hub/stats/week  — Stats hebdo pour dashboard hub
 *
 * Safety Fix B: SELECT … FOR UPDATE sur scan/pack/seal (anti race-condition)
 *
 * FIX-004 (7 avril 2026):
 *   safeSyncScanToParcels() est maintenant exécuté DANS la transaction
 *   (avant COMMIT) pour que le verrou FOR UPDATE reste actif pendant
 *   toute la durée du sync. Le client de transaction est passé en
 *   second argument à safeSyncScanToParcels().
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

router.post('/scan', ...hubAuth, validate({ body: hub.scan }), async (req, res, next) => {
  const client = await db.getClient();
  try {
    const { parcel_ref, notes } = req.body;

    await client.query('BEGIN');

    // FOR UPDATE: verrouille la ligne pour empêcher 2 opérateurs simultanés
    const { rows } = await client.query(
      `SELECT p.id, p.order_id, p.status, p.reference
       FROM parcels p
       WHERE p.reference = $1 AND p.status != 'cancelled'
       FOR UPDATE`,
      [parcel_ref]
    );

    if (!rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: `Colis ${parcel_ref} introuvable` });
    }

    const parcel = rows[0];

    // FIX-004: safeSyncScanToParcels DANS la transaction.
    // Le verrou FOR UPDATE est maintenu → aucune race condition possible.
    const syncResult = await safeSyncScanToParcels({
      order_id: parcel.order_id,
      step: 'hub_preparation',
      scan_id: null,
      scanned_by: req.user.id,
      notes: notes || `Hub scan: ${parcel.reference}`,
    }, client);

    await client.query('COMMIT');

    // Fetch updated parcel (après commit, utilise le pool)
    const updated = await db.query('SELECT * FROM parcels WHERE id = $1', [parcel.id]);

    res.json({
      message: `Colis ${parcel.reference} scanné au hub`,
      parcel: updated.rows[0],
      sync: syncResult,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

// ── POST /pack — Mark parcel as packed ───────────────────────────────────────

router.post('/pack', ...hubAuth, validate({ body: hub.pack }), async (req, res, next) => {
  const client = await db.getClient();
  try {
    const { parcel_id, box_label, notes } = req.body;

    await client.query('BEGIN');

    // FOR UPDATE: verrouille la ligne
    const { rows } = await client.query(
      `SELECT id, order_id, status, reference
       FROM parcels WHERE id = $1 AND status != 'cancelled'
       FOR UPDATE`,
      [parcel_id]
    );

    if (!rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Colis introuvable' });
    }

    const parcel = rows[0];

    if (parcel.status !== 'preparation') {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: `Colis ${parcel.reference} n'est pas en préparation (statut: ${parcel.status})`,
      });
    }

    // Record pack metadata (no status change — pack is an intermediate step)
    const packNote = `[PACKED] ${new Date().toISOString()} by ${req.user.id}` +
      (box_label ? ` | Box: ${box_label}` : '') +
      (notes ? ` | ${notes}` : '');

    await client.query(
      `UPDATE parcels
       SET notes = CASE
             WHEN notes IS NULL THEN $1
             ELSE notes || E'\n' || $1
           END,
           updated_at = NOW()
       WHERE id = $2`,
      [packNote, parcel_id]
    );

    await client.query('COMMIT');

    const updated = await db.query('SELECT * FROM parcels WHERE id = $1', [parcel_id]);

    res.json({
      message: `Colis ${parcel.reference} emballé`,
      parcel: updated.rows[0],
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

// ── POST /seal — Seal parcel, ready to ship ──────────────────────────────────

router.post('/seal', ...hubAuth, validate({ body: hub.seal }), async (req, res, next) => {
  const client = await db.getClient();
  try {
    const { parcel_id, notes } = req.body;

    await client.query('BEGIN');

    // FOR UPDATE: verrouille la ligne
    const { rows } = await client.query(
      `SELECT id, order_id, status, reference
       FROM parcels WHERE id = $1 AND status != 'cancelled'
       FOR UPDATE`,
      [parcel_id]
    );

    if (!rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Colis introuvable' });
    }

    const parcel = rows[0];

    if (parcel.status !== 'preparation') {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: `Colis ${parcel.reference} doit être en préparation pour être scellé (statut: ${parcel.status})`,
      });
    }

    // FIX-004: safeSyncScanToParcels DANS la transaction.
    const syncResult = await safeSyncScanToParcels({
      order_id: parcel.order_id,
      step: 'shipped',
      scan_id: null,
      scanned_by: req.user.id,
      notes: notes || `Hub seal: ${parcel.reference}`,
    }, client);

    await client.query('COMMIT');

    // Fetch updated parcel (après commit, utilise le pool)
    const updated = await db.query('SELECT * FROM parcels WHERE id = $1', [parcel_id]);

    res.json({
      message: `Colis ${parcel.reference} scellé — prêt à expédier`,
      parcel: updated.rows[0],
      sync: syncResult,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// V2.3 — NEW: POST /batch-scan — Scanner plusieurs colis d'un coup
// ══════════════════════════════════════════════════════════════════════════════

router.post('/batch-scan', ...hubAuth, async (req, res, next) => {
  const { parcel_refs, notes } = req.body;

  if (!Array.isArray(parcel_refs) || parcel_refs.length === 0) {
    return res.status(400).json({ error: 'parcel_refs doit être un tableau non-vide' });
  }
  if (parcel_refs.length > 50) {
    return res.status(400).json({ error: 'Maximum 50 colis par batch' });
  }

  const results = [];
  const errors  = [];

  for (const ref of parcel_refs) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      const { rows } = await client.query(
        `SELECT p.id, p.order_id, p.status, p.reference
         FROM parcels p
         WHERE p.reference = $1 AND p.status != 'cancelled'
         FOR UPDATE`,
        [ref]
      );

      if (!rows.length) {
        await client.query('ROLLBACK');
        errors.push({ ref, error: 'Colis introuvable' });
        continue;
      }

      const parcel = rows[0];

      const syncResult = await safeSyncScanToParcels({
        order_id: parcel.order_id,
        step: 'hub_preparation',
        scan_id: null,
        scanned_by: req.user.id,
        notes: notes || `Batch scan: ${parcel.reference}`,
      }, client);

      await client.query('COMMIT');

      results.push({
        ref: parcel.reference,
        parcel_id: parcel.id,
        order_id: parcel.order_id,
        status: 'scanned',
        sync: syncResult,
      });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      errors.push({ ref, error: err.message });
    } finally {
      client.release();
    }
  }

  res.json({
    message: `${results.length}/${parcel_refs.length} colis scannés`,
    scanned: results,
    errors,
    total_success: results.length,
    total_errors: errors.length,
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// V2.3 — NEW: GET /search — Recherche de colis
// ══════════════════════════════════════════════════════════════════════════════

router.get('/search', ...hubAuth, async (req, res, next) => {
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

// ══════════════════════════════════════════════════════════════════════════════
// V2.3 — NEW: GET /stats/week — Stats hebdomadaires hub
// ══════════════════════════════════════════════════════════════════════════════

router.get('/stats/week', ...hubAuth, async (req, res, next) => {
  try {
    const { rows } = await db.query(`
      SELECT
        DATE(created_at) AS day,
        COUNT(*) FILTER (WHERE status = 'preparation')  AS scanned,
        COUNT(*) FILTER (WHERE notes ILIKE '%[PACKED]%') AS packed,
        COUNT(*) FILTER (WHERE status = 'shipped')       AS sealed,
        COUNT(*)                                          AS total
      FROM parcels
      WHERE created_at >= CURRENT_DATE - INTERVAL '7 days'
      GROUP BY DATE(created_at)
      ORDER BY day ASC
    `);

    // Totals
    const { rows: [totals] } = await db.query(`
      SELECT
        COUNT(*) FILTER (WHERE status IN ('draft', 'preparation')) AS pending,
        COUNT(*) FILTER (WHERE status = 'shipped'
                         AND shipped_at >= CURRENT_DATE)          AS shipped_today,
        AVG(EXTRACT(EPOCH FROM (shipped_at - prepared_at)) / 3600)
          FILTER (WHERE shipped_at IS NOT NULL
                  AND prepared_at IS NOT NULL
                  AND shipped_at >= CURRENT_DATE - INTERVAL '7 days')
          AS avg_processing_hours
      FROM parcels
    `);

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

// ── GET /pending — Parcels awaiting processing (original) ───────────────────

router.get('/pending', ...hubAuth, async (req, res, next) => {
  try {
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
      WHERE p.status IN ('draft', 'preparation')
      ORDER BY p.created_at ASC
    `);

    res.json({ data: rows, count: rows.length });
  } catch(err) { next(err); }
});

// ── GET /today — Today's hub stats (original) ───────────────────────────────

router.get('/today', ...hubAuth, async (req, res, next) => {
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
  } catch(err) { next(err); }
});

module.exports = router;
