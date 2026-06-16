/**
 * @komerce-arch
 * @role          economic-engine-pricing
 * @domain        economic-engine
 * @layer         route
 * @criticality   high
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db.js, middleware/auth.js, services/*
 * @used-by       bootstrap/api-routes.js
 * @db-read       cost_benchmarks, fabrics, garment_models, products
 * @db-write      cost_benchmarks
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  economic-engine
 * @version       2026-06
 */

'use strict';

/**
 * KOMERCE — Routes pricing admin
 *
 * POST /api/pricing/calculate        → calcul prix temps réel
 * POST /api/pricing/couture          → calcul prix tenue couture
 * GET  /api/pricing/rates            → taux actuels
 * PUT  /api/pricing/rates            → mettre à jour les taux (admin)
 * POST /api/pricing/recommend        → prix recommandé 3 niveaux (ADR-011)
 * POST /api/pricing/recommend-batch  → batch produits actifs
 * PUT  /api/pricing/apply-price/:id  → appliquer un prix (admin)
 * PUT  /api/pricing/apply-all        → appliquer en masse (admin)
 * GET  /api/pricing/benchmarks       → liste benchmarks sectoriels
 * GET  /api/pricing/benchmarks-gap   → gap benchmark vs config actuelle
 * GET  /api/pricing/dashboard        → vue de pilotage pricing
 *
 * Doctrine : Invariant I-08 — aucun coefficient dur dans les calculs.
 * Voir : services/pricing-recommend.js, services/pricing-dashboard.js,
 *        services/pricing-engine.js, services/pricing-rates.js,
 *        services/pricing-apply.js, services/pricing-guards.js,
 *        docs/adr/ADR-011-pricing-extensible-3-niveaux.md
 *
 * REFACTO-R1 : route = auth + validation + appel service + réponse.
 * Logique métier déplacée vers services/pricing-rates.js (rates) et
 * services/pricing-apply.js (apply-price / apply-all).
 */

const express  = require('express');
const router   = express.Router();
const db       = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');

const adminOnly = [authenticate, requireRole(['admin'])];

const pricingEngine            = require('../services/pricing-engine');
const pricingRecommend         = require('../services/pricing-recommend');
const pricingDashboard         = require('../services/pricing-dashboard');
const pricingRates             = require('../services/pricing-rates');
const pricingApply             = require('../services/pricing-apply');

// ─── Helper : erreurs HTTP depuis les services ─────────────────────────────
function handleServiceError(err, res, next) {
  if (err.status) return res.status(err.status).json(err.body || { error: err.message });
  next(err);
}

// ═══════════════════════════════════════════════════════════════════
// POST /api/pricing/calculate — calcul prix temps réel
// ═══════════════════════════════════════════════════════════════════
router.post('/calculate', async (req, res, next) => {
  try {
    const { product_id, qty = 1, is_diaspora = false, relais_type = 'standard' } = req.body;
    if (!product_id) return res.status(400).json({ error: 'product_id requis' });

    const p = await db.query('SELECT * FROM products WHERE id=$1', [product_id]);
    if (!p.rows.length) return res.status(404).json({ error: 'Produit introuvable' });

    const channel = is_diaspora ? 'diaspora' : 'cash_relais';
    const result  = await pricingEngine.recommend({
      product_id, qty: parseInt(qty), channel, relais_type,
    });
    res.json(result);
  } catch (e) { next(e); }
});

// ═══════════════════════════════════════════════════════════════════
// POST /api/pricing/flow — chaîne doctrinale brute (dashboard boîtes & flèches)
//   Renvoie directement la sortie de pricing-engine.recommend() : contrat
//   doctrinal complet (N1/N2/N3, frontières, contribution, scénarios). Accepte
//   un input libre pour l'impact live (override d'un coût et recalcul propagé).
//   Body : { product_id?, category?, cost_kmf?, weight_kg?, volume_m3?,
//            current_price_kmf?, channel?, pricing_strategy?, final_price_kmf? }
// ═══════════════════════════════════════════════════════════════════
router.post('/flow', adminOnly, async (req, res, next) => {
  try {
    res.json(await pricingEngine.recommend(req.body || {}));
  } catch (e) { handleServiceError(e, res, next); }
});

// ═══════════════════════════════════════════════════════════════════
// Benchmarks de surcharge par famille (calibration §6)
//   GET  /api/pricing/benchmarks            → liste
//   PUT  /api/pricing/benchmarks            → upsert { category, cost_family,
//                                              expected_share_pct, warn_ratio?, alert_ratio? }
//   DELETE /api/pricing/benchmarks/:category/:cost_family
// ═══════════════════════════════════════════════════════════════════
router.get('/benchmarks', authenticate, async (req, res, next) => {
  try {
    const { rows } = await db.query(
      'SELECT category, cost_family, expected_share_pct, warn_ratio, alert_ratio, is_active, updated_at FROM cost_benchmarks ORDER BY category, cost_family'
    );
    res.json({ items: rows });
  } catch (e) { handleServiceError(e, res, next); }
});

router.put('/benchmarks', adminOnly, async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.cost_family || b.expected_share_pct == null) {
      return res.status(400).json({ error: 'cost_family et expected_share_pct requis' });
    }
    const { rows } = await db.query(
      `INSERT INTO cost_benchmarks (category, cost_family, expected_share_pct, warn_ratio, alert_ratio, is_active, updated_at)
       VALUES ($1, $2, $3, $4, $5, TRUE, NOW())
       ON CONFLICT (category, cost_family) DO UPDATE SET
         expected_share_pct = EXCLUDED.expected_share_pct,
         warn_ratio = EXCLUDED.warn_ratio,
         alert_ratio = EXCLUDED.alert_ratio,
         is_active = TRUE, updated_at = NOW()
       RETURNING category, cost_family, expected_share_pct, warn_ratio, alert_ratio`,
      [b.category || 'all', b.cost_family, Number(b.expected_share_pct),
       Number(b.warn_ratio) || 1.3, Number(b.alert_ratio) || 1.6]
    );
    res.json(rows[0]);
  } catch (e) { handleServiceError(e, res, next); }
});

router.delete('/benchmarks/:category/:cost_family', adminOnly, async (req, res, next) => {
  try {
    await db.query('DELETE FROM cost_benchmarks WHERE category = $1 AND cost_family = $2',
      [req.params.category, req.params.cost_family]);
    res.json({ deleted: true });
  } catch (e) { handleServiceError(e, res, next); }
});

// ═══════════════════════════════════════════════════════════════════
// POST /api/pricing/couture — calcul prix tenue couture
// ═══════════════════════════════════════════════════════════════════
router.post('/couture', async (req, res, next) => {
  try {
    const { fabric_id, model_id, qty = 1, is_diaspora = false } = req.body;
    if (!fabric_id || !model_id) return res.status(400).json({ error: 'fabric_id et model_id requis' });

    const [f, m] = await Promise.all([
      db.query('SELECT * FROM fabrics          WHERE id=$1', [fabric_id]),
      db.query('SELECT * FROM garment_models   WHERE id=$1', [model_id]),
    ]);
    if (!f.rows.length || !m.rows.length) return res.status(404).json({ error: 'Tissu ou modèle introuvable' });

    const fabric       = f.rows[0];
    const model        = m.rows[0];
    const channel      = is_diaspora ? 'diaspora' : 'cash_relais';
    const prixAchatAed = parseFloat(fabric.price_per_meter_aed) * parseFloat(model.fabric_meters)
      + parseFloat(model.making_cost_aed);

    const result = await pricingEngine.recommend({
      virtual: true, price_aed: prixAchatAed,
      category: 'couture', qty: parseInt(qty), channel,
    });
    res.json({
      ...result,
      fabric: fabric.name,
      model:  model.name,
      detail: {
        fabric_name:       fabric.name,
        model_name:        model.name,
        metrage_par_tenue: model.fabric_meters,
        confection_aed:    model.making_cost_aed,
        prix_tissu_aed:    fabric.price_per_meter_aed,
        prix_achat_aed:    prixAchatAed,
        qty,
      },
    });
  } catch (e) { next(e); }
});

// ═══════════════════════════════════════════════════════════════════
// GET /api/pricing/rates — taux actuels
// ═══════════════════════════════════════════════════════════════════
router.get('/rates', authenticate, async (req, res, next) => {
  try {
    res.json(await pricingRates.getCurrentRates());
  } catch (e) { next(e); }
});

// ═══════════════════════════════════════════════════════════════════
// PUT /api/pricing/rates — mise à jour taux (admin)
// ═══════════════════════════════════════════════════════════════════
router.put('/rates', ...adminOnly, async (req, res, next) => {
  try {
    const { eur_kmf, aed_kmf } = req.body;
    if (!eur_kmf || !aed_kmf) return res.status(400).json({ error: 'eur_kmf et aed_kmf requis' });

    res.json(await pricingRates.updateRates({ eur_kmf, aed_kmf }, req.user?.id));
  } catch (e) { next(e); }
});

// ═══════════════════════════════════════════════════════════════════
// POST /api/pricing/recommend — prix recommandé ADR-011 (3 niveaux)
// ═══════════════════════════════════════════════════════════════════
router.post('/recommend', authenticate, async (req, res, next) => {
  try {
    res.json(await pricingRecommend.computeRecommend(req.body));
  } catch (e) { handleServiceError(e, res, next); }
});

// ═══════════════════════════════════════════════════════════════════
// POST /api/pricing/recommend-batch — batch tous les produits actifs
// ═══════════════════════════════════════════════════════════════════
router.post('/recommend-batch', authenticate, async (req, res, next) => {
  try {
    res.json(await pricingRecommend.computeRecommendBatch(req.body));
  } catch (e) { handleServiceError(e, res, next); }
});

// ═══════════════════════════════════════════════════════════════════
// PUT /api/pricing/apply-price/:product_id — appliquer un prix (admin)
// ═══════════════════════════════════════════════════════════════════
router.put('/apply-price/:product_id', ...adminOnly, async (req, res, next) => {
  try {
    const { product_id } = req.params;
    const result = await pricingApply.applyPrice(product_id, req.body, req.user?.id);
    res.status(result.status).json(result.body);
  } catch (e) { next(e); }
});

// ═══════════════════════════════════════════════════════════════════
// PUT /api/pricing/apply-all — application en masse (admin)
// ═══════════════════════════════════════════════════════════════════
router.put('/apply-all', ...adminOnly, async (req, res, next) => {
  try {
    const items = req.body?.items || [];
    const result = await pricingApply.applyAll(items);
    res.status(result.status).json(result.body);
  } catch (e) { next(e); }
});

// ═══════════════════════════════════════════════════════════════════
// GET /api/pricing/benchmarks — benchmarks sectoriels
// ═══════════════════════════════════════════════════════════════════
router.get('/benchmarks', authenticate, async (req, res, next) => {
  try {
    res.json(await pricingDashboard.listBenchmarks(req.query));
  } catch (e) {
    if (e.code === '42P01') {
      return res.json({ count: 0, benchmarks: [], warning: 'Table pricing_benchmarks absente — migration 039 requise' });
    }
    next(e);
  }
});

// ═══════════════════════════════════════════════════════════════════
// GET /api/pricing/benchmarks-gap — gap benchmark vs config actuelle
// ═══════════════════════════════════════════════════════════════════
router.get('/benchmarks-gap', authenticate, async (req, res, next) => {
  try {
    res.json(await pricingDashboard.computeBenchmarksGap(req.query));
  } catch (e) { next(e); }
});

// ═══════════════════════════════════════════════════════════════════
// GET /api/pricing/dashboard — vue de pilotage pricing
// ═══════════════════════════════════════════════════════════════════
router.get('/dashboard', authenticate, async (req, res, next) => {
  try {
    res.json(await pricingDashboard.computeDashboard());
  } catch (e) { next(e); }
});

module.exports = router;

