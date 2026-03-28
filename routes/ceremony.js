/**
 * KOMERCE — Tissus & Tenues Cérémonie M11 v7.2
 *
 * GET  /api/ceremony/fabrics       → catalogue tissus (filtres v7.2)
 * GET  /api/ceremony/models        → catalogue modèles tenues
 * POST /api/ceremony/price         → calcul prix tenue (fabric_only / custom_from_fabric)
 * POST /api/ceremony/fabrics       → ajouter tissu (admin) — colonnes v7.2
 * POST /api/ceremony/models        → ajouter modèle (admin)
 *
 * Corrections v7.2 :
 *   · GET /fabrics : filtre sur is_available (v7.2) + fallback sur active
 *                    tri par sort_order puis name
 *                    expose fabric_type, price_per_meter_kmf, stock_meters
 *   · POST /fabrics : insère fabric_type + price_per_meter_kmf calculé auto
 *   · POST /price   : supporte ready_made (produit fixe) + fabric_only / custom
 */

'use strict';

const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const { calcPrixTenue } = require('../utils/pricing');

// Taux de change courant
async function getRates() {
  const { rows } = await db.query(
    'SELECT eur_kmf, aed_kmf FROM exchange_rates ORDER BY valid_from DESC LIMIT 1'
  );
  return rows[0] || { eur_kmf: 492, aed_kmf: 138 };
}

// ─── GET /api/ceremony/fabrics ───────────────────────────────────────────────
// Filtres optionnels : ?fabric_type=Wax&available=true

router.get('/fabrics', async (req, res) => {
  try {
    const { fabric_type } = req.query;

    const conditions = [];
    const params     = [];
    let   pi         = 1;

    // Priorité à is_available (v7.2), fallback sur active (schema initial)
    conditions.push(`(
      CASE WHEN f.is_available IS NOT NULL THEN f.is_available = TRUE
           ELSE f.active = TRUE
      END
    )`);

    if (fabric_type) {
      conditions.push(`f.fabric_type = $${pi++}`);
      params.push(fabric_type);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const { rows } = await db.query(
      `SELECT
         f.id, f.name, f.material,
         f.fabric_type,
         f.price_per_meter_aed,
         f.price_per_meter_kmf,
         f.price_per_yard_kmf,
         f.min_order_meters,
         f.stock_meters,
         f.colors, f.occasions,
         f.image_url,
         f.is_available,
         f.sort_order
       FROM fabrics f
       ${where}
       ORDER BY
         COALESCE(f.sort_order, 999) ASC,
         f.name ASC`,
      params
    );

    res.json(rows);
  } catch (e) {
    console.error('GET /fabrics error:', e.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ─── GET /api/ceremony/models ────────────────────────────────────────────────

router.get('/models', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT
         id, name, making_cost_aed, fabric_meters,
         occasions, sizes_available, image_url
       FROM garment_models
       WHERE active = TRUE
       ORDER BY name ASC`
    );
    res.json(rows);
  } catch (e) {
    console.error('GET /models error:', e.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ─── POST /api/ceremony/price ────────────────────────────────────────────────
// Supporte les 3 types de commandes cérémonie :
//   ready_made          → prix du produit fixe (product_id requis)
//   fabric_only         → prix tissu × quantité + accessoires
//   custom_from_fabric  → prix tissu + confection (fabric_id + model_id)

router.post('/price', async (req, res) => {
  try {
    const {
      ceremony_order_type,
      fabric_id,
      model_id,
      product_id,
      qty          = 1,
      qty_meters,
      is_diaspora  = false,
      accessories  = [],
    } = req.body;

    if (!ceremony_order_type) {
      return res.status(400).json({ error: 'ceremony_order_type requis' });
    }

    const rates = await getRates();

    // ── ready_made : prix produit fixe ──────────────────────────────────────
    if (ceremony_order_type === 'ready_made') {
      if (!product_id) return res.status(400).json({ error: 'product_id requis pour ready_made' });

      const { rows: [product] } = await db.query(
        'SELECT id, name, price_kmf, price_eur FROM products WHERE id = $1 AND is_active = TRUE',
        [product_id]
      );
      if (!product) return res.status(404).json({ error: 'Produit introuvable' });

      const total_kmf = product.price_kmf * qty;
      return res.json({
        ceremony_order_type,
        unit_price_kmf: product.price_kmf,
        total_kmf,
        total_eur: parseFloat((total_kmf / rates.eur_kmf).toFixed(2)),
        qty,
        detail: { product_name: product.name },
      });
    }

    // ── fabric_only : tissu × mètres + accessoires ──────────────────────────
    if (ceremony_order_type === 'fabric_only') {
      if (!fabric_id) return res.status(400).json({ error: 'fabric_id requis pour fabric_only' });
      if (!qty_meters) return res.status(400).json({ error: 'qty_meters requis pour fabric_only' });

      const { rows: [fabric] } = await db.query(
        'SELECT * FROM fabrics WHERE id = $1', [fabric_id]
      );
      if (!fabric) return res.status(404).json({ error: 'Tissu introuvable' });

      // Prix au mètre en KMF (v7.2) ou calcul depuis AED
      const price_kmf_per_m = fabric.price_per_meter_kmf
        || Math.round(parseFloat(fabric.price_per_meter_aed) * rates.aed_kmf);

      const tissu_kmf      = price_kmf_per_m * parseFloat(qty_meters);
      // Forfait accessoires (10% du prix tissu par accessoire sélectionné)
      const acc_kmf        = accessories.length * tissu_kmf * 0.10;
      const total_kmf      = Math.round(tissu_kmf + acc_kmf);

      return res.json({
        ceremony_order_type,
        price_per_meter_kmf: price_kmf_per_m,
        qty_meters: parseFloat(qty_meters),
        tissu_kmf: Math.round(tissu_kmf),
        accessories_kmf: Math.round(acc_kmf),
        total_kmf,
        total_eur: parseFloat((total_kmf / rates.eur_kmf).toFixed(2)),
        accessories,
        detail: { fabric_name: fabric.name, fabric_type: fabric.fabric_type },
      });
    }

    // ── custom_from_fabric : tissu + confection ──────────────────────────────
    if (ceremony_order_type === 'custom_from_fabric') {
      if (!fabric_id) return res.status(400).json({ error: 'fabric_id requis pour custom_from_fabric' });
      if (!model_id)  return res.status(400).json({ error: 'model_id requis pour custom_from_fabric' });

      const [fabricRes, modelRes] = await Promise.all([
        db.query('SELECT * FROM fabrics WHERE id = $1', [fabric_id]),
        db.query('SELECT * FROM garment_models WHERE id = $1', [model_id]),
      ]);

      const fabric = fabricRes.rows[0];
      const model  = modelRes.rows[0];
      if (!fabric) return res.status(404).json({ error: 'Tissu introuvable' });
      if (!model)  return res.status(404).json({ error: 'Modèle introuvable' });

      const result = calcPrixTenue({
        prix_tissu_aed:      parseFloat(fabric.price_per_meter_aed),
        metrage:             parseFloat(model.fabric_meters),
        cout_confection_aed: parseFloat(model.making_cost_aed),
        qty:                 parseInt(qty),
        is_diaspora,
        rates,
      });

      return res.json({
        ceremony_order_type,
        ...result,
        detail: {
          fabric_name:        fabric.name,
          fabric_type:        fabric.fabric_type,
          model_name:         model.name,
          metrage_par_tenue:  model.fabric_meters,
          confection_aed:     model.making_cost_aed,
          qty,
        },
      });
    }

    return res.status(400).json({ error: 'ceremony_order_type invalide — valeurs : ready_made | fabric_only | custom_from_fabric' });

  } catch (e) {
    console.error('POST /price error:', e.message);
    res.status(500).json({ error: 'Erreur calcul prix tenue' });
  }
});

// ─── POST /api/ceremony/fabrics (admin) ──────────────────────────────────────
// Colonnes v7.2 : fabric_type, price_per_meter_kmf auto-calculé

router.post('/fabrics', authenticate, requireRole(['admin']), async (req, res) => {
  try {
    const {
      name,
      material,
      price_per_meter_aed,
      fabric_type,
      min_order_meters = 1.0,
      stock_meters,
      colors           = [],
      occasions        = [],
      image_url,
      sort_order       = 0,
    } = req.body;

    if (!name)                return res.status(400).json({ error: 'name requis' });
    if (!price_per_meter_aed) return res.status(400).json({ error: 'price_per_meter_aed requis' });

    // Calculer price_per_meter_kmf depuis le taux courant
    const rates = await getRates();
    const price_per_meter_kmf = Math.round(
      parseFloat(price_per_meter_aed) * rates.aed_kmf
    );
    const price_per_yard_kmf = Math.round(price_per_meter_kmf * 0.9144);

    const { rows: [fabric] } = await db.query(
      `INSERT INTO fabrics (
         name, material, price_per_meter_aed,
         fabric_type, price_per_meter_kmf, price_per_yard_kmf,
         min_order_meters, stock_meters,
         colors, occasions, image_url,
         is_available, sort_order, active
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,TRUE,$12,TRUE)
       RETURNING *`,
      [
        name, material || null, parseFloat(price_per_meter_aed),
        fabric_type || null, price_per_meter_kmf, price_per_yard_kmf,
        min_order_meters, stock_meters || null,
        colors, occasions, image_url || null,
        sort_order,
      ]
    );

    res.status(201).json(fabric);
  } catch (e) {
    console.error('POST /fabrics error:', e.message);
    res.status(500).json({ error: 'Erreur création tissu' });
  }
});

// ─── POST /api/ceremony/models (admin) ───────────────────────────────────────

router.post('/models', authenticate, requireRole(['admin']), async (req, res) => {
  try {
    const {
      name,
      making_cost_aed,
      fabric_meters,
      occasions        = [],
      sizes_available  = ['S','M','L','XL','XXL'],
      image_url,
    } = req.body;

    if (!name || !making_cost_aed || !fabric_meters) {
      return res.status(400).json({ error: 'name, making_cost_aed et fabric_meters requis' });
    }

    const { rows: [model] } = await db.query(
      `INSERT INTO garment_models
         (name, making_cost_aed, fabric_meters, occasions, sizes_available, image_url)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING *`,
      [name, making_cost_aed, fabric_meters, occasions, sizes_available, image_url || null]
    );

    res.status(201).json(model);
  } catch (e) {
    console.error('POST /models error:', e.message);
    res.status(500).json({ error: 'Erreur création modèle' });
  }
});

module.exports = router;
