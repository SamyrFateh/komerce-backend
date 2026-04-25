/**
 * KOMERCE — Customs Shipments Management
 *
 * Gestion des envois Dubai→Comores et ventilation de la douane sur les colis.
 *
 * ENDPOINTS:
 *   GET    /api/admin/customs-shipments           → liste (filtres: from, to, active)
 *   POST   /api/admin/customs-shipments           → créer un envoi + ventilation
 *   GET    /api/admin/customs-shipments/:id       → détail + colis ventilés
 *   PATCH  /api/admin/customs-shipments/:id       → update (metadata + notes)
 *   POST   /api/admin/customs-shipments/:id/deactivate → désactive + retire parts colis
 *   POST   /api/admin/customs-shipments/:id/activate   → réactive + recalcule parts
 *   GET    /api/admin/customs-shipments/rates/effective → taux terrain 30/90/365j
 *
 * MÉTHODES DE VENTILATION:
 *   by_cif_value  — part = total × (valeur_colis / Σ valeurs_colis)
 *   by_weight     — part = total × (poids_colis / Σ poids_colis)
 *   by_volume     — part = total × (volume_colis / Σ volumes_colis)
 *   mixed         — combine CIF et poids via allocation_config {"cif":0.7,"weight":0.3}
 *   manual        — pas de ventilation auto, saisie ligne par ligne
 */

'use strict';

const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');

const guard = [authenticate, requireRole(['admin'])];

// ══════════════════════════════════════════════════════════
// Helpers : ventilation (allocation)
// ══════════════════════════════════════════════════════════

/**
 * Calcule la part de douane de chaque colis d'un envoi selon la méthode choisie.
 * @param {Object} shipment  - { customs_paid_kmf, allocation_method, allocation_config }
 * @param {Array}  parcels   - [{ parcel_id, cif_kmf, weight_kg, volume_m3? }]
 * @returns Array<{parcel_id, cif_kmf, weight_kg, share_kmf, basis}>
 */
function allocateCustoms(shipment, parcels) {
  const total = Number(shipment.customs_paid_kmf) || 0;
  const method = shipment.allocation_method || 'by_cif_value';
  const cfg = shipment.allocation_config || {};

  if (!parcels.length || total === 0) return [];

  // manual : pas de calcul, on renvoie 0 partout (l'admin saisira à la main)
  if (method === 'manual') {
    return parcels.map(p => ({
      ...p,
      customs_share_kmf: 0,
      allocation_basis: 'manual',
    }));
  }

  // Calcul des poids relatifs
  function pickMetric(p, metric) {
    if (metric === 'by_cif_value') return Number(p.cif_kmf) || 0;
    if (metric === 'by_weight')    return Number(p.weight_kg) || 0;
    if (metric === 'by_volume')    return Number(p.volume_m3) || 0;
    return 0;
  }

  let weights;
  if (method === 'mixed') {
    const cifW = Number(cfg.cif)    || 0.5;
    const wgtW = Number(cfg.weight) || 0.5;
    const cifSum = parcels.reduce((s, p) => s + pickMetric(p, 'by_cif_value'), 0);
    const wgtSum = parcels.reduce((s, p) => s + pickMetric(p, 'by_weight'), 0);
    weights = parcels.map(p => {
      const cifPart = cifSum > 0 ? pickMetric(p, 'by_cif_value') / cifSum : 0;
      const wgtPart = wgtSum > 0 ? pickMetric(p, 'by_weight')    / wgtSum : 0;
      return cifPart * cifW + wgtPart * wgtW;
    });
  } else {
    const values = parcels.map(p => pickMetric(p, method));
    const sum = values.reduce((s, v) => s + v, 0);
    weights = sum > 0 ? values.map(v => v / sum) : parcels.map(() => 1 / parcels.length);
  }

  return parcels.map((p, i) => ({
    ...p,
    customs_share_kmf: Math.round((total * weights[i]) * 100) / 100,
    allocation_basis: method,
  }));
}

// ══════════════════════════════════════════════════════════
// GET /api/admin/customs-shipments
// ══════════════════════════════════════════════════════════
router.get('/', ...guard, async (req, res, next) => {
  try {
    const { from, to, active } = req.query;
    const conds = ['1=1'];
    const params = [];
    let pi = 1;

    if (from)   { conds.push(`shipment_date >= $${pi++}`); params.push(from); }
    if (to)     { conds.push(`shipment_date <= $${pi++}`); params.push(to); }
    if (active !== undefined) {
      conds.push(`is_active = $${pi++}`);
      params.push(active === 'true' || active === '1');
    }

    const { rows } = await db.query(
      `SELECT s.*,
              (SELECT COUNT(*) FROM customs_shipment_parcels WHERE shipment_id = s.id) AS nb_parcels_linked
         FROM customs_shipments s
        WHERE ${conds.join(' AND ')}
        ORDER BY shipment_date DESC, created_at DESC
        LIMIT 500`,
      params
    );

    res.json({ shipments: rows });
  } catch (err) { next(err); }
});

// ══════════════════════════════════════════════════════════
// GET /api/admin/customs-shipments/rates/effective
// Taux terrain 30 / 90 / 365 jours (pour finance.js)
// ══════════════════════════════════════════════════════════
router.get('/rates/effective', ...guard, async (req, res, next) => {
  try {
    const { rows } = await db.query(`SELECT * FROM customs_effective_rates`);
    const out = {};
    rows.forEach(r => { out[r.period] = r; });
    res.json({ rates: out, fallback_rate_pct: 15 });
  } catch (err) {
    // Si la vue n'existe pas encore (migration pas passée)
    res.json({
      rates: {
        last_30d:  { nb_shipments: 0, total_cif_kmf: 0, total_customs_kmf: 0, rate_pct: 0 },
        last_90d:  { nb_shipments: 0, total_cif_kmf: 0, total_customs_kmf: 0, rate_pct: 0 },
        last_365d: { nb_shipments: 0, total_cif_kmf: 0, total_customs_kmf: 0, rate_pct: 0 },
      },
      fallback_rate_pct: 15,
      warning: 'customs_shipments table empty or migration not applied',
    });
  }
});

// ══════════════════════════════════════════════════════════
// GET /api/admin/customs-shipments/:id
// ══════════════════════════════════════════════════════════
router.get('/:id', ...guard, async (req, res, next) => {
  try {
    const { rows: [shipment] } = await db.query(
      `SELECT * FROM customs_shipments WHERE id = $1`, [req.params.id]
    );
    if (!shipment) return res.status(404).json({ error: 'Shipment not found' });

    const { rows: parcels } = await db.query(
      `SELECT csp.*, p.reference AS parcel_ref, p.status AS parcel_status,
              o.reference AS order_ref, o.client_name
         FROM customs_shipment_parcels csp
         JOIN parcels p ON p.id = csp.parcel_id
         LEFT JOIN orders o ON o.id = p.order_id
        WHERE csp.shipment_id = $1
        ORDER BY p.reference`,
      [req.params.id]
    );

    res.json({ shipment, parcels });
  } catch (err) { next(err); }
});

// ══════════════════════════════════════════════════════════
// POST /api/admin/customs-shipments
// Body: {
//   reference, shipment_date, transitaire_name, transport_mode,
//   cif_value_kmf, customs_paid_kmf, freight_kmf, total_weight_kg,
//   nb_parcels, allocation_method, allocation_config, notes,
//   parcel_ids: [uuid, ...]  ← colis à ventiler
// }
// ══════════════════════════════════════════════════════════
router.post('/', ...guard, async (req, res, next) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const {
      reference, shipment_date, transitaire_name, transport_mode,
      cif_value_kmf, customs_paid_kmf, freight_kmf, total_weight_kg,
      nb_parcels, allocation_method, allocation_config, notes,
      parcel_ids,
    } = req.body;

    if (!reference || !shipment_date || !cif_value_kmf || !customs_paid_kmf) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'Champs requis: reference, shipment_date, cif_value_kmf, customs_paid_kmf',
      });
    }

    // Création de l'envoi
    const { rows: [shipment] } = await client.query(
      `INSERT INTO customs_shipments
        (reference, shipment_date, transitaire_name, transport_mode,
         cif_value_kmf, customs_paid_kmf, freight_kmf, total_weight_kg,
         nb_parcels, allocation_method, allocation_config, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING *`,
      [
        reference, shipment_date, transitaire_name || null, transport_mode || null,
        cif_value_kmf, customs_paid_kmf, freight_kmf || null, total_weight_kg || null,
        nb_parcels || null, allocation_method || 'by_cif_value',
        allocation_config || null, notes || null, req.user.id,
      ]
    );

    // Ventilation si parcel_ids fournis
    let allocations = [];
    if (Array.isArray(parcel_ids) && parcel_ids.length > 0) {
      // Charger les colis avec leurs valeurs
      const { rows: parcelData } = await client.query(
        `SELECT p.id, p.reference,
                COALESCE(p.customs_value_kmf, o.total_kmf) AS cif_kmf,
                COALESCE(p.customs_weight_kg,
                  (SELECT SUM(COALESCE(pr.weight_kg,0) * oi.quantity)
                     FROM order_items oi
                     JOIN products pr ON pr.id = oi.product_id
                    WHERE oi.order_id = p.order_id)) AS weight_kg
           FROM parcels p
           LEFT JOIN orders o ON o.id = p.order_id
          WHERE p.id = ANY($1::uuid[])`,
        [parcel_ids]
      );

      allocations = allocateCustoms(
        { customs_paid_kmf, allocation_method: allocation_method || 'by_cif_value', allocation_config },
        parcelData.map(p => ({
          parcel_id: p.id,
          cif_kmf:   Number(p.cif_kmf) || 0,
          weight_kg: Number(p.weight_kg) || 0,
        }))
      );

      // Insertion des lignes de ventilation
      for (const a of allocations) {
        await client.query(
          `INSERT INTO customs_shipment_parcels
             (shipment_id, parcel_id, parcel_cif_kmf, parcel_weight_kg,
              customs_share_kmf, allocation_basis)
           VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (shipment_id, parcel_id) DO UPDATE
             SET customs_share_kmf = EXCLUDED.customs_share_kmf,
                 allocation_basis  = EXCLUDED.allocation_basis,
                 updated_at        = NOW()`,
          [shipment.id, a.parcel_id, a.cif_kmf, a.weight_kg, a.customs_share_kmf, a.allocation_basis]
        );
      }
    }

    await client.query('COMMIT');
    res.status(201).json({ shipment, allocations });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

// ══════════════════════════════════════════════════════════
// PATCH /api/admin/customs-shipments/:id
// Body : tout champ modifiable (reference, notes, transitaire_name, etc.)
// ══════════════════════════════════════════════════════════
router.patch('/:id', ...guard, async (req, res, next) => {
  try {
    const allowed = [
      'reference', 'shipment_date', 'transitaire_name', 'transport_mode',
      'cif_value_kmf', 'customs_paid_kmf', 'freight_kmf', 'total_weight_kg',
      'nb_parcels', 'allocation_method', 'allocation_config', 'notes',
    ];
    const updates = [];
    const params = [];
    let pi = 1;
    for (const k of allowed) {
      if (req.body[k] !== undefined) {
        updates.push(`${k} = $${pi++}`);
        params.push(req.body[k]);
      }
    }
    if (!updates.length) {
      return res.status(400).json({ error: 'Aucun champ à modifier' });
    }
    params.push(req.params.id);

    const { rows: [shipment] } = await db.query(
      `UPDATE customs_shipments SET ${updates.join(', ')} WHERE id = $${pi} RETURNING *`,
      params
    );
    if (!shipment) return res.status(404).json({ error: 'Shipment not found' });

    res.json({ shipment });
  } catch (err) { next(err); }
});

// ══════════════════════════════════════════════════════════
// POST /api/admin/customs-shipments/:id/deactivate
// Désactive l'envoi ET retire la ventilation des colis liés.
// Body: { reason?: string }
// ══════════════════════════════════════════════════════════
router.post('/:id/deactivate', ...guard, async (req, res, next) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: [shipment] } = await client.query(
      `UPDATE customs_shipments
          SET is_active = FALSE,
              deactivated_at = NOW(),
              deactivated_reason = $2
        WHERE id = $1
        RETURNING *`,
      [req.params.id, req.body.reason || null]
    );

    if (!shipment) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Shipment not found' });
    }

    // Retirer la ventilation (marge des commandes redevient la marge "théorique")
    const { rows: removed } = await client.query(
      `DELETE FROM customs_shipment_parcels WHERE shipment_id = $1 RETURNING parcel_id`,
      [req.params.id]
    );

    await client.query('COMMIT');
    res.json({
      shipment,
      message: `Envoi désactivé. Ventilation retirée de ${removed.length} colis.`,
      parcels_reset: removed.length,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

// ══════════════════════════════════════════════════════════
// POST /api/admin/customs-shipments/:id/activate
// Réactive + recalcule la ventilation depuis parcel_ids fournis.
// Body: { parcel_ids: [uuid, ...] }
// ══════════════════════════════════════════════════════════
router.post('/:id/activate', ...guard, async (req, res, next) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: [shipment] } = await client.query(
      `UPDATE customs_shipments
          SET is_active = TRUE,
              deactivated_at = NULL,
              deactivated_reason = NULL
        WHERE id = $1
        RETURNING *`,
      [req.params.id]
    );

    if (!shipment) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Shipment not found' });
    }

    const parcel_ids = Array.isArray(req.body.parcel_ids) ? req.body.parcel_ids : [];
    let allocations = [];

    if (parcel_ids.length) {
      const { rows: parcelData } = await client.query(
        `SELECT p.id,
                COALESCE(p.customs_value_kmf, o.total_kmf) AS cif_kmf,
                COALESCE(p.customs_weight_kg, 0) AS weight_kg
           FROM parcels p LEFT JOIN orders o ON o.id = p.order_id
          WHERE p.id = ANY($1::uuid[])`,
        [parcel_ids]
      );
      allocations = allocateCustoms(shipment, parcelData.map(p => ({
        parcel_id: p.id,
        cif_kmf:   Number(p.cif_kmf) || 0,
        weight_kg: Number(p.weight_kg) || 0,
      })));
      for (const a of allocations) {
        await client.query(
          `INSERT INTO customs_shipment_parcels
             (shipment_id, parcel_id, parcel_cif_kmf, parcel_weight_kg,
              customs_share_kmf, allocation_basis)
           VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (shipment_id, parcel_id) DO UPDATE
             SET customs_share_kmf = EXCLUDED.customs_share_kmf,
                 allocation_basis  = EXCLUDED.allocation_basis,
                 updated_at        = NOW()`,
          [shipment.id, a.parcel_id, a.cif_kmf, a.weight_kg, a.customs_share_kmf, a.allocation_basis]
        );
      }
    }

    await client.query('COMMIT');
    res.json({ shipment, allocations, message: `Envoi réactivé. ${allocations.length} colis ventilés.` });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

// ══════════════════════════════════════════════════════════
// DELETE /api/admin/customs-shipments/:id
// Suppression définitive (cascade sur customs_shipment_parcels)
// ══════════════════════════════════════════════════════════
router.delete('/:id', ...guard, async (req, res, next) => {
  try {
    const { rowCount } = await db.query(
      `DELETE FROM customs_shipments WHERE id = $1`, [req.params.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Shipment not found' });
    res.json({ deleted: true, id: req.params.id });
  } catch (err) { next(err); }
});

module.exports = router;
