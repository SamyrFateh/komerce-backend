/**
 * @komerce-arch
 * @role          logistics-tracking
 * @domain        logistics
 * @layer         route
 * @criticality   high
 * @inputs        runtime_context, request_or_service_payload
 * @outputs       response_or_domain_result, side_effects
 * @depends       db.js, middleware/auth.js, services/*
 * @used-by       bootstrap/api-routes.js
 * @db-read       order_items, orders, parcels, pickup_verify_attempts, products, relais, scan_events, users
 * @db-write      orders, pickup_verify_attempts
 * @db-txn        resolve_before_behavior_change
 * @doctrine      resolve_before_behavior_change
 * @impact-areas  logistics
 * @version       2026-06
 */

'use strict';

const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const pool = require('../db');
const { computeOrderStatusDetail, getOrderStatusDetailMessage } = require('../utils/parcels');
const log = require('../utils/logger').child({ module: 'tracking' });

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

const PICKUP_VERIFY_WINDOW_MINUTES = 15;
const PICKUP_VERIFY_MAX_ATTEMPTS = 5;

function pickupClientIp(req) {
  const raw = req.headers['x-forwarded-for'] || req.ip || 'unknown';
  return String(raw).split(',')[0].trim() || 'unknown';
}

function pickupIpHash(req) {
  return crypto.createHash('sha256').update(pickupClientIp(req)).digest('hex');
}

function pickupAttemptKey(token, req) {
  return crypto.createHash('sha256')
    .update(`${token}:${pickupIpHash(req)}`)
    .digest('hex');
}

async function checkPickupVerifyLimit(token, req) {
  const key = pickupAttemptKey(token, req);
  const ipHash = pickupIpHash(req);

  await pool.query(
    'DELETE FROM pickup_verify_attempts WHERE reset_at <= NOW()'
  );

  const { rows: [entry] } = await pool.query(`
    INSERT INTO pickup_verify_attempts (attempt_key, token, ip_hash, count, reset_at)
    VALUES ($1, $2, $3, 1, NOW() + ($4 || ' minutes')::interval)
    ON CONFLICT (attempt_key)
    DO UPDATE SET
      count = CASE
        WHEN pickup_verify_attempts.reset_at <= NOW() THEN 1
        ELSE pickup_verify_attempts.count + 1
      END,
      reset_at = CASE
        WHEN pickup_verify_attempts.reset_at <= NOW()
          THEN NOW() + ($4 || ' minutes')::interval
        ELSE pickup_verify_attempts.reset_at
      END,
      updated_at = NOW()
    RETURNING count, reset_at
  `, [key, token, ipHash, PICKUP_VERIFY_WINDOW_MINUTES]);

  const retryAfter = Math.max(
    1,
    Math.ceil((new Date(entry.reset_at).getTime() - Date.now()) / 1000)
  );

  return {
    allowed: entry.count <= PICKUP_VERIFY_MAX_ATTEMPTS,
    retryAfter,
  };
}

/**
 * GET /api/tracking/:token
 * Public tracking endpoint — no auth required
 * Returns order tracking data by qr_token
 */
router.get('/:token', async (req, res, next) => {
  try {
    const { token } = req.params;
    if (!token || token.length < 4 || token.length > 20) {
      return res.status(400).json({ error: 'Token invalide' });
    }

    // [P1-1] Ne plus accepter la référence comme token de tracking public.
    // La référence (ex: K85AJL4) fait 7 caractères, énumérable par bruteforce.
    // Seul qr_token (cryptographiquement aléatoire) est accepté.
    // Les clients authentifiés passent par /api/client/tracking qui accepte la ref.
    const orderResult = await pool.query(`
      SELECT
        o.id, o.reference, o.status, o.total_kmf,
        o.payment_mode, o.payment_status,
        o.pickup_secret_hash,
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
      WHERE o.qr_token = $1
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

    // Compute status detail from parcels (second-level UX info — derived, not stored)
    const statusDetail = computeOrderStatusDetail(parcelsResult.rows);
    const statusMessage = getOrderStatusDetailMessage(statusDetail);

    res.json({
      reference: order.reference,
      status: order.status,
      statusLabel: STATUS_LABELS[order.status] || order.status,
      statusDetail,
      statusMessage,
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
      pickupReady: isAtRelay && Boolean(order.pickup_secret_hash),
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
    next(err);
  }
});

/**
 * POST /api/tracking/:token/verify-pickup
 * Verify pickup code — only works when order is at relay
 */
router.post('/:token/verify-pickup', async (req, res, next) => {
  try {
    const { token } = req.params;
    const { code } = req.body;

    if (!token || !code) {
      return res.status(400).json({ valid: false, error: 'Token et code requis' });
    }
    const limit = await checkPickupVerifyLimit(token, req);
    if (!limit.allowed) {
      return res.status(429).json({
        valid: false,
        error: 'Trop de tentatives. Reessayez plus tard.',
        retryAfter: limit.retryAfter
      });
    }

    const result = await pool.query(`
      SELECT id, status FROM orders WHERE qr_token = $1
    `, [token]);

    if (result.rows.length === 0) {
      return res.status(404).json({ valid: false, error: 'Commande introuvable' });
    }

    const order = result.rows[0];

    // Only allow verification when at relay
    if (!['available', 'collected', 'delivered'].includes(order.status)) {
      return res.status(400).json({ valid: false, error: 'Commande pas encore disponible au retrait' });
    }

    // Lot 2 : vérification déléguée au service canonique (hash+salt) — plus de
    // comparaison en clair sur une colonne qui n'est plus jamais écrite.
    // verifyPickupCode gère son propre anti-brute-force par commande
    // (pickup_secret_attempts) ; le rate-limit token+IP ci-dessus
    // (pickup_verify_attempts) reste en plus — anti-énumération sur route
    // publique non authentifiée, distinct et toujours légitime.
    const { verifyPickupCode } = require('../services/pickup-secret-service');
    const verifyResult = await verifyPickupCode({ orderId: order.id, code, agentId: null });

    if (verifyResult.status === 429) {
      return res.status(429).json({ valid: false, error: verifyResult.body.error, blockedUntil: verifyResult.body.blocked_until });
    }
    // Tout le reste (200 = code valide ; 401/404/400/410 = code invalide,
    // pas encore émis, ou expiré) est aplati sur le contrat existant du
    // endpoint : 200 { valid: boolean }.
    return res.json({ valid: verifyResult.status === 200, error: verifyResult.status === 200 ? undefined : verifyResult.body.error });
  } catch (err) {
    next(err);
  }
});

/**
 * Mask phone number for privacy: +2693221111 → +269***1111
 */
function maskPhone(phone) {
  if (!phone || phone.length < 7) return phone;
  return phone.slice(0, 4) + '***' + phone.slice(-4);
}

module.exports = router;
