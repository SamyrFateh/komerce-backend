/**
 * @komerce-arch
 * @role          dashboard-admin-risk-provisions
 * @domain        economic-engine
 * @layer         route
 * @criticality   high
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db.js, middleware/auth.js, services/*
 * @used-by       bootstrap/api-routes.js
 * @db-read       risk_provisions
 * @db-write      risk_provisions
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  dashboard, admin-dashboard
 * @version       2026-06
 */


'use strict';
/**
 * KOMERCE — Routes risk_provisions (Étape 2 — ADR-011)
 *
 * Provisions risques en % à appliquer sur chaque commande (Niveau 3).
 * Exemples : retours, casse, impayés cash, démarque, compensations.
 *
 * Politique identique à pricing_components.
 *
 * Endpoints :
 *   GET    /api/admin/risk-provisions
 *   GET    /api/admin/risk-provisions/:id
 *   POST   /api/admin/risk-provisions
 *   PUT    /api/admin/risk-provisions/:id
 *   PUT    /api/admin/risk-provisions/:id/toggle
 *   DELETE /api/admin/risk-provisions/:id
 *   DELETE /api/admin/risk-provisions/:id?force=true
 */

const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');

const guard = [authenticate, requireRole(['admin'])];

// ─── GET /api/admin/risk-provisions ────────────────────────────────────────
router.get('/', ...guard, async (req, res, next) => {
  try {
    const { active } = req.query;
    let sql = 'SELECT * FROM risk_provisions';
    const params = [];
    if (active !== undefined) {
      sql += ' WHERE is_active = $1';
      params.push(active === 'true' || active === '1');
    }
    sql += ' ORDER BY display_order, label';
    const { rows } = await db.query(sql, params);
    res.json(rows);
  } catch (err) {
    res.json([]);
  }
});

// ─── GET /api/admin/risk-provisions/:id ────────────────────────────────────
router.get('/:id', ...guard, async (req, res, next) => {
  try {
    const { rows: [row] } = await db.query(
      'SELECT * FROM risk_provisions WHERE id = $1', [req.params.id]
    );
    if (!row) return res.status(404).json({ error: 'Provision introuvable' });
    res.json(row);
  } catch (err) { next(err); }
});

// ─── POST /api/admin/risk-provisions ───────────────────────────────────────
router.post('/', ...guard, async (req, res, next) => {
  try {
    const b = req.body;
    if (!b.key || !b.label || b.rate_pct == null) {
      return res.status(400).json({ error: 'Champs requis: key, label, rate_pct' });
    }

    const dup = await db.query(
      'SELECT 1 FROM risk_provisions WHERE key = $1', [b.key]
    );
    if (dup.rows.length) {
      return res.status(409).json({ error: 'Une clé "' + b.key + '" existe déjà' });
    }

    const { rows: [row] } = await db.query(
      `INSERT INTO risk_provisions (
         key, label, emoji, rate_pct, applies_to,
         is_active, is_editable, is_deletable,
         display_order, notes
       ) VALUES (
         $1, $2, $3, $4, $5,
         $6, $7, $8,
         $9, $10
       ) RETURNING *`,
      [
        b.key, b.label, b.emoji || null,
        b.rate_pct, b.applies_to || 'all',
        b.is_active !== false,
        true,   // utilisateur = éditable
        true,   // utilisateur = supprimable
        b.display_order || 999,
        b.notes || null
      ]
    );
    res.status(201).json(row);
  } catch (err) { next(err); }
});

// ─── PUT /api/admin/risk-provisions/:id ────────────────────────────────────
router.put('/:id', ...guard, async (req, res, next) => {
  try {
    const { rows: [existing] } = await db.query(
      'SELECT * FROM risk_provisions WHERE id = $1', [req.params.id]
    );
    if (!existing) return res.status(404).json({ error: 'Provision introuvable' });

    let allowed;
    if (existing.is_editable) {
      allowed = ['label', 'emoji', 'rate_pct', 'applies_to', 'is_active', 'display_order', 'notes'];
    } else {
      allowed = ['rate_pct', 'applies_to', 'is_active', 'notes'];
      const blocked = Object.keys(req.body).filter(k =>
        ['key', 'label'].includes(k)
      );
      if (blocked.length) {
        return res.status(403).json({
          error: 'Provision système : ces champs sont verrouillés',
          locked_fields: blocked
        });
      }
    }

    const updates = [], values = [];
    let pi = 1;
    for (const f of allowed) {
      if (req.body[f] !== undefined) {
        updates.push(`${f} = $${pi++}`);
        values.push(req.body[f]);
      }
    }
    if (!updates.length) return res.status(400).json({ error: 'Aucun champ à mettre à jour' });

    values.push(req.params.id);
    const { rows: [row] } = await db.query(
      `UPDATE risk_provisions SET ${updates.join(', ')}, updated_at = NOW()
        WHERE id = $${pi} RETURNING *`,
      values
    );
    res.json(row);
  } catch (err) { next(err); }
});

// ─── PUT /api/admin/risk-provisions/:id/toggle ─────────────────────────────
router.put('/:id/toggle', ...guard, async (req, res, next) => {
  try {
    const { rows: [row] } = await db.query(
      `UPDATE risk_provisions
          SET is_active = NOT is_active, updated_at = NOW()
        WHERE id = $1 RETURNING *`,
      [req.params.id]
    );
    if (!row) return res.status(404).json({ error: 'Provision introuvable' });
    res.json(row);
  } catch (err) { next(err); }
});

// ─── DELETE /api/admin/risk-provisions/:id ─────────────────────────────────
router.delete('/:id', ...guard, async (req, res, next) => {
  try {
    const force = req.query.force === 'true' || req.query.force === '1';

    const { rows: [existing] } = await db.query(
      'SELECT * FROM risk_provisions WHERE id = $1', [req.params.id]
    );
    if (!existing) return res.status(404).json({ error: 'Provision introuvable' });

    if (force) {
      if (!existing.is_deletable) {
        return res.status(403).json({
          error: 'Provision système : suppression définitive interdite',
          hint: 'Tu peux la désactiver via toggle (is_active=false)'
        });
      }
      await db.query('DELETE FROM risk_provisions WHERE id = $1', [req.params.id]);
      return res.json({ deleted: true, id: req.params.id, mode: 'hard' });
    }

    const { rows: [updated] } = await db.query(
      `UPDATE risk_provisions SET is_active = FALSE, updated_at = NOW()
        WHERE id = $1 RETURNING *`,
      [req.params.id]
    );
    res.json({
      deleted: true,
      id: req.params.id,
      mode: 'soft',
      hint: 'Provision désactivée. Pour suppression définitive : DELETE ?force=true',
      provision: updated
    });
  } catch (err) { next(err); }
});

module.exports = router;

