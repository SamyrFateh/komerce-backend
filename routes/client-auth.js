'use strict';

const express = require('express');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const router = express.Router();
const pool = require('../db');
const { sendMagicLink } = require('../services/notification-service');
const log = require('../utils/logger').child({ module: 'client-auth' });

function maskPhone(phone) {
  if (!phone) return null;
  const raw = String(phone);
  if (raw.length <= 4) return '****';
  return raw.slice(0, 4) + '******' + raw.slice(-2);
}

function canEchoMagicLink() {
  return process.env.NODE_ENV === 'development' && process.env.MAGIC_LINK_DEV_ECHO === 'true';
}

/**
 * POST /api/auth/magic-link
 * Request a magic link — generates token and returns success
 * In production, this would send via WhatsApp/SMS
 */
router.post('/magic-link', async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ success: false, error: 'Numéro de téléphone requis' });

    // Find user by phone
    const userResult = await pool.query(
      `SELECT id, full_name, phone, role FROM users WHERE phone = $1 AND role = 'client'`,
      [phone]
    );

    if (userResult.rows.length === 0) {
      // Don't reveal if user exists
      return res.json({ success: true, message: 'Si ce numéro est enregistré, vous recevrez un lien de connexion.' });
    }

    const user = userResult.rows[0];

    // Generate magic token (32 chars, URL-safe)
    const magicToken = crypto.randomBytes(24).toString('base64url');
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    await pool.query(
      `UPDATE users SET magic_token = $1, magic_token_expires_at = $2 WHERE id = $3`,
      [magicToken, expiresAt, user.id]
    );

    const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
    const magicLink = `${baseUrl}/mon-compte?token=${magicToken}`;

    log.info('[magic-link] Generated', { userId: user.id, phone: maskPhone(user.phone) });
    if (canEchoMagicLink()) {
      log.info('[magic-link][dev] URL:', magicLink);
    }

    // Envoyer le lien via WhatsApp (AuthKey)
    const waResult = await sendMagicLink({
      phone: user.phone,
      name: user.full_name,
      magicLink,
      expiryMin: 15,
    });

    log.info('[magic-link] Send result:', {
      userId: user.id,
      phone: maskPhone(user.phone),
      success: waResult.success,
      channel: waResult.channel,
      reason: waResult.reason,
    });

    res.json({
      success: true,
      message: waResult.success
        ? 'Lien de connexion envoyé par WhatsApp !'
        : 'Si ce numéro est enregistré, vous recevrez un lien de connexion.',
      // DEV ONLY : exposé uniquement en dev local explicite
      _dev_link: canEchoMagicLink() ? magicLink : undefined,
    });
  } catch (err) {
    log.error('Magic link request error:', err);
    res.status(500).json({ success: false, error: 'Erreur serveur' });
  }
});

/**
 * GET /api/auth/magic-link/validate
 * Validate magic token, create session, redirect to /mon-compte
 */
router.get('/magic-link/validate', async (req, res) => {
  try {
    const { token } = req.query;
    if (!token) return res.redirect('/mon-compte?error=token_missing');

    const result = await pool.query(
      `SELECT id, full_name, phone, email, role FROM users 
       WHERE magic_token = $1 AND magic_token_expires_at > NOW() AND role = 'client'`,
      [token]
    );

    if (result.rows.length === 0) {
      return res.redirect('/mon-compte?error=token_invalid');
    }

    const user = result.rows[0];

    // Invalidate the magic token (single use)
    await pool.query(
      `UPDATE users SET magic_token = NULL, magic_token_expires_at = NULL WHERE id = $1`,
      [user.id]
    );

    // Create JWT session (30 days)
    const jwtToken = jwt.sign(
      { id: user.id, role: user.role, fullName: user.full_name },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.cookie('kmrc_jwt', jwtToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
    });

    log.info('[magic-link] Login success', { userId: user.id, phone: maskPhone(user.phone) });
    res.redirect('/mon-compte');
  } catch (err) {
    log.error('Magic link validate error:', err);
    res.redirect('/mon-compte?error=server_error');
  }
});

/**
 * GET /api/client/orders
 * Returns orders for the authenticated client
 */
router.get('/orders', async (req, res) => {
  try {
    // Get user from JWT cookie
    const token = req.cookies?.kmrc_jwt;
    if (!token) return res.status(401).json({ error: 'Non authentifié' });

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    } catch (e) {
      return res.status(401).json({ error: 'Session expirée' });
    }

    const { rows: orders } = await pool.query(`
      SELECT 
        o.id, o.reference, o.status, o.total_kmf,
        o.payment_mode, o.payment_status,
        o.qr_token,
        o.created_at, o.shipped_at, o.available_at, o.collected_at,
        r.name AS relais_name
      FROM orders o
      LEFT JOIN relais r ON r.id = o.relais_id
      WHERE o.user_id = $1
      ORDER BY o.created_at DESC
    `, [decoded.id]);

    // Get items + parcels for each order
    for (const order of orders) {
      const { rows: items } = await pool.query(`
        SELECT oi.quantity, oi.price_kmf, p.name, p.emoji
        FROM order_items oi
        JOIN products p ON p.id = oi.product_id
        WHERE oi.order_id = $1
      `, [order.id]);
      order.items = items.map(i => ({
        name: i.name, emoji: i.emoji,
        quantity: i.quantity, priceKmf: i.price_kmf
      }));

      const { rows: parcels } = await pool.query(`
        SELECT id, reference, status, weight_kg
        FROM parcels WHERE order_id = $1
        ORDER BY created_at ASC
      `, [order.id]);
      order.parcels = parcels;

      // Map fields for frontend
      order.totalKmf = order.total_kmf;
      order.qrToken = order.qr_token;
      order.createdAt = order.created_at;
      order.statusLabel = getStatusLabel(order.status);
    }

    res.json({ orders });
  } catch (err) {
    log.error('Client orders error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

/**
 * GET /api/client/invoices
 * Returns invoices for the authenticated client
 */
router.get('/invoices', async (req, res) => {
  try {
    const token = req.cookies?.kmrc_jwt;
    if (!token) return res.status(401).json({ error: 'Non authentifié' });

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    } catch (e) {
      return res.status(401).json({ error: 'Session expirée' });
    }

    const { rows: invoices } = await pool.query(`
      SELECT 
        inv.id, inv.invoice_number, inv.order_id,
        inv.subtotal_kmf, inv.shipping_kmf, inv.total_kmf,
        inv.payment_mode, inv.created_at,
        o.reference AS order_reference
      FROM invoices inv
      JOIN orders o ON o.id = inv.order_id
      WHERE o.user_id = $1
      ORDER BY inv.created_at DESC
    `, [decoded.id]);

    res.json({
      invoices: invoices.map(inv => ({
        invoiceNumber: inv.invoice_number,
        orderReference: inv.order_reference,
        subtotalKmf: inv.subtotal_kmf,
        shippingKmf: inv.shipping_kmf,
        totalKmf: inv.total_kmf,
        paymentMode: inv.payment_mode,
        createdAt: inv.created_at
      }))
    });
  } catch (err) {
    log.error('Client invoices error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

function getStatusLabel(status) {
  const labels = {
    ordered: 'Confirmée', confirmed: 'Confirmée', preparation: 'En préparation',
    shipped: 'Expédiée', in_transit: 'En transit', arrived: 'Arrivée',
    available: 'Disponible', collected: 'Retirée', delivered: 'Livrée',
    cancelled: 'Annulée', refunded: 'Remboursée'
  };
  return labels[status] || status;
}

module.exports = router;
