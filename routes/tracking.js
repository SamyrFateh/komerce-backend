'use strict';

const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const pool = require('../db');

/**
 * Status labels in French for client-facing display
 */
const STATUS_LABELS = {
  ordered: 'Commande confirmée',
  confirmed: 'Commande confirmée',
  preparation: 'En préparation',
  shipped: 'Expédiée depuis Dubaï',
  in_transit: 'En transit vers les Comores',
  arrived: 'Arrivée au relais',
  available: 'Disponible au retrait',
  collected: 'Retirée',
  delivered: 'Livrée',
  cancelled: 'Annulée',
  refunded: 'Remboursée'
};

/**
 * Status timeline order for progress display
 */
const STATUS_ORDER = [
  'ordered', 'preparation', 'shipped',
  'in_transit', 'available', 'collected'
];

/**
 * GET /api/tracking/:token
 * Public tracking endpoint — no auth required
 * Returns order tracking data by qr_token
 */
router.get('/:token', async (req, res) => {
  try {
    const { token } = req.params;
    if (!token || token.length < 4 || token.length > 20) {
      return res.status(400).json({ error: 'Token invalide' });
    }

    // Fetch order by qr_token OR by reference (fallback for CT WhatsApp links)
    const orderResult = await pool.query(`
      SELECT
        o.id, o.reference, o.status, o.total_kmf,
        o.payment_mode, o.payment_status,
        o.pickup_code,
        o.created_at, o.shipped_at, o.available_at, o.collected_at,
        o.ordered_at, o.preparation_at, o.in_transit_at,
        o.destination_island,
        u.full_name AS client_name,
        u.phone AS client_phone,
        rel.name AS relais_name,
        rel.address AS relais_address
      FROM orders o
      LEFT JOIN users u ON u.id = o.user_id
      LEFT JOIN relais rel ON rel.id = o.relais_id
      WHERE o.qr_token = $1 OR o.reference = $1
    `, [token]);

    if (orderResult.rows.length === 0) {
      return res.status(404).json({ error: 'Commande introuvable' });
    }

    const order = orderResult.rows[0];

    // Fetch order items with product details
    const itemsResult = await pool.query(`
      SELECT
        oi.quantity, oi.price_kmf,
        p.name AS product_name, p.emoji, p.image_url, p.sku
      FROM order_items oi
      JOIN products p ON p.id = oi.product_id
      WHERE oi.order_id = $1
    `, [order.id]);

    // Fetch parcels
    const parcelsResult = await pool.query(`
      SELECT
        p.id, p.reference, p.status, p.weight_kg,
        p.shipped_at, p.available_at, p.collected_at,
        p.destination_island, p.destination_relais
      FROM parcels p
      WHERE p.order_id = $1
      ORDER BY p.created_at ASC
    `, [order.id]);

    // Fetch scan events for all parcels
    const parcelIds = parcelsResult.rows.map(p => p.id);
    let scanEvents = [];
    if (parcelIds.length > 0) {
      const scanResult = await pool.query(`
        SELECT
          se.parcel_id, se.event_type, se.location,
          se.notes, se.created_at
        FROM scan_events se
        WHERE se.parcel_id = ANY($1) AND se.status = 'applied'
        ORDER BY se.created_at ASC
      `, [parcelIds]);
      scanEvents = scanResult.rows;
    }

    // Group scan events by parcel
    const scansByParcel = {};
    for (const se of scanEvents) {
      if (!scansByParcel[se.parcel_id]) scansByParcel[se.parcel_id] = [];
      scansByParcel[se.parcel_id].push({
        type: se.event_type,
        label: STATUS_LABELS[se.event_type] || se.event_type,
        location: se.location,
        notes: se.notes,
        date: se.created_at
      });
    }

    // Build timeline
    const timeline = [];
    const addTimeline = (status, date) => {
      if (date) {
        timeline.push({
          status: status,
          label: STATUS_LABELS[status] || status,
          date: date,
          completed: true
        });
      }
    };

    addTimeline('ordered', order.ordered_at || order.created_at);
    addTimeline('preparation', order.preparation_at);
    addTimeline('shipped', order.shipped_at);
    addTimeline('in_transit', order.in_transit_at);
    addTimeline('available', order.available_at);
    addTimeline('collected', order.collected_at);

    // Fill in incomplete steps from status
    if (timeline.length <= 1) {
      const currentIdx = STATUS_ORDER.indexOf(order.status);
      for (let i = 0; i < STATUS_ORDER.length; i++) {
        const s = STATUS_ORDER[i];
        const existing = timeline.find(t => t.status === s);
        if (!existing) {
          timeline.push({
            status: s,
            label: STATUS_LABELS[s] || s,
            date: null,
            completed: i <= currentIdx
          });
        }
      }
      timeline.sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status));
    }

    // IMPORTANT: pickup_code is ONLY visible when order is at relay or later
    const isAtRelay = ['available', 'collected', 'delivered'].includes(order.status);

    res.json({
      reference: order.reference,
      status: order.status,
      statusLabel: STATUS_LABELS[order.status] || order.status,
      totalKmf: order.total_kmf,
      paymentMode: order.payment_mode,
      paymentStatus: order.payment_status,
      destinationIsland: order.destination_island,
      createdAt: order.created_at,
      client: {
        name: order.client_name,
        phone: order.client_phone ? maskPhone(order.client_phone) : null
      },
      relay: isAtRelay ? {
        name: order.relais_name,
        address: order.relais_address
      } : null,
      pickupCode: isAtRelay ? order.pickup_code : null,
      items: itemsResult.rows.map(i => ({
        name: i.product_name,
        emoji: i.emoji,
        imageUrl: i.image_url,
        sku: i.sku,
        quantity: i.quantity,
        priceKmf: i.price_kmf
      })),
      parcels: parcelsResult.rows.map(p => ({
        reference: p.reference,
        status: p.status,
        statusLabel: STATUS_LABELS[p.status] || p.status,
        weightKg: p.weight_kg,
        destinationIsland: p.destination_island,
        destinationRelais: p.destination_relais,
        shippedAt: p.shipped_at,
        availableAt: p.available_at,
        collectedAt: p.collected_at,
        events: scansByParcel[p.id] || []
      })),
      timeline: timeline
    });
  } catch (err) {
    console.error('Tracking error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

/**
 * POST /api/tracking/:token/verify-pickup
 * Verify pickup code — only works when order is at relay
 */
router.post('/:token/verify-pickup', async (req, res) => {
  try {
    const { token } = req.params;
    const { code } = req.body;

    if (!token || !code) {
      return res.status(400).json({ valid: false, error: 'Token et code requis' });
    }

    const result = await pool.query(`
      SELECT pickup_code, status FROM orders WHERE qr_token = $1
    `, [token]);

    if (result.rows.length === 0) {
      return res.status(404).json({ valid: false, error: 'Commande introuvable' });
    }

    const order = result.rows[0];
    
    // Only allow verification when at relay
    if (!['available', 'collected', 'delivered'].includes(order.status)) {
      return res.status(400).json({ valid: false, error: 'Commande pas encore disponible au retrait' });
    }

    const valid = order.pickup_code && order.pickup_code === String(code).trim();
    res.json({ valid: valid });
  } catch (err) {
    console.error('Verify pickup error:', err);
    res.status(500).json({ valid: false, error: 'Erreur serveur' });
  }
});

/**
 * Generate pickup code for an order when parcel arrives at relay
 * Called from scan event processing
 */
async function generatePickupCode(orderId) {
  const code = String(crypto.randomInt(1000, 10000));
  await pool.query(
    `UPDATE orders SET pickup_code = $1 WHERE id = $2 AND pickup_code IS NULL`,
    [code, orderId]
  );
  console.log(`📱 Pickup code generated for order ${orderId}: ${code}`);
  return code;
}

/**
 * Generate qr_token for a new order (call at order creation)
 */
async function generateTrackingToken(orderId) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let token = '';
  const bytes = crypto.randomBytes(6);
  for (let i = 0; i < 6; i++) {
    token += chars[bytes[i] % chars.length];
  }
  await pool.query(
    `UPDATE orders SET qr_token = $1 WHERE id = $2 AND qr_token IS NULL`,
    [token, orderId]
  );
  console.log(`📱 Tracking token generated for order ${orderId}: ${token}`);
  return token;
}

/**
 * Mask phone number for privacy: +2693221111 → +269***1111
 */
function maskPhone(phone) {
  if (!phone || phone.length < 7) return phone;
  return phone.slice(0, 4) + '***' + phone.slice(-4);
}

// Export router + utility functions
router.generatePickupCode = generatePickupCode;
router.generateTrackingToken = generateTrackingToken;
module.exports = router;
