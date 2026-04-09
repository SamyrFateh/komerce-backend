/**
 * KOMERCE — Wallet API v1.0
 *
 * Remplace routes/credits.js.
 *
 * Client :
 *   GET  /api/wallet              — solde
 *   GET  /api/wallet/transactions — historique
 *   POST /api/wallet/apply        — appliquer wallet à commande (checkout)
 *   POST /api/wallet/remove       — retirer wallet d'une commande
 *
 * Admin :
 *   GET  /api/wallet/admin            — liste tous les wallets
 *   GET  /api/wallet/admin/:userId    — détail d'un wallet
 *   POST /api/wallet/admin/credit     — crédit manuel (geste commercial)
 *   POST /api/wallet/admin/order-credit/:orderId — avoir depuis commande
 */

'use strict';

const express       = require('express');
const router        = express.Router();
const db            = require('../db');
const { authenticate } = require('../middleware/auth');
const walletService = require('../services/wallet-service');

router.use(authenticate);

// ── Helper admin ────────────────────────────────────────────────────────────
function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin requis' });
  next();
}

// ═══════════════════════════════════════════════════════════════════════════════
// CLIENT
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/wallet — solde
router.get('/', async (req, res, next) => {
  try {
    const balance = await walletService.getBalance(req.user.id);
    res.json({ balance_kmf: balance, user_id: req.user.id });
  } catch (err) { next(err); }
});

// GET /api/wallet/transactions — historique
router.get('/transactions', async (req, res, next) => {
  try {
    const limit  = Math.min(parseInt(req.query.limit)  || 20, 100);
    const offset = parseInt(req.query.offset) || 0;
    const result = await walletService.getTransactions(req.user.id, { limit, offset });
    res.json(result);
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// CHECKOUT
// ═══════════════════════════════════════════════════════════════════════════════

// POST /api/wallet/apply — appliquer wallet à une commande
router.post('/apply', async (req, res, next) => {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const { order_id, amount_kmf } = req.body;
    if (!order_id) return res.status(400).json({ error: 'order_id requis' });

    const result = await walletService.applyToOrder(client, {
      userId:    req.user.id,
      orderId:   order_id,
      amountKmf: amount_kmf,
    });
    await client.query('COMMIT');

    res.json({
      message:          `${result.applied_kmf} KMF appliqués`,
      applied_kmf:      result.applied_kmf,
      remaining_to_pay: result.remaining_to_pay,
      transaction:      result.transaction,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally { client.release(); }
});

// POST /api/wallet/remove — retirer wallet d'une commande
router.post('/remove', async (req, res, next) => {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const { order_id } = req.body;
    if (!order_id) return res.status(400).json({ error: 'order_id requis' });

    const result = await walletService.removeFromOrder(client, { orderId: order_id });
    await client.query('COMMIT');

    res.json({
      message:      `${result.reversed_kmf} KMF remboursés au wallet`,
      reversed_kmf: result.reversed_kmf,
      transaction:  result.transaction,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally { client.release(); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ADMIN
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/wallet/admin — liste tous les wallets
router.get('/admin', requireAdmin, async (req, res, next) => {
  try {
    const limit  = Math.min(parseInt(req.query.limit)  || 50, 100);
    const offset = parseInt(req.query.offset) || 0;
    const search = req.query.search || null;
    const result = await walletService.listWallets({ limit, offset, search });
    res.json(result);
  } catch (err) { next(err); }
});

// GET /api/wallet/admin/:userId — détail d'un wallet
router.get('/admin/:userId', requireAdmin, async (req, res, next) => {
  try {
    const detail = await walletService.getWalletDetail(req.params.userId);
    if (!detail) return res.status(404).json({ error: 'Wallet introuvable' });
    res.json(detail);
  } catch (err) { next(err); }
});

// POST /api/wallet/admin/credit — crédit manuel admin
router.post('/admin/credit', requireAdmin, async (req, res, next) => {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const { user_id, amount_kmf, reason, note, expires_days } = req.body;

    if (!user_id || !amount_kmf || amount_kmf <= 0) {
      return res.status(400).json({ error: 'user_id et amount_kmf (> 0) requis' });
    }

    const { rows: [user] } = await client.query(
      'SELECT id, full_name, phone FROM users WHERE id = $1', [user_id]
    );
    if (!user) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Utilisateur introuvable' });
    }

    const expiresAt = expires_days
      ? new Date(Date.now() + expires_days * 86400000)
      : null;

    const result = await walletService.credit(client, {
      userId:         user_id,
      amountKmf:      amount_kmf,
      reason:         reason || 'admin_gift',
      note:           note || 'Crédit manuel admin',
      createdBy:      req.user.id,
      expiresAt,
      idempotencyKey: `admin_${user_id}_${Date.now()}`,
    });
    await client.query('COMMIT');

    res.status(201).json({
      success: true,
      message: `${Number(amount_kmf).toLocaleString('fr-FR')} KMF crédités à ${user.full_name}`,
      transaction: result.transaction,
      lot:         result.lot,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally { client.release(); }
});

// POST /api/wallet/admin/order-credit/:orderId — avoir depuis commande annulée
router.post('/admin/order-credit/:orderId', requireAdmin, async (req, res, next) => {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    const result = await walletService.createCreditFromCancel(client, {
      orderId: req.params.orderId,
      adminId: req.user.id,
    });

    if (result.duplicate) {
      await client.query('ROLLBACK');
      return res.json({ message: 'Avoir déjà créé (idempotent)', transaction: result.transaction });
    }

    await client.query('COMMIT');
    res.status(201).json({ success: true, message: 'Avoir créé', ...result });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally { client.release(); }
});

module.exports = router;

