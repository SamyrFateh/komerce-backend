/**
 * KOMERCE — Routes pricing admin
 * POST /api/pricing/calculate  → calcul prix temps réel
 * POST /api/pricing/couture    → calcul prix tenue couture (tissu + confection)
 * GET  /api/pricing/rates      → taux actuels
 * PUT  /api/pricing/rates      → mettre à jour les taux (admin)
 */

const express  = require('express');
const router   = express.Router();
const db       = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const { calcPrix, calcPrixTenue } = require('../utils/pricing');

const adminOnly = [authenticate, requireRole(['admin'])];

const { getRates } = require('../utils/rates');

// POST /api/pricing/calculate
router.post('/calculate', async (req, res, next) => {
  try {
    const { product_id, qty=1, is_diaspora=false, relais_type='standard' } = req.body;
    if (!product_id) return res.status(400).json({ error: 'product_id requis' });

    const p = await db.query('SELECT * FROM products WHERE id=$1', [product_id]);
    if (!p.rows.length) return res.status(404).json({ error: 'Produit introuvable' });

    const prod   = p.rows[0];
    const rates  = await getRates();

    const result = calcPrix({
      prix_aed:   parseFloat(prod.price_aed || prod.price_kmf / rates.aed_kmf),
      category:   prod.category,
      source:     prod.source || 'S1',
      qty:        parseInt(qty),
      is_diaspora,
      relais_type,
      rates,
    });

    res.json(result);
  } catch(e) { next(e); }
});

// POST /api/pricing/couture
router.post('/couture', async (req, res, next) => {
  try {
    const { fabric_id, model_id, qty=1, is_diaspora=false } = req.body;
    if (!fabric_id || !model_id) return res.status(400).json({ error: 'fabric_id et model_id requis' });

    const [f, m] = await Promise.all([
      db.query('SELECT * FROM fabrics WHERE id=$1', [fabric_id]),
      db.query('SELECT * FROM garment_models WHERE id=$1', [model_id]),
    ]);
    if (!f.rows.length || !m.rows.length) return res.status(404).json({ error: 'Tissu ou modèle introuvable' });

    const rates  = await getRates();
    const result = calcPrixTenue({
      prix_tissu_aed:      parseFloat(f.rows[0].price_per_meter_aed),
      metrage:             parseFloat(m.rows[0].fabric_meters),
      cout_confection_aed: parseFloat(m.rows[0].making_cost_aed),
      qty: parseInt(qty),
      is_diaspora,
      rates,
    });

    res.json({ ...result, fabric: f.rows[0].name, model: m.rows[0].name });
  } catch(e) { next(e); }
});

// GET /api/pricing/rates
// Lit la source de vérité (finance_config). exchange_rates devient passif (historique).
router.get('/rates', async (req, res, next) => {
  try {
    const { rows } = await db.query(
      'SELECT taux_change_eur_kmf, taux_aed_kmf FROM finance_config WHERE id = 1'
    );
    const fc = rows[0];
    // Historique pour info (audit)
    const { rows: history } = await db.query(
      'SELECT eur_kmf, aed_kmf, valid_from FROM exchange_rates ORDER BY valid_from DESC LIMIT 5'
    );
    res.json({
      current: {
        eur_kmf: Number(fc?.taux_change_eur_kmf) || 492,
        aed_kmf: Number(fc?.taux_aed_kmf) || 138,
      },
      history,
    });
  } catch(e) { next(e); }
});

// PUT /api/pricing/rates — admin
// Écrit dans finance_config + log dans exchange_rates pour audit.
router.put('/rates', ...adminOnly, async (req, res, next) => {
  const client = await db.pool.connect();
  try {
    const { eur_kmf, aed_kmf } = req.body;
    if (!eur_kmf || !aed_kmf) return res.status(400).json({ error: 'eur_kmf et aed_kmf requis' });

    await client.query('BEGIN');

    // 1. Update finance_config (source de vérité)
    await client.query(
      `UPDATE finance_config
          SET taux_change_eur_kmf = $1,
              taux_aed_kmf = $2,
              updated_at = NOW(),
              updated_by = $3
        WHERE id = 1`,
      [eur_kmf, aed_kmf, req.user?.id || null]
    );

    // 2. Log dans exchange_rates pour historique/audit
    await client.query(
      'INSERT INTO exchange_rates (eur_kmf, aed_kmf, valid_from) VALUES ($1, $2, CURRENT_DATE)',
      [eur_kmf, aed_kmf]
    );

    await client.query('COMMIT');

    // 3. Invalider le cache global
    try {
      const { invalidateCache } = require('../utils/rates');
      invalidateCache();
    } catch(_) {}

    res.json({
      message: 'Taux mis à jour dans finance_config + log historique',
      rate: { eur_kmf, aed_kmf },
    });
  } catch(e) {
    await client.query('ROLLBACK').catch(()=>{});
    next(e);
  } finally {
    client.release();
  }
});

module.exports = router;
