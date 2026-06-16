/**
 * @komerce-arch
 * @role          economic-engine-pricing-strategy
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
 * @impact-areas  economic-engine
 * @version       2026-06
 */

'use strict';

/**
 * KOMERCE — Routes Pricing Strategy (Phase 3 — ADR-013)
 *
 * Façade mince : auth + validation + appel service + réponse.
 * Toute la logique métier est dans services/pricing-strategy-service.js.
 *
 * Endpoints :
 *   GET    /api/pricing/strategy/competitors[?product_id=...|category=...]
 *   POST   /api/pricing/strategy/competitors
 *   DELETE /api/pricing/strategy/competitors/:id
 *   GET    /api/pricing/strategy[?product_id=...|category=...]
 *   POST   /api/pricing/strategy/apply
 *   GET    /api/pricing/strategy/history[?product_id=...|category=...]
 */

const express  = require('express');
const router   = express.Router();
const db       = require('../db');
const { authenticate } = require('../middleware/auth');
const svc      = require('../services/pricing-strategy-service');

// Admin guard (admin only)
const adminOnly = [
  authenticate,
  (req, res, next) => {
    if (!['admin'].includes(req.user?.role)) {
      return res.status(403).json({ error: 'Reserved to admin' });
    }
    next();
  },
];

// ═══════════════════════════════════════════════════════════════════
// PRIX CONCURRENTS
// ═══════════════════════════════════════════════════════════════════

/** GET /competitors — lister prix concurrents */
router.get('/competitors', authenticate, async (req, res, next) => {
  try {
    const result = await svc.getCompetitors(db, {
      product_id: req.query.product_id,
      category:   req.query.category,
    });
    res.json(result);
  } catch (err) { next(err); }
});

/** POST /competitors — ajouter un prix concurrent */
router.post('/competitors', ...adminOnly, async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.competitor_name)                    return res.status(400).json({ error: 'competitor_name required' });
    if (!b.price_kmf || b.price_kmf <= 0)      return res.status(400).json({ error: 'price_kmf invalid' });
    if (!b.product_id && !b.category)          return res.status(400).json({ error: 'product_id or category required' });

    const row = await svc.addCompetitor(db, b);
    res.status(201).json(row);
  } catch (err) { next(err); }
});

/** DELETE /competitors/:id — soft delete */
router.delete('/competitors/:id', ...adminOnly, async (req, res, next) => {
  try {
    await svc.softDeleteCompetitor(db, req.params.id);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════════════
// STRATÉGIE COMPLÈTE (lecture)
// ═══════════════════════════════════════════════════════════════════

/** GET /strategy?product_id=xxx | ?category=yyy */
router.get('/strategy', authenticate, async (req, res, next) => {
  try {
    const { product_id, category } = req.query;
    if (!product_id && !category) {
      return res.status(400).json({ error: 'product_id or category required' });
    }

    const result = await svc.getStrategy(db, { product_id, category });
    res.json(result);
  } catch (err) {
    if (err.status === 404) return res.status(404).json({ error: err.message });
    next(err);
  }
});

// ═══════════════════════════════════════════════════════════════════
// APPLIQUER UNE STRATÉGIE
// ═══════════════════════════════════════════════════════════════════

/** POST /strategy/apply */
router.post('/strategy/apply', ...adminOnly, async (req, res, next) => {
  try {
    const b = req.body || {};
    const { product_id, category, strategy_type, final_price_kmf } = b;

    if (!product_id && !category)              return res.status(400).json({ error: 'product_id or category required' });
    if (!strategy_type)                        return res.status(400).json({ error: 'strategy_type required' });
    if (!final_price_kmf || final_price_kmf <= 0) return res.status(400).json({ error: 'final_price_kmf required' });

    const result = await svc.applyStrategy(db, b, req.user?.id || null);
    res.json(result);
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════════════
// HISTORIQUE DES STRATÉGIES
// ═══════════════════════════════════════════════════════════════════

/** GET /strategy/history?product_id=...|category=... */
router.get('/strategy/history', authenticate, async (req, res, next) => {
  try {
    const result = await svc.getStrategyHistory(db, {
      product_id: req.query.product_id,
      category:   req.query.category,
    });
    res.json(result);
  } catch (err) { next(err); }
});

module.exports = router;
