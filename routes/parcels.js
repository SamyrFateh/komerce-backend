/**
 * KOMERCE — Parcels CRUD API (R1 compliant)
 * GET    /api/parcels               → Liste colis (filtres, pagination)
 * GET    /api/parcels/:ref          → Détail colis par référence
 * POST   /api/parcels               → Créer colis manuellement
 * PATCH  /api/parcels/:id/status    → Changer statut via parcelSync (R1)
 * POST   /api/parcels/:id/items     → Ajouter article au colis
 * DELETE /api/parcels/:id/items/:item_id → Retirer article du colis
 *
 * Safety Fixes:
 *   A. Catch 23505 sur POST /:id/items (unique_order_item_per_parcel)
 *   C. Catch 23505 sur POST / (one_draft_per_order)
 *
 * FIX-007 (7 avril 2026): STATUS_TO_STEP clé 'preparing' → 'preparation'
 * FIX-009 (7 avril 2026): oi.unit_price_kmf → oi.price_kmf
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

const adminAgent = [authenticate, requireRole(['admin', 'agent_hub'])];
const adminAgentRelais = [authenticate, requireRole(['admin', 'agent_hub', 'agent_relais'])];

// Status → step mapping for parcelSync (R1)
// FIX-007: 'preparing' → 'preparation' (aligne sur l'ENUM parcel_status)
const STATUS_TO_STEP = {
  preparation: 'preparation',
  shipped:     'shipped',
  in_transit:  'in_transit',
  available:   'relais_received',
  collected:   'collected',
};

// GET /api/parcels — List parcels with filters & pagination
router.get('/', ...adminAgent, validate(parcels.list, 'query'), async (req, res) => {
  try {
    const { status, shipment_id, order_id, search, page = 1, limit = 50 } = req.query;
    const safeLimit = Math.min(parseInt(limit) || 50, 100);
    const safePage = Math.max(parseInt(page) || 1, 1);
    const offset = (safePage - 1) * safeLimit;

    const conditions = [];
    const params = [];
    let idx = 1;

    if (status) {
      conditions.push(`p.status = $${idx++}`);
      params.push(status);
    }
    if (shipment_id) {
      conditions.push(`p.shipment_id = $${idx++}`);
      params.push(shipment_id);
    }
    if (order_id) {
      conditions.push(`p.order_id = $${idx++}`);
      params.push(order_id);
    }
    if (search) {
      conditions.push(`p.reference ILIKE $${idx++}`);
      params.push(`%${search}%`);
    }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

    // Count total
    const countResult = await db.query(
      `SELECT COUNT(*) FROM parcels p ${where}`,
      params
    );
    const total = parseInt(countResult.rows[0].count);

    // Fetch page
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

    res.json({
      data: rows,
      pagination: {
        page: safePage,
        limit: safeLimit,
        total,
        pages: Math.ceil(total / safeLimit),
      },
    });
  } catch(e) { console.error(e); res.status(500).json({ error: 'Erreur liste colis' }); }
});

// GET /api/parcels/:ref — Get parcel by reference (KOM-P-*)
router.get('/:ref', ...adminAgentRelais, async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT p.*,
             o.reference AS order_reference, o.status AS order_status,
             o.user_id, o.relais_id
      FROM parcels p
      LEFT JOIN orders o ON o.id = p.order_id
      WHERE p.reference = $1
    `, [req.params.ref]);

    if (!rows.length) return res.status(404).json({ error: 'Colis introuvable' });

    const parcel = rows[0];

    // Fetch parcel items with product details
    // FIX-009: oi.unit_price_kmf → oi.price_kmf (nom réel de la colonne)
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

// POST /api/parcels — Create parcel manually
// Safety Fix C: catch 23505 → un seul colis draft par commande
router.post('/', ...adminAgent, validate(parcels.create), async (req, res) => {
  try {
    const { order_id, type = 'standard', notes } = req.body;

    // Validate order exists
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
    // Safety Fix C: unique violation → un colis draft existe déjà pour cette commande
    if (e.code === '23505' && e.constraint === 'one_draft_per_order') {
      return res.status(409).json({ error: 'Un colis draft existe déjà pour cette commande' });
    }
    console.error(e);
    res.status(500).json({ error: 'Erreur création colis' });
  }
});

// PATCH /api/parcels/:id/status — Change status via parcelSync (R1 compliant)
router.patch('/:id/status', ...adminAgent, validate(parcels.updateStatus), async (req, res) => {
  try {
    const { status, notes } = req.body;

    // Validate parcel exists
    const parcelCheck = await db.query('SELECT id, order_id, status FROM parcels WHERE id = $1', [req.params.id]);
    if (!parcelCheck.rows.length) return res.status(404).json({ error: 'Colis introuvable' });

    const parcel = parcelCheck.rows[0];
    const step = STATUS_TO_STEP[status];

    if (!step) return res.status(400).json({ error: `Statut invalide : ${status}` });

    // R1: Use safeSyncScanToParcels for all status changes
    await safeSyncScanToParcels({
      order_id: parcel.order_id,
      step,
      scan_id: null,
      scanned_by: req.user.id,
      notes: notes || `Status → ${status}`,
    });

    // Fetch updated parcel
    const { rows } = await db.query('SELECT * FROM parcels WHERE id = $1', [req.params.id]);

    res.json(rows[0]);
  } catch(e) { console.error(e); res.status(500).json({ error: 'Erreur mise à jour statut colis' }); }
});

// POST /api/parcels/:id/items — Add item to parcel
// Safety Fix A: catch 23505 → article déjà assigné à un colis
router.post('/:id/items', ...adminAgent, validate(parcels.addItem), async (req, res) => {
  try {
    const { order_item_id, quantity } = req.body;

    // Validate parcel exists
    const parcelCheck = await db.query('SELECT id, order_id FROM parcels WHERE id = $1', [req.params.id]);
    if (!parcelCheck.rows.length) return res.status(404).json({ error: 'Colis introuvable' });

    // Validate order_item exists
    const itemCheck = await db.query('SELECT id FROM order_items WHERE id = $1', [order_item_id]);
    if (!itemCheck.rows.length) return res.status(404).json({ error: 'Article de commande introuvable' });

    const { rows } = await db.query(`
      INSERT INTO parcel_items (parcel_id, order_item_id, quantity)
      VALUES ($1, $2, $3)
      RETURNING *
    `, [req.params.id, order_item_id, quantity]);

    res.status(201).json(rows[0]);
  } catch(e) {
    // Safety Fix A: unique violation → article déjà dans un colis
    if (e.code === '23505' && e.constraint === 'unique_order_item_per_parcel') {
      return res.status(409).json({ error: 'Cet article est déjà assigné à un colis' });
    }
    console.error(e);
    res.status(500).json({ error: 'Erreur ajout article au colis' });
  }
});

// DELETE /api/parcels/:id/items/:item_id — Remove item from parcel
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

module.exports = router;
