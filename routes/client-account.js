'use strict';
/**
 * routes/client-account.js — NON MONTÉ (dead code)
 *
 * Ce module N'EST PAS require()'d par bootstrap/api-routes.js ni server.js.
 * Son rôle a été repris par routes/client-auth.js (magic-link → kmrc_jwt)
 * et routes/otp.js (OTP → kmrc_jwt).
 *
 * Conservé pour référence historique et pour les tests unitaires éventuels
 * de requireClientAuth. Ne pas monter sans audit préalable des routes dupliquées.
 *
 * Cookie canonique : kmrc_jwt (posé par client-auth.js + otp.js)
 * Payload canonique : { id, role } (client-auth) ou { id, name, phone } (otp)
 */

const express = require('express');
const router = express.Router();
const pool = require('../db');
const jwt = require('jsonwebtoken');
const log = require('../utils/logger').child({ module: 'client-account' });

const JWT_SECRET = process.env.JWT_SECRET;
const BASE_URL = process.env.BASE_URL || 'https://komerce.km';
const CLIENT_COOKIE = 'kmrc_jwt'; // cookie canonique unique — auth.js, auth-guest.js, client-auth.js, otp.js
// CONSOLIDATION AUTH (2026-05-30) :
//   - Supprimé : kmrc_client (OTP ne le pose plus), komerce_client (legacy magic-link client-account.js non monté).
//   - client-auth.js (magic-link actif) pose kmrc_jwt avec payload {id, role, fullName}.
//   - otp.js pose kmrc_jwt avec payload {id, name, full_name, phone}.
//   - Les deux shapes ont 'id' → req.clientUserId = decoded.id.
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60 * 1000; // 30 days

function maskPhone(phone) {
  if (!phone) return null;
  const raw = String(phone);
  if (raw.length <= 4) return '****';
  return raw.slice(0, 4) + '******' + raw.slice(-2);
}

function canEchoMagicLink() {
  return process.env.NODE_ENV !== 'production' && process.env.MAGIC_LINK_DEV_ECHO === 'true';
}

// ─── Auth middleware for client routes ───────────────────────────────

function requireClientAuth(req, res, next) {
  const token = req.cookies?.[CLIENT_COOKIE] || null;
  if (!token) return res.status(401).json({ error: 'Non authentifié' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    // Normalise les deux shapes : {id} (OTP/client-auth) et {userId} (legacy, plus produit)
    req.clientUserId = decoded.id || decoded.userId || null;
    req.clientPhone  = decoded.phone || null;
    if (!req.clientUserId) return res.status(401).json({ error: 'Session invalide' });
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Session expirée' });
  }
}

// ─── Magic Link endpoints (mounted at /api/auth) ────────────────────

/**
 * POST /api/auth/magic-link
 * Request a magic link via phone number
 */
router.post('/magic-link', async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) {
      return res.status(400).json({ error: 'Numéro de téléphone requis' });
    }

    // Normalize phone
    const normalizedPhone = phone.trim();

    // Find user by phone
    const userResult = await pool.query(
      'SELECT id, phone, full_name FROM users WHERE phone = $1',
      [normalizedPhone]
    );

    if (userResult.rows.length === 0) {
      // Don't reveal if user exists or not — always return success
      log.info('[magic-link] Requested for unknown phone', { phone: maskPhone(normalizedPhone) });
      return res.json({ success: true, message: 'Lien envoyé' });
    }

    const user = userResult.rows[0];

    // Generate magic link JWT (15 min expiry)
    const magicToken = jwt.sign(
      { userId: user.id, phone: user.phone, type: 'magic_link' },
      JWT_SECRET,
      { expiresIn: '15m' }
    );

    // Store token in DB for additional validation
    await pool.query(
      `UPDATE users SET magic_token = $1, magic_token_expires_at = NOW() + INTERVAL '15 minutes' WHERE id = $2`,
      [magicToken, user.id]
    );

    // Build magic link URL
    const magicUrl = `${BASE_URL}/api/auth/magic-link/validate?token=${magicToken}`;

    // Never echo a usable magic link in production logs.
    log.info('[magic-link] Generated', { userId: user.id, phone: maskPhone(user.phone) });
    if (canEchoMagicLink()) {
      log.info('[magic-link][dev] URL:', magicUrl);
    }

    res.json({ success: true, message: 'Lien envoyé' });
  } catch (err) {
    log.error('Magic link error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

/**
 * GET /api/auth/magic-link/validate
 * Validate magic link token, set session cookie, redirect
 */
router.get('/magic-link/validate', async (req, res) => {
  try {
    const { token } = req.query;
    if (!token) {
      return res.status(400).send('Lien invalide');
    }

    // Verify JWT
    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    } catch (err) {
      return res.status(400).send('Lien expiré ou invalide. Veuillez demander un nouveau lien.');
    }

    if (decoded.type !== 'magic_link') {
      return res.status(400).send('Lien invalide');
    }

    // Verify token matches what's stored in DB
    const userResult = await pool.query(
      'SELECT id, phone, full_name, magic_token FROM users WHERE id = $1',
      [decoded.userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(400).send('Utilisateur introuvable');
    }

    const user = userResult.rows[0];

    // Check stored token matches (single-use)
    if (user.magic_token !== token) {
      return res.status(400).send('Ce lien a déjà été utilisé. Veuillez en demander un nouveau.');
    }

    // Clear magic token (single-use)
    await pool.query(
      'UPDATE users SET magic_token = NULL, magic_token_expires_at = NULL, last_login_at = NOW() WHERE id = $1',
      [user.id]
    );

    // Create session JWT (30 days)
    const sessionToken = jwt.sign(
      { userId: user.id, phone: user.phone, type: 'client_session' },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    // Set httpOnly cookie
    res.cookie(CLIENT_COOKIE, sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: COOKIE_MAX_AGE,
      path: '/'
    });

    // Redirect to account page
    res.redirect('/mon-compte.html');
  } catch (err) {
    log.error('Magic link validate error:', err);
    res.status(500).send('Erreur serveur');
  }
});

/**
 * GET /api/auth/me
 * Check current client session
 */
router.get('/me', requireClientAuth, async (req, res) => {
  try {
    const userResult = await pool.query(
      'SELECT id, full_name, phone, email FROM users WHERE id = $1',
      [req.clientUserId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'Utilisateur introuvable' });
    }

    const user = userResult.rows[0];
    res.json({
      id: user.id,
      fullName: user.full_name,
      phone: user.phone,
      email: user.email
    });
  } catch (err) {
    log.error('Auth me error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

/**
 * POST /api/auth/logout
 * Clear session cookie
 */
router.post('/logout', (req, res) => {
  res.clearCookie(CLIENT_COOKIE, { path: '/' });
  res.json({ success: true });
});

// ─── Client endpoints (mounted at /api/client) ──────────────────────

/**
 * GET /api/client/orders
 * Get authenticated client's order history
 */
router.get('/orders', requireClientAuth, async (req, res) => {
  try {
    // Get all orders for this user
    const ordersResult = await pool.query(`
      SELECT
        o.id, o.reference, o.status, o.total_kmf,
        o.payment_mode, o.payment_status,
        o.created_at, o.shipped_at, o.available_at, o.collected_at,
        o.destination_island, o.qr_token,
        r.full_name AS recipient_name,
        r.phone AS recipient_phone,
        rel.name AS relais_name
      FROM orders o
      LEFT JOIN recipients r ON r.id = o.recipient_id
      LEFT JOIN relais rel ON rel.id = o.relais_id
      WHERE o.user_id = $1
      ORDER BY o.created_at DESC
    `, [req.clientUserId]);

    // Get items for all orders
    const orderIds = ordersResult.rows.map(o => o.id);
    let itemsByOrder = {};
    if (orderIds.length > 0) {
      const itemsResult = await pool.query(`
        SELECT
          oi.order_id, oi.quantity, oi.price_kmf,
          p.name AS product_name, p.emoji, p.image_url
        FROM order_items oi
        JOIN products p ON p.id = oi.product_id
        WHERE oi.order_id = ANY($1)
      `, [orderIds]);

      for (const item of itemsResult.rows) {
        if (!itemsByOrder[item.order_id]) itemsByOrder[item.order_id] = [];
        itemsByOrder[item.order_id].push({
          name: item.product_name,
          emoji: item.emoji,
          imageUrl: item.image_url,
          quantity: item.quantity,
          priceKmf: item.price_kmf
        });
      }
    }

    // Get parcels for all orders
    let parcelsByOrder = {};
    if (orderIds.length > 0) {
      const parcelsResult = await pool.query(`
        SELECT
          p.order_id, p.reference, p.status, p.weight_kg,
          p.shipped_at, p.available_at, p.collected_at
        FROM parcels p
        WHERE p.order_id = ANY($1)
        ORDER BY p.created_at ASC
      `, [orderIds]);

      for (const parcel of parcelsResult.rows) {
        if (!parcelsByOrder[parcel.order_id]) parcelsByOrder[parcel.order_id] = [];
        parcelsByOrder[parcel.order_id].push({
          reference: parcel.reference,
          status: parcel.status,
          weightKg: parcel.weight_kg,
          shippedAt: parcel.shipped_at,
          availableAt: parcel.available_at,
          collectedAt: parcel.collected_at
        });
      }
    }

    const STATUS_LABELS = {
      ordered: 'Commande confirmée',
      confirmed: 'Commande confirmée',
      preparation: 'En préparation',
      shipped: 'Expédiée',
      in_transit: 'En transit',
      arrived: 'Arrivée au relais',
      available: 'Disponible au retrait',
      collected: 'Retirée',
      delivered: 'Livrée',
      cancelled: 'Annulée',
      refunded: 'Remboursée'
    };

    const orders = ordersResult.rows.map(o => ({
      id: o.id,
      reference: o.reference,
      status: o.status,
      statusLabel: STATUS_LABELS[o.status] || o.status,
      totalKmf: o.total_kmf,
      paymentMode: o.payment_mode,
      paymentStatus: o.payment_status,
      destinationIsland: o.destination_island,
      createdAt: o.created_at,
      qrToken: o.qr_token,
      recipient: {
        name: o.recipient_name,
        phone: o.recipient_phone,
        relais: o.relais_name
      },
      items: itemsByOrder[o.id] || [],
      parcels: parcelsByOrder[o.id] || []
    }));

    res.json({ orders: orders });
  } catch (err) {
    log.error('Client orders error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

/**
 * GET /api/client/invoices
 * Get authenticated client's invoices
 */
router.get('/invoices', requireClientAuth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        i.id, i.invoice_number, i.order_id,
        i.client_name, i.client_phone,
        i.relay_name, i.items_snapshot,
        i.subtotal_kmf, i.shipping_kmf, i.total_kmf,
        i.payment_mode, i.payment_status,
        i.delivered_at, i.created_at,
        o.reference AS order_reference
      FROM invoices i
      JOIN orders o ON o.id = i.order_id
      WHERE o.user_id = $1
      ORDER BY i.created_at DESC
    `, [req.clientUserId]);

    const invoices = result.rows.map(inv => ({
      id: inv.id,
      invoiceNumber: inv.invoice_number,
      orderReference: inv.order_reference,
      clientName: inv.client_name,
      relayName: inv.relay_name,
      items: inv.items_snapshot,
      subtotalKmf: inv.subtotal_kmf,
      shippingKmf: inv.shipping_kmf,
      totalKmf: inv.total_kmf,
      paymentMode: inv.payment_mode,
      paymentStatus: inv.payment_status,
      deliveredAt: inv.delivered_at,
      createdAt: inv.created_at
    }));

    res.json({ invoices: invoices });
  } catch (err) {
    log.error('Client invoices error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
