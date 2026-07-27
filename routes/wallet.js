/**
 * @komerce-arch
 * @role          wallet-http-facade
 * @domain        wallet
 * @layer         route
 * @criticality   high
 * @inputs        client_session, wallet_mutation, order_reference
 * @outputs       wallet_balance, ledger_entries, wallet_application_result
 * @depends       services/wallet-service.js, middleware/auth.js, db.js
 * @used-by       bootstrap/api-routes.js, public/boutique/js/b-checkout.js, dashboards
 * @db-read       orders, users, wallet_credit_lots, wallets
 * @db-write      wallet_consumptions, wallet_credit_lots, wallet_transactions, wallets
 * @db-write-via:wallet-receipt transaction_documents
 * @db-txn        ledger_append_only, credit_debit_idempotent
 * @doctrine      wallet_ledger_trace, credit_debit_idempotent, wallet_non_cadeau_cache
 * @impact-areas  checkout, wallet, orders, refunds, admin-dashboard
 * @version       2026-06
 */

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
 *   POST /api/wallet/admin/reverse-lot            — annuler un lot (Phase 5)
 */

'use strict';

const express       = require('express');
const router        = express.Router();
const db            = require('../db');
const { authenticate } = require('../middleware/auth');
const walletService = require('../services/wallet-service');
const walletReceiptService = require('../services/documents/wallet-receipt');
const log = require('../utils/logger').child({ module: 'wallet-routes' });

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
    const [balance, expiryRes] = await Promise.all([
      walletService.getBalance(req.user.id),
      db.query(
        `SELECT MIN(wcl.expires_at) AS expires_at
         FROM wallet_credit_lots wcl
         JOIN wallets w ON w.id = wcl.wallet_id
         WHERE w.user_id = $1
           AND wcl.status = 'active'
           AND wcl.remaining_kmf > 0
           AND wcl.expires_at IS NOT NULL`,
        [req.user.id]
      ),
    ]);
    const expiresAt = expiryRes.rows[0]?.expires_at ?? null;
    res.json({ balance_kmf: balance, user_id: req.user.id, expires_at: expiresAt });
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
    if (!order_id) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'order_id requis' });
    }

    // NEW-01 — Guard IDOR : vérifier que la commande appartient à l'utilisateur connecté
    const { rows: [orderCheck] } = await client.query(
      'SELECT user_id, payment_status, status FROM orders WHERE id = $1', [order_id]
    );
    if (!orderCheck) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Commande introuvable' });
    }
    if (String(orderCheck.user_id) !== String(req.user.id)) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Cette commande ne vous appartient pas' });
    }
    if (orderCheck.payment_status === 'paid') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Commande déjà payée' });
    }
    // R2 FIX — Guard order.status : bloquer les statuts terminaux
    const BLOCKED_STATUSES = ['cancelled', 'refunded', 'collected'];
    if (BLOCKED_STATUSES.includes(orderCheck.status)) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: `Application impossible — commande en statut '${orderCheck.status}'` });
    }

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
    if (!order_id) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'order_id requis' });
    }

    // NEW-02 — Guard IDOR : vérifier que la commande appartient à l'utilisateur connecté.
    // FOR UPDATE : verrouille la commande le temps de la décision, pour éviter
    // une course avec une confirmation de paiement concurrente (webhook, etc.)
    // qui rendrait le retrait self-service illégitime entre la lecture et l'écriture.
    const { rows: [orderCheck] } = await client.query(
      'SELECT user_id, payment_status FROM orders WHERE id = $1 FOR UPDATE', [order_id]
    );
    if (!orderCheck) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Commande introuvable' });
    }
    if (String(orderCheck.user_id) !== String(req.user.id)) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Cette commande ne vous appartient pas' });
    }
    // P5-N2 (§7) — retrait self-service autorisé uniquement avant paiement confirmé.
    // Après 'paid', seul le chemin d'annulation métier (order-status-machine →
    // removeFromOrder) peut re-créditer le wallet ; l'API self-service n'y touche plus.
    if (orderCheck.payment_status === 'paid') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Commande déjà payée — retrait wallet impossible via cette route' });
    }

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
      await client.query('ROLLBACK');
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

    // Reçu wallet (post-commit, non bloquant) — crédit manuel significatif
    if (result.transaction?.id && !result.duplicate) {
      walletReceiptService.issue(result.transaction.id, { issuedBy: req.user.id }).catch(err => {
        log.warn({ err, tx_id: result.transaction.id }, '[wallet] émission reçu crédit manuel échouée (non-fatal)');
      });
    }

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

    // Reçu wallet (post-commit, non bloquant) — avoir depuis commande
    if (result.transaction?.id) {
      walletReceiptService.issue(result.transaction.id, { issuedBy: req.user.id }).catch(err => {
        log.warn({ err, tx_id: result.transaction.id }, '[wallet] émission reçu order-credit échouée (non-fatal)');
      });
    }

    res.status(201).json({ success: true, message: 'Avoir créé', ...result });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally { client.release(); }
});


// POST /api/wallet/admin/reverse-lot — annuler un lot de crédit (Phase 5)
// BLOQUÉ si le lot a été consommé (même partiellement).
router.post('/admin/reverse-lot', requireAdmin, async (req, res, next) => {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const { lot_id, note } = req.body;
    if (!lot_id) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'lot_id requis' });
    }

    const result = await walletService.reverseLot(client, {
      lotId:   lot_id,
      adminId: req.user.id,
      note,
    });
    await client.query('COMMIT');

    // Reçu wallet (post-commit, non bloquant) — reversal significatif
    if (result.walletTxId) {
      walletReceiptService.issue(result.walletTxId, { issuedBy: req.user.id }).catch(err => {
        log.warn({ err, tx_id: result.walletTxId }, '[wallet] émission reçu reversal échouée (non-fatal)');
      });
    }

    res.json({
      success:      true,
      message:      `${result.reversed_kmf} KMF annulés`,
      reversed_kmf: result.reversed_kmf,
      transaction:  result.transaction,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    // Business rule errors → 422
    if (err.message.includes('consommé') || err.message.includes('introuvable')
        || err.message.includes('négatif') || err.message.includes('annulé')
        || err.message.includes('impossible')) {
      return res.status(422).json({ error: err.message });
    }
    next(err);
  } finally { client.release(); }
});

module.exports = router;

