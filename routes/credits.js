/**
 * KOMERCE — Credits (Avoirs) API
 *
 * GET  /api/credits          — liste des avoirs (client: les siens, admin: tous)
 * GET  /api/credits/balance  — solde rapide
 * POST /api/credits          — admin: créer un avoir manuel (compensation)
 */

'use strict';

const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const { createStoreCredit, getAvailableCredits } = require('../utils/store-credits');

// ─── GET /api/credits ────────────────────────────────────────────────────────
// Client → ses propres avoirs
// Admin  → tous les avoirs (optionnel ?user_id=xxx pour filtrer)

router.get('/', authenticate, async (req, res, next) => {
  try {
    const isAdmin = req.user.role === 'admin';
    let query, params;

    if (isAdmin) {
      const userId = req.query.user_id;
      if (userId) {
        query = `
          SELECT sc.*, u.full_name AS user_name, u.phone AS user_phone,
                 o.reference AS source_order_ref
          FROM store_credits sc
          LEFT JOIN users u ON u.id = sc.user_id
          LEFT JOIN orders o ON o.id = sc.source_order_id
          WHERE sc.user_id = $1
          ORDER BY sc.created_at DESC`;
        params = [userId];
      } else {
        query = `
          SELECT sc.*, u.full_name AS user_name, u.phone AS user_phone,
                 o.reference AS source_order_ref
          FROM store_credits sc
          LEFT JOIN users u ON u.id = sc.user_id
          LEFT JOIN orders o ON o.id = sc.source_order_id
          ORDER BY sc.created_at DESC
          LIMIT 200`;
        params = [];
      }
    } else {
      query = `
        SELECT sc.*, o.reference AS source_order_ref
        FROM store_credits sc
        LEFT JOIN orders o ON o.id = sc.source_order_id
        WHERE sc.user_id = $1
        ORDER BY sc.created_at DESC`;
      params = [req.user.id];
    }

    const { rows } = await db.query(query, params);

    // Enrichir avec le statut calculé
    const credits = rows.map(c => ({
      ...c,
      computed_status: c.remaining_kmf <= 0 ? 'used'
        : (c.expires_at && new Date(c.expires_at) < new Date()) ? 'expired'
        : 'active',
    }));

    // Statistiques
    const active   = credits.filter(c => c.computed_status === 'active');
    const totalActive = active.reduce((sum, c) => sum + c.remaining_kmf, 0);

    res.json({
      credits,
      stats: {
        total:        credits.length,
        active_count: active.length,
        active_kmf:   totalActive,
        used_count:   credits.filter(c => c.computed_status === 'used').length,
        expired_count: credits.filter(c => c.computed_status === 'expired').length,
      },
    });
  } catch (err) { next(err); }
});

// ─── GET /api/credits/balance ────────────────────────────────────────────────
// Solde rapide pour le client connecté (ou ?user_id=xxx pour admin)

router.get('/balance', authenticate, async (req, res, next) => {
  try {
    const isAdmin = req.user.role === 'admin';
    const userId  = (isAdmin && req.query.user_id) ? req.query.user_id : req.user.id;

    const { credits, total_kmf } = await getAvailableCredits(db, userId);

    res.json({
      user_id:        userId,
      balance_kmf:    total_kmf,
      active_credits: credits.length,
    });
  } catch (err) { next(err); }
});

// ─── POST /api/credits ───────────────────────────────────────────────────────
// Admin uniquement — créer un avoir manuel (compensation, geste commercial)
// Body: { user_id, amount_kmf, reason?, expires_days? }

router.post('/', authenticate, requireRole(['admin']), async (req, res, next) => {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    const { user_id, amount_kmf, reason, expires_days } = req.body;

    if (!user_id || !amount_kmf) {
      return res.status(400).json({ error: 'user_id et amount_kmf obligatoires' });
    }
    if (amount_kmf <= 0) {
      return res.status(400).json({ error: 'amount_kmf doit être > 0' });
    }

    // Vérifier que l'utilisateur existe
    const { rows: [user] } = await client.query(
      'SELECT id, full_name, phone FROM users WHERE id = $1', [user_id]
    );
    if (!user) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Utilisateur introuvable' });
    }

    const expiresAt = expires_days
      ? new Date(Date.now() + expires_days * 24 * 60 * 60 * 1000)
      : null;

    const credit = await createStoreCredit(client, {
      userId:        user_id,
      amountKmf:     amount_kmf,
      reason:        reason || 'manual_compensation',
      sourceOrderId: null,
      expiresAt,
    });

    await client.query('COMMIT');

    res.status(201).json({
      success: true,
      credit: {
        ...credit,
        user_name: user.full_name,
        user_phone: user.phone,
      },
      message: `Avoir de ${Number(amount_kmf).toLocaleString('fr-FR')} KMF créé pour ${user.full_name}`,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

module.exports = router;
