/**
 * @komerce-arch
 * @role          config
 * @domain        operations
 * @layer         route
 * @criticality   medium
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db.js, middleware/auth.js, services/*
 * @used-by       bootstrap/api-routes.js
 * @db-read       @unknown
 * @db-write      rule
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  operations
 * @version       2026-06
 */

/**
 * KOMERCE — API Configuration Admin (routes/config.js)
 *
 * 5 endpoints pour gérer les règles métier :
 *   GET    /api/config/rules            → liste toutes les règles (groupées par catégorie)
 *   GET    /api/config/rules/:key       → détail d'une règle + historique
 *   PUT    /api/config/rules/:key       → modifier une règle (+ raison optionnelle)
 *   POST   /api/config/rules/:key/reset → reset à la valeur par défaut
 *   GET    /api/config/rules/:key/history → historique des modifications
 *
 * Auth : JWT + rôle admin
 */

'use strict';

const express = require('express');
const router  = express.Router();
const { authenticate, requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { config: configSchemas } = require('../validators');
const log = require('../utils/logger').child({ module: 'config' });
const {
  getAllRules,
  getRuleByKey,
  updateRule,
  resetRule,
  getRuleHistory,
} = require('../utils/rules');

// Toutes les routes config = admin only
router.use(authenticate, requireRole(['admin']));

// ═══════════════════════════════════════════════════════════════════════════════
// 1. GET /api/config/rules — Liste toutes les règles groupées par catégorie
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/rules', async (req, res) => {
  try {
    const categories = await getAllRules();
    res.json({ categories });
  } catch (err) {
    log.error({ err }, '[CONFIG] List rules error:');
    res.status(500).json({ error: 'Erreur récupération des règles' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. GET /api/config/rules/:key — Détail d'une règle + historique récent
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/rules/:key', async (req, res) => {
  try {
    const rule = await getRuleByKey(req.params.key);
    if (!rule) return res.status(404).json({ error: 'Règle introuvable' });

    // Inclure les 10 dernières modifications
    const history = await getRuleHistory(req.params.key);

    res.json({
      key:         rule.key,
      category:    rule.category,
      label_fr:    rule.label_fr,
      description: rule.description,
      value:       rule.value?.value,
      value_type:  rule.value_type,
      min_value:   rule.min_value ? Number(rule.min_value) : null,
      max_value:   rule.max_value ? Number(rule.max_value) : null,
      is_active:   rule.is_active,
      updated_at:  rule.updated_at,
      created_at:  rule.created_at,
      history:     history.slice(0, 10),
    });
  } catch (err) {
    log.error({ err }, '[CONFIG] Get rule error:');
    res.status(500).json({ error: 'Erreur récupération de la règle' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. PUT /api/config/rules/:key — Modifier une règle
// ═══════════════════════════════════════════════════════════════════════════════
// Body : { value: <new_value>, reason?: "Retour terrain — ..." }

router.put('/rules/:key', validate(configSchemas.updateRule), async (req, res) => {
  try {
    const { value, reason } = req.body;

    if (value === undefined) {
      return res.status(400).json({ error: 'Le champ "value" est obligatoire' });
    }

    const updated = await updateRule(req.params.key, value, req.user.id, reason);

    res.json({
      success: true,
      key:     updated.key,
      value:   value,
      message: `Règle "${updated.label_fr}" mise à jour`,
    });
  } catch (err) {
    log.error({ err }, '[CONFIG] Update rule error:');

    // Erreurs de validation → 422
    if (err.message.includes('Valeur minimum') || err.message.includes('Valeur maximum') ||
        err.message.includes('Type attendu') || err.message.includes('introuvable')) {
      return res.status(422).json({ error: err.message });
    }

    res.status(500).json({ error: 'Erreur mise à jour de la règle' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. POST /api/config/rules/:key/reset — Reset à la valeur par défaut
// ═══════════════════════════════════════════════════════════════════════════════

router.post('/rules/:key/reset', async (req, res) => {
  try {
    const rule = await resetRule(req.params.key, req.user.id);

    res.json({
      success: true,
      key:     rule.key,
      value:   rule.value?.value,
      message: `Règle "${rule.label_fr}" remise à la valeur par défaut`,
    });
  } catch (err) {
    log.error({ err }, '[CONFIG] Reset rule error:');
    if (err.message.includes('introuvable')) {
      return res.status(404).json({ error: err.message });
    }
    res.status(500).json({ error: 'Erreur reset de la règle' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. GET /api/config/rules/:key/history — Historique des modifications
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/rules/:key/history', async (req, res) => {
  try {
    const rule = await getRuleByKey(req.params.key);
    if (!rule) return res.status(404).json({ error: 'Règle introuvable' });

    const history = await getRuleHistory(req.params.key);

    res.json({
      key:      req.params.key,
      label_fr: rule.label_fr,
      total:    history.length,
      history:  history.map(h => ({
        old_value:     h.old_value?.value,
        new_value:     h.new_value?.value,
        reason:        h.change_reason,
        changed_by:    h.changed_by_name || 'Système',
        changed_at:    h.created_at,
      })),
    });
  } catch (err) {
    log.error({ err }, '[CONFIG] Rule history error:');
    res.status(500).json({ error: 'Erreur historique de la règle' });
  }
});

module.exports = router;
