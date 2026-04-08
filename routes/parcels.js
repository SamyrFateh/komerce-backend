/**
 * KOMERCE — Parcels CRUD API (R1 compliant)
 * GET    /api/parcels               → Liste colis (filtres, pagination)
 * GET    /api/parcels/:ref          → Détail colis par référence
 * POST   /api/parcels               → Créer colis manuellement
 * PATCH  /api/parcels/:id/status    → Changer statut via parcelSync (R1) + évalue link rules
 * POST   /api/parcels/:id/items     → Ajouter article au colis
 * DELETE /api/parcels/:id/items/:item_id → Retirer article du colis
 * POST   /api/parcels/optimize      → Optimiser la répartition des items en colis
 * POST   /api/parcels/bootstrap/:orderId → Migrer une commande legacy
 */

const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { parcels } = require('../validators');
const { safeSyncScanToParcels } = require('../utils/parcelSync');
const { generateParcelRef } = require('../utils/reference');
const { PARCEL_STATUSES } = require('../utils/parcels');
const { DEFAULT_CONFIG: DEFAULT_OPTIM_CONFIG } = require('../services/parcelOptimizationService');
const { evaluateOrderParcelLinkRules } = require('../utils/orderParcelLinkRules');

const adminAgent = [authenticate, requireRole(['admin', 'agent_hub'])];
const adminAgentRelais = [authenticate, requireRole(['admin', 'agent_hub', 'agent_relais'])];

const STATUS_TO_STEP = {
  preparation: 'preparation',
  shipped:     'shipped',
  in_transit:  'in_transit',
  available:   'relais_received',
  collected:   'collected',
};

// GET /api/parcels
router.get('/', ...adminAgent, validate(parcels.list, 'query'), async (req, res) => {
  try {
    const { status, shipment_id, order_id, search, page = 1, limit = 50 } = req.query;
    const safeLimit = Math.min(parseInt(limit) || 50, 100);
    const safePage = Math.max(parseInt(page) || 1, 1);
    const offset = (safePage - 1) * safeLimit;

    const conditions = [];
    const params = [];
    let idx = 1;

    if (status) { conditions.push(`p.status = $${idx++}`); params.push(status); }
    if (shipment_id) { conditions.push(`p.shipment_id = $${idx++}`); params.push(shipment_id); }
    if (order_id) { conditions.push(`p.order_id = $${idx++}`); params.push(order_id); }
    if (search) { conditions.push(`p.reference ILIKE $${idx++}`); params.push(`%${search}%`); }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

    const countResult = await db.query(`SELECT COUNT(*) FROM parcels p ${where}`, params);
    const total = parseInt(countResult.rows[0].count);

    const { rows } = await db.query(`
      SELECT p.*,
             o.reference AS order_reference, o.status AS order_status,
             (SELECT COUNT(*) FROM parcel_items pi WHERE pi.parcel_id = p.id) AS items_count
      FROM parcels p
      LEFT JOIN orders o ON o.id = p.order_id
      ${where}
      ORDER BY p.created_at DESC
      LIMIT $${idx++} OFFSET $${idx++}
    `, [...params, safeLimit, offset]);

    res.json({ data: rows, pagination: { page: safePage, limit: safeLimit, total, pages: Math.ceil(total / safeLimit) } });
  } catch(e) { console.error(e); res.status(500).json({ error: 'Erreur liste colis' }); }
});

// GET /api/parcels/:ref
router.get('/:ref', ...adminAgentRelais, async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT p.*, o.reference AS order_reference, o.status AS order_status, o.user_id, o.relais_id
      FROM parcels p
      LEFT JOIN orders o ON o.id = p.order_id
      WHERE p.reference = $1
    `, [req.params.ref]);

    if (!rows.length) return res.status(404).json({ error: 'Colis introuvable' });
    const parcel = rows[0];

    const items = await db.query(`
      SELECT pi.*, oi.quantity AS order_qty, oi.price_kmf,
             pr.name AS product_name, pr.image_url AS product_image
      FROM parcel_items pi
      LEFT JOIN order_items oi ON oi.id = pi.order_item_id
      LEFT JOIN products pr ON pr.id = oi.product_id
      WHERE pi.parcel_id = $1
      ORDER BY pi.created_at ASC
    `, [parcel.id]);

    parcel.items = items.rows;
    res.json(parcel);
  } catch(e) { console.error(e); res.status(500).json({ error: 'Erreur détail colis' }); }
});

// POST /api/parcels
router.post('/', ...adminAgent, validate(parcels.create), async (req, res) => {
  try {
    const { order_id, type = 'standard', notes } = req.body;

    const orderCheck = await db.query('SELECT id FROM orders WHERE id = $1', [order_id]);
    if (!orderCheck.rows.length) return res.status(404).json({ error: 'Commande introuvable' });

    const reference = await generateParcelRef(db);

    const { rows } = await db.query(`
      INSERT INTO parcels (reference, order_id, type, notes, status)
      VALUES ($1, $2, $3, $4, 'draft')
      RETURNING *
    `, [reference, order_id, type, notes || null]);

    res.status(201).json(rows[0]);
  } catch(e) {
    if (e.code === '23505' && e.constraint === 'one_draft_per_order') {
      return res.status(409).json({ error: 'Un colis draft existe déjà pour cette commande' });
    }
    console.error(e);
    res.status(500).json({ error: 'Erreur création colis' });
  }
});

// PATCH /api/parcels/:id/status
// Après chaque changement de statut logistique, évalue les link rules order ↔ parcel
// Retourne le colis mis à jour + l'ordre mis à jour (pour vérification link rules)
router.patch('/:id/status', ...adminAgent, validate(parcels.updateStatus), async (req, res) => {
  try {
    const { status, notes } = req.body;
    const parcelCheck = await db.query('SELECT id, order_id, status FROM parcels WHERE id = $1', [req.params.id]);
    if (!parcelCheck.rows.length) return res.status(404).json({ error: 'Colis introuvable' });

    const parcel = parcelCheck.rows[0];
    const step = STATUS_TO_STEP[status];
    if (!step) return res.status(400).json({ error: `Statut invalide : ${status}` });

    await safeSyncScanToParcels({
      order_id:    parcel.order_id,
      step,
      scan_id:     null,
      scanned_by:  req.user.id,
      notes:       notes || `Status → ${status}`,
    });

    // Évaluer les règles de liaison order ↔ parcel (R1/R2/R3)
    const triggeredRule = await evaluateOrderParcelLinkRules(parcel.order_id, db);
    if (triggeredRule) {
      console.info(`[LINK-RULE] ${triggeredRule} déclenché pour order ${parcel.order_id}`);
    }

    // Récupérer le colis ET l'ordre mis à jour (pour vérification du statut)
    const [parcelResult, orderResult] = await Promise.all([
      db.query('SELECT * FROM parcels WHERE id = $1', [req.params.id]),
      db.query('SELECT id, status, computed_status FROM orders WHERE id = $1', [parcel.order_id]),
    ]);

    const updatedOrder = orderResult.rows[0];

    res.json({
      ...parcelResult.rows[0],
      link_rule_triggered: triggeredRule,
      order: updatedOrder
        ? { id: updatedOrder.id, status: updatedOrder.status, computed_status: updatedOrder.computed_status }
        : null,
    });
  } catch(e) { console.error(e); res.status(500).json({ error: 'Erreur mise à jour statut colis' }); }
});

// POST /api/parcels/:id/items
router.post('/:id/items', ...adminAgent, validate(parcels.addItem), async (req, res) => {
  try {
    const { order_item_id, quantity } = req.body;
    const parcelCheck = await db.query('SELECT id, order_id FROM parcels WHERE id = $1', [req.params.id]);
    if (!parcelCheck.rows.length) return res.status(404).json({ error: 'Colis introuvable' });

    const itemCheck = await db.query('SELECT id FROM order_items WHERE id = $1', [order_item_id]);
    if (!itemCheck.rows.length) return res.status(404).json({ error: 'Article de commande introuvable' });

    const { rows } = await db.query(`
      INSERT INTO parcel_items (parcel_id, order_item_id, quantity)
      VALUES ($1, $2, $3)
      RETURNING *
    `, [req.params.id, order_item_id, quantity]);

    res.status(201).json(rows[0]);
  } catch(e) {
    if (e.code === '23505' && e.constraint === 'unique_order_item_per_parcel') {
      return res.status(409).json({ error: 'Cet article est déjà assigné à un colis' });
    }
    console.error(e);
    res.status(500).json({ error: 'Erreur ajout article au colis' });
  }
});

// DELETE /api/parcels/:id/items/:item_id
router.delete('/:id/items/:item_id', ...adminAgent, async (req, res) => {
  try {
    const { rows } = await db.query(
      'DELETE FROM parcel_items WHERE parcel_id = $1 AND id = $2 RETURNING *',
      [req.params.id, req.params.item_id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Article de colis introuvable' });
    res.json({ message: 'Article retiré du colis', deleted: rows[0] });
  } catch(e) { console.error(e); res.status(500).json({ error: 'Erreur suppression article du colis' }); }
});

// POST /api/parcels/optimize
router.post('/optimize', ...adminAgent, async (req, res) => {
  try {
    const { order_id, config: userConfig } = req.body;
    if (!order_id) return res.status(400).json({ error: 'order_id requis' });

    const orderCheck = await db.query('SELECT id FROM orders WHERE id = $1', [order_id]);
    if (!orderCheck.rows.length) return res.status(404).json({ error: 'Commande introuvable' });

    // COALESCE sur les colonnes nullables (produits sans weight_kg/volume_cm3 renseignés)
    const { rows: items } = await db.query(`
      SELECT
        oi.id                               AS order_item_id,
        oi.product_id,
        oi.quantity                         AS quantity_available,
        oi.price_kmf                        AS unit_value,
        COALESCE(p.weight_kg, 0)            AS unit_weight,
        COALESCE(p.volume_cm3, 0)           AS unit_volume,
        p.category,
        COALESCE(p.is_fragile, false)       AS is_fragile,
        COALESCE(p.is_bulky, false)         AS is_bulky,
        p.compatibility_group
      FROM order_items oi
      LEFT JOIN products p ON p.id = oi.product_id
      WHERE oi.order_id = $1
    `, [order_id]);

    const { rows: existingParcels } = await db.query(`
      SELECT id,
             COALESCE(weight_kg, 0)::float  AS current_weight,
             COALESCE(volume_cm3, 0)::float AS current_volume,
             0::float                       AS current_value,
             $2::float                      AS max_weight,
             $3::float                      AS max_volume,
             status
      FROM parcels
      WHERE order_id = $1
        AND status IN ('draft', 'preparation')
    `, [order_id, DEFAULT_OPTIM_CONFIG.maxParcelWeightKg, DEFAULT_OPTIM_CONFIG.maxParcelVolumeCm3]);

    const { buildParcelsFromAvailableItems } = require('../services/parcelOptimizationService');
    const cfg = userConfig ? { ...DEFAULT_OPTIM_CONFIG, ...userConfig } : DEFAULT_OPTIM_CONFIG;

    const result = buildParcelsFromAvailableItems({ items, existingParcels, config: cfg });

    const createdParcels = [];

    for (const cp of result.createdParcels) {
      const reference = await generateParcelRef(db);
      const type = result.createdParcels.length > 1 ? 'partial' : 'standard';

      const { rows: [parcel] } = await db.query(`
        INSERT INTO parcels (reference, order_id, type, status, weight_kg, notes)
        VALUES ($1, $2, $3, 'draft', $4, $5)
        RETURNING *
      `, [reference, order_id, type, cp.total_weight || null, cp.warnings.join('; ') || null]);

      for (const item of cp.items) {
        await db.query(`
          INSERT INTO parcel_items (parcel_id, order_item_id, product_id, quantity)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT DO NOTHING
        `, [parcel.id, item.order_item_id, item.product_id, item.quantity_available]);
      }

      createdParcels.push({ ...parcel, items: cp.items, warnings: cp.warnings });
    }

    const updatedParcels = [];
    for (const up of result.updatedParcels) {
      for (const item of up.addedItems) {
        await db.query(`
          INSERT INTO parcel_items (parcel_id, order_item_id, product_id, quantity)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT DO NOTHING
        `, [up.parcelId, item.order_item_id, item.product_id, item.quantity_available]);
      }
      updatedParcels.push(up);
    }

    // computed_status = vue logistique (lecture seule, ne pilote pas orders.status)
    const { computeOrderStatus } = require('../utils/parcels');
    const { rows: allParcels } = await db.query(
      'SELECT status, type FROM parcels WHERE order_id = $1',
      [order_id]
    );
    const logisticView = computeOrderStatus(allParcels);
    await db.query(
      'UPDATE orders SET computed_status = $1, updated_at = NOW() WHERE id = $2',
      [logisticView, order_id]
    );

    res.json({
      order_id,
      computed_status: logisticView,
      createdParcels,
      updatedParcels,
      unassignedItems: result.unassignedItems,
    });
  } catch(e) {
    console.error('[OPTIMIZE ERROR]', e);
    res.status(500).json({ error: 'Erreur optimisation colis', detail: e.message });
  }
});

// POST /api/parcels/bootstrap/:orderId
router.post('/bootstrap/:orderId', ...adminAgent, async (req, res) => {
  try {
    const { orderId } = req.params;

    const orderCheck = await db.query('SELECT id FROM orders WHERE id = $1', [orderId]);
    if (!orderCheck.rows.length) return res.status(404).json({ error: 'Commande introuvable' });

    const existingCheck = await db.query(
      `SELECT COUNT(*) FROM parcels WHERE order_id = $1 AND status != 'cancelled'`,
      [orderId]
    );
    if (parseInt(existingCheck.rows[0].count) > 0) {
      return res.status(409).json({
        error: 'La commande a déjà des colis actifs. Utilisez /optimize pour enrichir.',
        hint: 'Annulez les colis existants avant de bootstrapper.',
      });
    }

    const { bootstrapOrderParcels } = require('../services/parcelOptimizationService');
    const result = await bootstrapOrderParcels(orderId, db);

    res.status(201).json({
      order_id: orderId,
      created: result.createdParcels.length,
      assigned_items: result.assignedItems,
      unassigned_items: result.unassignedItems.length,
      parcels: result.createdParcels,
      unassigned: result.unassignedItems,
    });
  } catch(e) {
    console.error('[BOOTSTRAP ERROR]', e);
    res.status(500).json({ error: 'Erreur bootstrap colis', detail: e.message });
  }
});

module.exports = router;
