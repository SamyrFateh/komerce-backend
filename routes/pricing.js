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
 *        services/pricing-engine.js, docs/adr/ADR-011-pricing-extensible-3-niveaux.md
 */

const express  = require('express');
const router   = express.Router();
const db       = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');

const adminOnly = [authenticate, requireRole(['admin'])];

const { getRates }             = require('../utils/rates');
const pricingEngine            = require('../services/pricing-engine');
const pricingRecommend         = require('../services/pricing-recommend');
const pricingDashboard         = require('../services/pricing-dashboard');

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
router.get('/rates', async (req, res, next) => {
  try {
    const { rows } = await db.query(
      'SELECT taux_change_eur_kmf, taux_aed_kmf FROM finance_config WHERE id = 1'
    );
    const fc = rows[0];
    const { rows: history } = await db.query(
      'SELECT eur_kmf, aed_kmf, valid_from FROM exchange_rates ORDER BY valid_from DESC LIMIT 5'
    );
    res.json({
      current: { eur_kmf: Number(fc?.taux_change_eur_kmf) || 492, aed_kmf: Number(fc?.taux_aed_kmf) || 138 },
      history,
    });
  } catch (e) { next(e); }
});

// ═══════════════════════════════════════════════════════════════════
// PUT /api/pricing/rates — mise à jour taux (admin)
// ═══════════════════════════════════════════════════════════════════
router.put('/rates', ...adminOnly, async (req, res, next) => {
  const client = await db.getClient();
  try {
    const { eur_kmf, aed_kmf } = req.body;
    if (!eur_kmf || !aed_kmf) return res.status(400).json({ error: 'eur_kmf et aed_kmf requis' });

    await client.query('BEGIN');
    await client.query(
      `UPDATE finance_config
          SET taux_change_eur_kmf = $1, taux_aed_kmf = $2,
              updated_at = NOW(), updated_by = $3
        WHERE id = 1`,
      [eur_kmf, aed_kmf, req.user?.id || null]
    );
    await client.query(
      'INSERT INTO exchange_rates (eur_kmf, aed_kmf, valid_from) VALUES ($1, $2, CURRENT_DATE)',
      [eur_kmf, aed_kmf]
    );
    await client.query('COMMIT');

    try { const { invalidateCache } = require('../utils/rates'); invalidateCache(); } catch (_) {}

    res.json({ message: 'Taux mis à jour dans finance_config + log historique', rate: { eur_kmf, aed_kmf } });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    next(e);
  } finally { client.release(); }
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
    const { price_kmf, source, scenario_id, scenario_label, levier, survival_price_kmf } = req.body;

    if (!price_kmf || price_kmf <= 0) return res.status(400).json({ error: 'price_kmf invalide' });

    const { rows: [product] } = await db.query(
      'SELECT id, name, price_kmf FROM products WHERE id = $1', [product_id]
    );
    if (!product) return res.status(404).json({ error: 'Produit introuvable' });

    if (survival_price_kmf && price_kmf < Number(survival_price_kmf)) {
      return res.status(400).json({
        error: 'Prix sous le seuil de survie : refusé par doctrine.',
        code: 'below_survival',
        survival_price_kmf: Number(survival_price_kmf),
        attempted_price_kmf: price_kmf,
      });
    }

    const oldPrice = Number(product.price_kmf) || 0;
    const { rows: [updated] } = await db.query(
      `UPDATE products SET price_kmf = $1, updated_at = NOW() WHERE id = $2 RETURNING id, name, price_kmf`,
      [price_kmf, product_id]
    );

    // Audit price_history (colonnes scenario_* optionnelles — fallback gracieux)
    try {
      await db.query(
        `INSERT INTO price_history
           (product_id, old_price_kmf, new_price_kmf, source, applied_by, applied_at, scenario_id, scenario_label, levier)
         VALUES ($1, $2, $3, $4, $5, NOW(), $6, $7, $8)`,
        [product_id, oldPrice, price_kmf, source || 'manual', req.user?.id || null, scenario_id || null, scenario_label || null, levier || null]
      );
    } catch (_) {
      try {
        await db.query(
          `INSERT INTO price_history (product_id, old_price_kmf, new_price_kmf, source, applied_by, applied_at)
           VALUES ($1, $2, $3, $4, $5, NOW())`,
          [product_id, oldPrice, price_kmf, source || 'manual', req.user?.id || null]
        );
      } catch (_) { /* table optionnelle */ }
    }

    res.json({ ok: true, product: updated, old_price_kmf: oldPrice, new_price_kmf: price_kmf, scenario_id: scenario_id || null, levier: levier || null });
  } catch (e) { next(e); }
});

// ═══════════════════════════════════════════════════════════════════
// PUT /api/pricing/apply-all — application en masse (admin)
// ═══════════════════════════════════════════════════════════════════
router.put('/apply-all', ...adminOnly, async (req, res, next) => {
  const client = await db.getClient();
  try {
    const items = req.body?.items || [];
    if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'items array requis' });
    if (items.length > 500) return res.status(400).json({ error: 'max 500 items par batch' });

    await client.query('BEGIN');
    const applied = [];
    for (const it of items) {
      if (!it.product_id || !it.price_kmf || it.price_kmf <= 0) continue;
      const { rows: [updated] } = await client.query(
        `UPDATE products SET price_kmf = $1, updated_at = NOW()
          WHERE id = $2 RETURNING id, name, price_kmf`,
        [it.price_kmf, it.product_id]
      );
      if (updated) applied.push(updated);
    }
    await client.query('COMMIT');
    res.json({ ok: true, count: applied.length, products: applied });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    next(e);
  } finally { client.release(); }
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
