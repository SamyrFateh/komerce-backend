/**
 * @komerce-arch
 * @role          business-rules-admin-rules
 * @domain        business-rules
 * @layer         route
 * @criticality   high
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db.js, middleware/auth.js, utils/rules.js
 * @used-by       bootstrap/api-routes.js
 * @db-read       business_rules, business_rules_history, users
 * @db-write      business_rules, business_rules_history (via utils/rules.js)
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  business-rules
 * @version       2026-07-29 (rattaché à business-rules, B2)
 */

/**
 * KOMERCE — Routes admin pour piloter les business_rules
 *
 * Endpoints :
 *   GET    /api/admin/rules              — Liste toutes les règles groupées par catégorie
 *   GET    /api/admin/rules/audit        — 100 dernières modifications (toutes règles)
 *   GET    /api/admin/rules/:key         — Détail d'une règle + historique
 *   PATCH  /api/admin/rules/:key         — Modifier la valeur d'une règle
 *   POST   /api/admin/rules/:key/reset   — Remise à la valeur originale
 *
 * Sécurité : admin only via requireAdmin middleware
 * Audit : chaque modification enregistrée dans business_rules_history
 * Cache : invalidation automatique après update (intégré dans utils/rules.js)
 */

'use strict';

const express = require('express');
const router  = express.Router();

const db                = require('../db');
const { authenticate, requireAdmin } = require('../middleware/auth');
const rulesEngine       = require('../utils/rules');

// ── GET /api/admin/rules — liste groupée par catégorie ─────────────────────
router.get('/', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const categories = await rulesEngine.getAllRules();
    res.json({ categories });
  } catch (err) { next(err); }
});

// ── GET /api/admin/rules/audit — historique global (100 dernières modifs) ──
router.get('/audit', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { rows } = await db.query(`
      SELECT h.id, h.old_value, h.new_value, h.change_reason, h.created_at,
             r.key AS rule_key, r.label_fr AS rule_label,
             u.full_name AS changed_by_name, u.email AS changed_by_email
      FROM business_rules_history h
      LEFT JOIN business_rules r ON r.id = h.rule_id
      LEFT JOIN users u ON u.id = h.changed_by
      ORDER BY h.created_at DESC
      LIMIT 100
    `);
    res.json({ history: rows });
  } catch (err) { next(err); }
});

// ── GET /api/admin/rules/:key — détail + historique d'une règle ────────────
router.get('/:key', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const key  = String(req.params.key).toUpperCase();
    if (!/^[A-Z][A-Z0-9_]{2,80}$/.test(key)) {
      return res.status(400).json({ error: 'Format de clé invalide' });
    }

    const rule = await rulesEngine.getRuleByKey(key);
    if (!rule) return res.status(404).json({ error: 'Règle introuvable' });

    const history = await rulesEngine.getRuleHistory(key);
    res.json({ rule, history });
  } catch (err) { next(err); }
});

// ── PATCH /api/admin/rules/:key — modifier une règle ───────────────────────
router.patch('/:key', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const key  = String(req.params.key).toUpperCase();
    if (!/^[A-Z][A-Z0-9_]{2,80}$/.test(key)) {
      return res.status(400).json({ error: 'Format de clé invalide' });
    }

    const { value, reason } = req.body || {};

    // Validation justification obligatoire (min 10 chars)
    if (!reason || typeof reason !== 'string' || reason.trim().length < 10) {
      return res.status(400).json({
        error: 'La justification est obligatoire (minimum 10 caractères).'
      });
    }

    // Type coercion basique côté back (la validation fine est dans updateRule)
    if (value === undefined || value === null) {
      return res.status(400).json({ error: 'Valeur manquante.' });
    }

    const updated = await rulesEngine.updateRule(
      key,
      value,
      req.user.id,
      reason.trim().slice(0, 500) // cap sécurité
    );

    res.json({
      success: true,
      rule: updated,
      message: `Règle "${key}" mise à jour. Cache invalidé.`
    });
  } catch (err) {
    // Erreurs métier (type mismatch, min/max) → 400
    if (err.message && (
      err.message.includes('Type attendu') ||
      err.message.includes('Valeur min') ||
      err.message.includes('Valeur max') ||
      err.message.includes('introuvable')
    )) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
});

// ── POST /api/admin/rules/:key/reset — remise à zéro ───────────────────────
router.post('/:key/reset', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const key = String(req.params.key).toUpperCase();
    if (!/^[A-Z][A-Z0-9_]{2,80}$/.test(key)) {
      return res.status(400).json({ error: 'Format de clé invalide' });
    }

    const reset = await rulesEngine.resetRule(key, req.user.id);
    res.json({
      success: true,
      rule: reset,
      message: `Règle "${key}" remise à sa valeur d'origine.`
    });
  } catch (err) {
    if (err.message && err.message.includes('introuvable')) {
      return res.status(404).json({ error: err.message });
    }
    next(err);
  }
});

module.exports = router;
