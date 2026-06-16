/**
 * @komerce-arch
 * @role          economic-engine-admin-pricing-components
 * @domain        economic-engine
 * @layer         route
 * @criticality   high
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db.js, middleware/auth.js, services/*
 * @used-by       bootstrap/api-routes.js
 * @db-read       @unknown
 * @db-write      @unknown
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  economic-engine, admin-dashboard
 * @version       2026-06
 */

/**
 * KOMERCE — Routes pricing_components (Étape 2 — ADR-011)
 *
 * Variables de coût par commande (Niveau 1 du calcul de prix recommandé).
 * Catégories : sourcing, transit, douane, hub, distribution, paiement.
 *
 * Politique :
 *   - Composants système (is_editable=false) : valeur modifiable, label/key non
 *   - Composants utilisateur (is_editable=true) : tout modifiable
 *   - Soft delete par défaut (is_active=false)
 *   - Hard delete via ?force=true uniquement si is_deletable=true
 *
 * Endpoints :
 *   GET    /api/admin/pricing-components            → liste filtrable
 *   GET    /api/admin/pricing-components/:id        → détail
 *   POST   /api/admin/pricing-components            → créer (utilisateur)
 *   PUT    /api/admin/pricing-components/:id        → modifier
 *   PUT    /api/admin/pricing-components/:id/toggle → toggle is_active
 *   DELETE /api/admin/pricing-components/:id        → soft delete (is_active=false)
 *   DELETE /api/admin/pricing-components/:id?force=true → hard delete
 */

const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');

const guard = [authenticate, requireRole(['admin'])];

// Validation
const VALID_CATEGORIES = ['sourcing', 'transit', 'douane', 'hub', 'distribution', 'paiement'];
const VALID_UNITS      = ['pct', 'kmf', 'kmf_per_kg', 'kmf_per_m3', 'aed', 'aed_per_unit'];

// ─── GET /api/admin/pricing-components ─────────────────────────────────────
router.get('/', authenticate, async (req, res, next) => {
  try {
    const { category, active } = req.query;
    const conditions = ['1=1'];
    const params = [];
    let pi = 1;
    if (category) {
      if (!VALID_CATEGORIES.includes(category)) {
        return res.status(400).json({ error: 'Catégorie invalide' });
      }
      conditions.push(`category = $${pi++}`); params.push(category);
    }
    if (active !== undefined) {
      conditions.push(`is_active = $${pi++}`);
      params.push(active === 'true' || active === '1');
    }
    const { rows } = await db.query(
      `SELECT * FROM pricing_components
        WHERE ${conditions.join(' AND ')}
        ORDER BY category, display_order, label`,
      params
    );
    res.json(rows);
  } catch (err) {
    // Table not yet created → fallback empty
    res.json([]);
  }
});

// ─── GET /api/admin/pricing-components/:id ─────────────────────────────────
router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const { rows: [row] } = await db.query(
      'SELECT * FROM pricing_components WHERE id = $1', [req.params.id]
    );
    if (!row) return res.status(404).json({ error: 'Composant introuvable' });
    res.json(row);
  } catch (err) { next(err); }
});

// ─── POST /api/admin/pricing-components ────────────────────────────────────
router.post('/', ...guard, async (req, res, next) => {
  try {
    const b = req.body;

    // Validation minimale
    if (!b.key || !b.label || !b.category || b.default_value == null || !b.unit) {
      return res.status(400).json({
        error: 'Champs requis: key, label, category, default_value, unit'
      });
    }
    if (!VALID_CATEGORIES.includes(b.category)) {
      return res.status(400).json({
        error: 'Catégorie invalide. Doit être : ' + VALID_CATEGORIES.join(', ')
      });
    }
    if (!VALID_UNITS.includes(b.unit)) {
      return res.status(400).json({
        error: 'Unité invalide. Doit être : ' + VALID_UNITS.join(', ')
      });
    }

    // Vérifier unicité de la clé
    const dup = await db.query(
      'SELECT 1 FROM pricing_components WHERE key = $1', [b.key]
    );
    if (dup.rows.length) {
      return res.status(409).json({ error: 'Une clé "' + b.key + '" existe déjà' });
    }

    const { rows: [row] } = await db.query(
      `INSERT INTO pricing_components (
         key, label, emoji, category,
         default_value, unit, applies_to,
         is_active, is_editable, is_deletable,
         display_order, notes
       ) VALUES (
         $1, $2, $3, $4,
         $5, $6, $7,
         $8, $9, $10,
         $11, $12
       ) RETURNING *`,
      [
        b.key, b.label, b.emoji || null, b.category,
        b.default_value, b.unit, b.applies_to || 'all',
        b.is_active !== false,
        true,   // ⭐ tout composant utilisateur est éditable
        true,   // ⭐ tout composant utilisateur est supprimable
        b.display_order || 999,
        b.notes || null
      ]
    );
    res.status(201).json(row);
  } catch (err) { next(err); }
});

// ─── PUT /api/admin/pricing-components/:id ─────────────────────────────────
router.put('/:id', ...guard, async (req, res, next) => {
  try {
    // Charger pour vérifier is_editable
    const { rows: [existing] } = await db.query(
      'SELECT * FROM pricing_components WHERE id = $1', [req.params.id]
    );
    if (!existing) return res.status(404).json({ error: 'Composant introuvable' });

    // Détermine quels champs sont modifiables
    // - Si is_editable=true (composant utilisateur) : tous champs modifiables
    // - Si is_editable=false (composant système) : seulement valeur, applies_to, is_active, notes
    let allowed;
    if (existing.is_editable) {
      allowed = [
        'label', 'emoji', 'category', 'default_value', 'unit',
        'applies_to', 'is_active', 'display_order', 'notes'
      ];
    } else {
      allowed = ['default_value', 'applies_to', 'is_active', 'notes'];
      // Tenter de modifier un champ verrouillé → erreur explicite
      const blocked = Object.keys(req.body).filter(k =>
        ['key', 'label', 'category', 'unit'].includes(k)
      );
      if (blocked.length) {
        return res.status(403).json({
          error: 'Composant système : ces champs sont verrouillés',
          locked_fields: blocked,
          hint: 'Pour modifier label/key/unit, créer un nouveau composant utilisateur'
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

    if (req.body.category && !VALID_CATEGORIES.includes(req.body.category)) {
      return res.status(400).json({ error: 'Catégorie invalide' });
    }
    if (req.body.unit && !VALID_UNITS.includes(req.body.unit)) {
      return res.status(400).json({ error: 'Unité invalide' });
    }

    values.push(req.params.id);
    const { rows: [row] } = await db.query(
      `UPDATE pricing_components SET ${updates.join(', ')}, updated_at = NOW()
        WHERE id = $${pi} RETURNING *`,
      values
    );
    res.json(row);
  } catch (err) { next(err); }
});

// ─── PUT /api/admin/pricing-components/:id/toggle ──────────────────────────
// Raccourci pour basculer is_active sans avoir à connaître la valeur actuelle
router.put('/:id/toggle', ...guard, async (req, res, next) => {
  try {
    const { rows: [row] } = await db.query(
      `UPDATE pricing_components
          SET is_active = NOT is_active, updated_at = NOW()
        WHERE id = $1 RETURNING *`,
      [req.params.id]
    );
    if (!row) return res.status(404).json({ error: 'Composant introuvable' });
    res.json(row);
  } catch (err) { next(err); }
});

// ─── DELETE /api/admin/pricing-components/:id ──────────────────────────────
// Soft delete par défaut (is_active=false). Hard delete si ?force=true et is_deletable=true.
router.delete('/:id', ...guard, async (req, res, next) => {
  try {
    const force = req.query.force === 'true' || req.query.force === '1';

    const { rows: [existing] } = await db.query(
      'SELECT * FROM pricing_components WHERE id = $1', [req.params.id]
    );
    if (!existing) return res.status(404).json({ error: 'Composant introuvable' });

    if (force) {
      // Hard delete demandé — vérifier autorisation
      if (!existing.is_deletable) {
        return res.status(403).json({
          error: 'Composant système : suppression définitive interdite',
          hint: 'Tu peux le désactiver via toggle (is_active=false)'
        });
      }
      await db.query('DELETE FROM pricing_components WHERE id = $1', [req.params.id]);
      return res.json({ deleted: true, id: req.params.id, mode: 'hard' });
    }

    // Soft delete (par défaut)
    const { rows: [updated] } = await db.query(
      `UPDATE pricing_components SET is_active = FALSE, updated_at = NOW()
        WHERE id = $1 RETURNING *`,
      [req.params.id]
    );
    res.json({
      deleted: true,
      id: req.params.id,
      mode: 'soft',
      hint: 'Composant désactivé. Pour suppression définitive : DELETE ?force=true',
      component: updated
    });
  } catch (err) { next(err); }
});

module.exports = router;
