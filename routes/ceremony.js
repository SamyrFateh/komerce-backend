/**
 * KOMERCE — Tissus & Tenues Cérémonie M11
 * GET  /api/ceremony/fabrics         → catalogue tissus
 * GET  /api/ceremony/models          → catalogue modèles tenues
 * POST /api/ceremony/price           → calcul prix tenue
 * POST /api/ceremony/fabrics         → ajouter tissu (admin)
 * POST /api/ceremony/models          → ajouter modèle (admin)
 */

const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const { calcPrixTenue } = require('../utils/pricing');

async function getRates() {
  const { rows } = await db.query('SELECT eur_kmf, aed_kmf FROM exchange_rates ORDER BY valid_from DESC LIMIT 1');
  return rows[0] || { eur_kmf: 492, aed_kmf: 138 };
}

// GET /api/ceremony/fabrics
router.get('/fabrics', async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM fabrics WHERE active=TRUE ORDER BY name');
    res.json(rows);
  } catch(e) { res.status(500).json({ error: 'Erreur serveur' }); }
});

// GET /api/ceremony/models
router.get('/models', async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM garment_models WHERE active=TRUE ORDER BY name');
    res.json(rows);
  } catch(e) { res.status(500).json({ error: 'Erreur serveur' }); }
});

// POST /api/ceremony/price — calcul prix tenue
router.post('/price', async (req, res) => {
  try {
    const { fabric_id, model_id, qty=1, is_diaspora=false } = req.body;
    if (!fabric_id || !model_id) return res.status(400).json({ error: 'fabric_id et model_id requis' });

    const [fabric, model] = await Promise.all([
      db.query('SELECT * FROM fabrics WHERE id=$1', [fabric_id]),
      db.query('SELECT * FROM garment_models WHERE id=$1', [model_id]),
    ]);
    if (!fabric.rows.length || !model.rows.length) return res.status(404).json({ error: 'Tissu ou modèle introuvable' });

    const rates = await getRates();
    const f = fabric.rows[0];
    const m = model.rows[0];

    const result = calcPrixTenue({
      prix_tissu_aed:      parseFloat(f.price_per_meter_aed),
      metrage:             parseFloat(m.fabric_meters),
      cout_confection_aed: parseFloat(m.making_cost_aed),
      qty: parseInt(qty),
      is_diaspora,
      rates,
    });

    res.json({
      ...result,
      tenue: {
        fabric_name:    f.name,
        model_name:     m.name,
        metrage_par_tenue: m.fabric_meters,
        confection_aed: m.making_cost_aed,
        qty,
      },
    });
  } catch(e) { console.error(e); res.status(500).json({ error: 'Erreur calcul prix tenue' }); }
});

// POST /api/ceremony/fabrics — admin
router.post('/fabrics', authenticate, requireRole(['admin']), async (req, res) => {
  try {
    const { name, material, price_per_meter_aed, colors=[], occasions=[], image_url } = req.body;
    if (!name || !price_per_meter_aed) return res.status(400).json({ error: 'name et price_per_meter_aed requis' });
    const { rows } = await db.query(
      'INSERT INTO fabrics (name,material,price_per_meter_aed,colors,occasions,image_url) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [name, material, price_per_meter_aed, colors, occasions, image_url]
    );
    res.status(201).json(rows[0]);
  } catch(e) { console.error(e); res.status(500).json({ error: 'Erreur création tissu' }); }
});

// POST /api/ceremony/models — admin
router.post('/models', authenticate, requireRole(['admin']), async (req, res) => {
  try {
    const { name, making_cost_aed, fabric_meters, occasions=[], sizes_available=['S','M','L','XL','XXL'], image_url } = req.body;
    if (!name || !making_cost_aed || !fabric_meters) return res.status(400).json({ error: 'name, making_cost_aed et fabric_meters requis' });
    const { rows } = await db.query(
      'INSERT INTO garment_models (name,making_cost_aed,fabric_meters,occasions,sizes_available,image_url) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [name, making_cost_aed, fabric_meters, occasions, sizes_available, image_url]
    );
    res.status(201).json(rows[0]);
  } catch(e) { console.error(e); res.status(500).json({ error: 'Erreur création modèle' }); }
});

module.exports = router;
