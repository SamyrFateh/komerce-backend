/**
 * @komerce-arch
 * @role          logistics-carriers
 * @domain        logistics
 * @layer         route
 * @criticality   medium
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db.js, middleware/auth.js, services/*
 * @used-by       bootstrap/api-routes.js
 * @db-read       @unknown
 * @db-write      @unknown
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  logistics
 * @version       2026-06
 */

/**
 * KOMERCE — Carriers CRUD + Customs API
 *
 * GET    /api/carriers                    — List active carriers
 * POST   /api/carriers                    — Create carrier (admin)
 * PATCH  /api/carriers/:id                — Update carrier (admin)
 * DELETE /api/carriers/:id                — Soft-delete carrier (admin)
 * PATCH  /api/carriers/customs/:parcel_id — Update customs info on parcel (admin)
 */

'use strict';

const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');

const adminOnly  = [authenticate, requireRole(['admin'])];
const hubOrAdmin = [authenticate, requireRole(['admin', 'agent_hub'])];

// ── GET / — List active carriers (admin + hub pour sélection à l'expédition) ──

router.get('/', ...hubOrAdmin, async (req, res, next) => {
  try {
    const { rows } = await db.query(`
      SELECT * FROM carriers
      WHERE is_active = TRUE
      ORDER BY name ASC
    `);

    res.json({ data: rows, count: rows.length });
  } catch(err) { next(err); }
});

// ── POST / — Create carrier ─────────────────────────────────────────────────

router.post('/', ...adminOnly, async (req, res, next) => {
  try {
    const {
      name, type = 'maritime', contact_name, contact_phone,
      contact_email, avg_transit_days, cost_per_kg_kmf, notes,
    } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Le nom du transporteur est obligatoire' });
    }

    const { rows } = await db.query(`
      INSERT INTO carriers (name, type, contact_name, contact_phone,
                            contact_email, avg_transit_days, cost_per_kg_kmf, notes)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `, [
      name.trim(), type,
      contact_name || null, contact_phone || null, contact_email || null,
      avg_transit_days || null, cost_per_kg_kmf || null, notes || null,
    ]);

    res.status(201).json(rows[0]);
  } catch(err) { next(err); }
});

// ── PATCH /:id — Update carrier ──────────────────────────────────────────────

router.patch('/:id', ...adminOnly, async (req, res, next) => {
  try {
    const allowedFields = [
      'name', 'type', 'contact_name', 'contact_phone', 'contact_email',
      'avg_transit_days', 'cost_per_kg_kmf', 'is_active', 'notes',
    ];

    const sets = [];
    const values = [];
    let idx = 1;

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        sets.push(`${field} = $${idx++}`);
        values.push(req.body[field]);
      }
    }

    if (sets.length === 0) {
      return res.status(400).json({ error: 'Aucun champ à mettre à jour' });
    }

    sets.push('updated_at = NOW()');
    values.push(req.params.id);

    const { rows } = await db.query(
      `UPDATE carriers SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'Transporteur introuvable' });
    }

    res.json(rows[0]);
  } catch(err) { next(err); }
});

// ── DELETE /:id — Soft-delete carrier ────────────────────────────────────────

router.delete('/:id', ...adminOnly, async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `UPDATE carriers SET is_active = FALSE, updated_at = NOW()
       WHERE id = $1 RETURNING id, name`,
      [req.params.id]
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'Transporteur introuvable' });
    }

    res.json({ message: `Transporteur ${rows[0].name} désactivé`, carrier: rows[0] });
  } catch(err) { next(err); }
});

// ── PATCH /customs/:parcel_id — Update customs info on parcel ────────────────

router.patch('/customs/:parcel_id', ...adminOnly, async (req, res, next) => {
  try {
    const { customs_value_kmf, customs_weight_kg, customs_hs_code,
            customs_cleared_at, customs_notes } = req.body;

    // Validate parcel exists
    const check = await db.query('SELECT id, reference FROM parcels WHERE id = $1', [req.params.parcel_id]);
    if (!check.rows.length) {
      return res.status(404).json({ error: 'Colis introuvable' });
    }

    const sets = [];
    const values = [];
    let idx = 1;

    if (customs_value_kmf !== undefined) { sets.push(`customs_value_kmf = $${idx++}`); values.push(customs_value_kmf); }
    if (customs_weight_kg !== undefined) { sets.push(`customs_weight_kg = $${idx++}`); values.push(customs_weight_kg); }
    if (customs_hs_code !== undefined)   { sets.push(`customs_hs_code = $${idx++}`);   values.push(customs_hs_code); }
    if (customs_cleared_at !== undefined){ sets.push(`customs_cleared_at = $${idx++}`); values.push(customs_cleared_at); }
    if (customs_notes !== undefined)     { sets.push(`customs_notes = $${idx++}`);      values.push(customs_notes); }

    if (sets.length === 0) {
      return res.status(400).json({ error: 'Aucun champ douane à mettre à jour' });
    }

    sets.push('updated_at = NOW()');
    values.push(req.params.parcel_id);

    const { rows } = await db.query(
      `UPDATE parcels SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );

    res.json({
      message: `Douane mise à jour pour colis ${check.rows[0].reference}`,
      parcel: rows[0],
    });
  } catch(err) { next(err); }
});

module.exports = router;
