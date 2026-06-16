/**
 * @komerce-arch
 * @role          economic-engine-admin-cost-components
 * @domain        economic-engine
 * @layer         route
 * @criticality   high
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db.js, middleware/auth.js, services/*
 * @used-by       bootstrap/api-routes.js
 * @db-read       cost_component_events, cost_components
 * @db-write      cost_component_events, cost_components
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  economic-engine, admin-dashboard
 * @version       2026-06
 */

/**
 * KOMERCE — Routes admin cost_components (Phase 1)
 * ═══════════════════════════════════════════════════════════════════
 *
 * Doctrine §3 : structure modulable des coûts.
 *   3 familles : landed_relay (9 cat) / business (3 cat) / exceptional (1+)
 *
 * Chaque coût peut être :
 *   - activé / désactivé (is_active)
 *   - marqué exceptionnel (is_exceptional → exclu du calcul prix par défaut)
 *   - limité à un canal (cash_relais / diaspora / mobile_money)
 *   - limité à une île (grande_comore / moheli / anjouan / mayotte)
 *   - limité à une catégorie (scope='category', scope_value=customs_categories.key)
 *   - daté (active_from / active_until)
 *
 * Phase 1 : CRUD + activation/désactivation + audit log.
 * Pas encore de valorisation fine (Phase 2).
 * Pas encore d'allocation (Phase 3).
 *
 * Endpoints :
 *   GET    /api/admin/cost-components             — lister (filtres optionnels)
 *   GET    /api/admin/cost-components/:id         — détail
 *   POST   /api/admin/cost-components             — créer
 *   PUT    /api/admin/cost-components/:id         — modifier
 *   DELETE /api/admin/cost-components/:id         — soft delete (is_active=FALSE)
 *   POST   /api/admin/cost-components/:id/toggle  — activer/désactiver
 *   GET    /api/admin/cost-components/_meta       — enums autorisés (pour l'UI)
 */

'use strict';

const express = require('express');
const router  = express.Router();

const db = require('../db');
const { authenticate } = require('../middleware/auth');

// ── Middleware admin ──
function requireAdminOrFounder(req, res, next) {
  const role = req.user?.role;
  if (role !== 'admin') {
    return res.status(403).json({ error: 'Accès admin requis' });
  }
  next();
}

// ═══════════════════════════════════════════════════════════════════════
// ENUMS exposés à l'UI (pour les selects du formulaire)
// ═══════════════════════════════════════════════════════════════════════
const META = {
  families: ['landed_relay', 'business', 'exceptional'],
  categories: {
    landed_relay: [
      'product_purchase', 'sourcing', 'hub', 'packaging',
      'freight', 'customs', 'port_transitary',
      'local_distribution', 'relay',
    ],
    business: ['payment', 'risk_provision', 'fixed_overhead'],
    exceptional: ['incident', 'marketing_campaign'],
  },
  units: [
    'kmf', 'pct',
    'kmf_per_kg', 'kmf_per_m3',
    'kmf_per_order', 'kmf_per_parcel', 'kmf_per_shipment',
    'aed', 'eur', 'usd',
  ],
  scopes: [
    'global', 'category', 'product', 'order', 'parcel',
    'shipment', 'supplier', 'relay',
  ],
  allocation_methods: [
    'none', 'per_order', 'per_item', 'by_value',
    'by_weight', 'by_volume', 'by_taxable_weight',
    'by_quantity', 'by_category_risk', 'manual',
  ],
  sources: ['default', 'category', 'manual', 'supplier', 'real', 'missing'],
  confidences: ['low', 'medium', 'high'],
  channels: ['cash_relais', 'diaspora', 'mobile_money'],
  islands: ['grande_comore', 'moheli', 'anjouan', 'mayotte'],
};

router.get('/_meta', authenticate, requireAdminOrFounder, (req, res) => {
  res.json(META);
});

// ═══════════════════════════════════════════════════════════════════════
// GET /api/admin/cost-components
// Filtres : ?family=...&category=...&channel=...&island=...&scope=...
//           &is_active=true&is_exceptional=false
// ═══════════════════════════════════════════════════════════════════════
router.get('/', authenticate, requireAdminOrFounder, async (req, res, next) => {
  try {
    const conditions = [];
    const params = [];
    let i = 1;

    if (req.query.family) {
      conditions.push(`family = $${i++}`);
      params.push(req.query.family);
    }
    if (req.query.category) {
      conditions.push(`category = $${i++}`);
      params.push(req.query.category);
    }
    if (req.query.channel) {
      conditions.push(`channel = $${i++}`);
      params.push(req.query.channel);
    }
    if (req.query.island) {
      conditions.push(`island = $${i++}`);
      params.push(req.query.island);
    }
    if (req.query.scope) {
      conditions.push(`scope = $${i++}`);
      params.push(req.query.scope);
    }
    if (req.query.is_active === 'true' || req.query.is_active === '1') {
      conditions.push(`is_active = TRUE`);
    } else if (req.query.is_active === 'false' || req.query.is_active === '0') {
      conditions.push(`is_active = FALSE`);
    }
    if (req.query.is_exceptional === 'true' || req.query.is_exceptional === '1') {
      conditions.push(`is_exceptional = TRUE`);
    } else if (req.query.is_exceptional === 'false' || req.query.is_exceptional === '0') {
      conditions.push(`is_exceptional = FALSE`);
    }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const { rows } = await db.query(
      `SELECT * FROM cost_components ${where}
        ORDER BY family, category, display_order, key`,
      params
    );

    // Grouper pour faciliter l'affichage côté UI
    const grouped = {
      landed_relay: {}, business: {}, exceptional: {},
    };
    rows.forEach(c => {
      if (!grouped[c.family]) grouped[c.family] = {};
      if (!grouped[c.family][c.category]) grouped[c.family][c.category] = [];
      grouped[c.family][c.category].push(c);
    });

    res.json({ components: rows, grouped, count: rows.length });
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════════════════
// GET /api/admin/cost-components/:id
// ═══════════════════════════════════════════════════════════════════════
router.get('/:id', authenticate, requireAdminOrFounder, async (req, res, next) => {
  try {
    const r = await db.query('SELECT * FROM cost_components WHERE id = $1', [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Composant introuvable' });

    // Charger l'historique audit
    const evRes = await db.query(
      `SELECT id, event_type, old_value, new_value, notes, created_at
         FROM cost_component_events
        WHERE component_id = $1
        ORDER BY created_at DESC LIMIT 50`,
      [req.params.id]
    );

    res.json({ component: r.rows[0], events: evRes.rows });
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════════════════
// POST /api/admin/cost-components
// Body : { key, label, family, category, default_value, unit, ... }
// ═══════════════════════════════════════════════════════════════════════
router.post('/', authenticate, requireAdminOrFounder, async (req, res, next) => {
  try {
    const b = req.body || {};

    // Validation des champs requis
    const required = ['key', 'label', 'family', 'category', 'default_value', 'unit'];
    for (const f of required) {
      if (b[f] === undefined || b[f] === null || b[f] === '') {
        return res.status(400).json({ error: 'Champ requis manquant : ' + f });
      }
    }

    // Vérifier cohérence famille/catégorie via les META
    const allowedCats = META.categories[b.family] || [];
    if (!allowedCats.includes(b.category)) {
      return res.status(400).json({
        error: `Catégorie "${b.category}" invalide pour la famille "${b.family}". ` +
               `Autorisées : ${allowedCats.join(', ')}`,
      });
    }

    const r = await db.query(
      `INSERT INTO cost_components (
         key, label, emoji, description,
         family, category,
         default_value, unit, currency,
         scope, scope_value, allocation_method,
         source, confidence,
         channel, island,
         is_active, is_exceptional,
         active_from, active_until,
         notes, created_by, updated_by
       ) VALUES (
         $1, $2, $3, $4,
         $5, $6,
         $7, $8, $9,
         $10, $11, $12,
         $13, $14,
         $15, $16,
         $17, $18,
         $19, $20,
         $21, $22, $22
       ) RETURNING *`,
      [
        b.key, b.label, b.emoji || null, b.description || null,
        b.family, b.category,
        b.default_value, b.unit, b.currency || null,
        b.scope || 'global', b.scope_value || null, b.allocation_method || 'none',
        b.source || 'default', b.confidence || 'medium',
        b.channel || null, b.island || null,
        b.is_active !== false, !!b.is_exceptional,
        b.active_from || null, b.active_until || null,
        b.notes || null, req.user?.id || null,
      ]
    );

    // Audit
    await db.query(
      `INSERT INTO cost_component_events (component_id, component_key, event_type, new_value, notes, triggered_by)
         VALUES ($1, $2, 'created', $3, $4, $5)`,
      [r.rows[0].id, r.rows[0].key, JSON.stringify(r.rows[0]), b.notes || null, req.user?.id || null]
    );

    res.json({ component: r.rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Une clé identique existe déjà : ' + (req.body.key || '') });
    }
    next(err);
  }
});

// ═══════════════════════════════════════════════════════════════════════
// PUT /api/admin/cost-components/:id
// ═══════════════════════════════════════════════════════════════════════
router.put('/:id', authenticate, requireAdminOrFounder, async (req, res, next) => {
  try {
    const b = req.body || {};
    const allowed = [
      'label', 'emoji', 'description',
      'family', 'category',
      'default_value', 'unit', 'currency',
      'scope', 'scope_value', 'allocation_method',
      'source', 'confidence',
      'channel', 'island',
      'is_active', 'is_exceptional',
      'active_from', 'active_until',
      'notes',
    ];

    // Charger l'ancien pour audit
    const oldRes = await db.query('SELECT * FROM cost_components WHERE id = $1', [req.params.id]);
    if (!oldRes.rows.length) return res.status(404).json({ error: 'Composant introuvable' });
    const oldComp = oldRes.rows[0];

    // Si on change la famille, vérifier cohérence
    if (b.family !== undefined && b.category !== undefined) {
      const allowedCats = META.categories[b.family] || [];
      if (!allowedCats.includes(b.category)) {
        return res.status(400).json({
          error: `Catégorie "${b.category}" invalide pour la famille "${b.family}".`,
        });
      }
    }

    const sets = [];
    const params = [];
    let i = 1;
    for (const f of allowed) {
      if (b[f] !== undefined) {
        sets.push(`${f} = $${i++}`);
        params.push(b[f]);
      }
    }

    if (!sets.length) return res.status(400).json({ error: 'Aucun champ à modifier' });

    sets.push(`updated_by = $${i++}`);
    params.push(req.user?.id || null);
    params.push(req.params.id);

    const r = await db.query(
      `UPDATE cost_components SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
      params
    );

    // Audit : determine le type d'event
    let evtType = 'updated';
    if (b.default_value !== undefined && Number(b.default_value) !== Number(oldComp.default_value)) {
      evtType = 'value_changed';
    } else if (b.is_active === true && !oldComp.is_active) {
      evtType = 'activated';
    } else if (b.is_active === false && oldComp.is_active) {
      evtType = 'deactivated';
    } else if (b.scope !== undefined && b.scope !== oldComp.scope) {
      evtType = 'scope_changed';
    }

    await db.query(
      `INSERT INTO cost_component_events
         (component_id, component_key, event_type, old_value, new_value, notes, triggered_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        oldComp.id, oldComp.key, evtType,
        JSON.stringify(oldComp), JSON.stringify(r.rows[0]),
        b.notes || null, req.user?.id || null,
      ]
    );

    res.json({ component: r.rows[0] });
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════════════════
// POST /api/admin/cost-components/:id/toggle
// ═══════════════════════════════════════════════════════════════════════
router.post('/:id/toggle', authenticate, requireAdminOrFounder, async (req, res, next) => {
  try {
    const oldRes = await db.query('SELECT * FROM cost_components WHERE id = $1', [req.params.id]);
    if (!oldRes.rows.length) return res.status(404).json({ error: 'Composant introuvable' });
    const oldComp = oldRes.rows[0];

    const newActive = !oldComp.is_active;
    const r = await db.query(
      `UPDATE cost_components SET is_active = $1, updated_by = $2 WHERE id = $3 RETURNING *`,
      [newActive, req.user?.id || null, req.params.id]
    );

    await db.query(
      `INSERT INTO cost_component_events
         (component_id, component_key, event_type, old_value, new_value, triggered_by)
         VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        oldComp.id, oldComp.key,
        newActive ? 'activated' : 'deactivated',
        JSON.stringify({ is_active: oldComp.is_active }),
        JSON.stringify({ is_active: newActive }),
        req.user?.id || null,
      ]
    );

    res.json({ component: r.rows[0] });
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════════════════
// DELETE /api/admin/cost-components/:id (soft : is_active = FALSE)
// Pour vraiment supprimer : passer ?hard=true (uniquement si is_deletable)
// ═══════════════════════════════════════════════════════════════════════
router.delete('/:id', authenticate, requireAdminOrFounder, async (req, res, next) => {
  try {
    const oldRes = await db.query('SELECT * FROM cost_components WHERE id = $1', [req.params.id]);
    if (!oldRes.rows.length) return res.status(404).json({ error: 'Composant introuvable' });
    const oldComp = oldRes.rows[0];

    if (req.query.hard === 'true') {
      if (!oldComp.is_deletable) {
        return res.status(403).json({ error: 'Ce composant est marqué non supprimable' });
      }
      await db.query('DELETE FROM cost_components WHERE id = $1', [req.params.id]);
      await db.query(
        `INSERT INTO cost_component_events
           (component_id, component_key, event_type, old_value, triggered_by)
           VALUES (NULL, $1, 'deleted', $2, $3)`,
        [oldComp.key, JSON.stringify(oldComp), req.user?.id || null]
      );
      return res.json({ ok: true, hard: true });
    }

    // Soft delete
    await db.query(
      `UPDATE cost_components SET is_active = FALSE, updated_by = $1 WHERE id = $2`,
      [req.user?.id || null, req.params.id]
    );
    await db.query(
      `INSERT INTO cost_component_events
         (component_id, component_key, event_type, old_value, triggered_by)
         VALUES ($1, $2, 'deactivated', $3, $4)`,
      [oldComp.id, oldComp.key, JSON.stringify(oldComp), req.user?.id || null]
    );
    res.json({ ok: true, soft: true });
  } catch (err) { next(err); }
});

module.exports = router;
