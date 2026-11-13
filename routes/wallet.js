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
 *   POST /api/wallet/apply        — refus (wallet appliqué exclusivement au checkout)
 *   POST /api/wallet/remove       — refus (restitution via annulation métier uniquement)
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
    const [balance, balances, expiryRes] = await Promise.all([
      walletService.getBalance(req.user.id),
      walletService.getBalancesByCurrency(req.user.id),
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
    res.json({ balance_kmf: balance, balances, user_id: req.user.id, expires_at: expiresAt });
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

// POST /api/wallet/apply — verrou de sécurité FA-02/FA-15 : pas de débit après création
router.post('/apply', async (req, res, next) => {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const { order_id } = req.body;
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

    // FA-02/FA-15 : orders.total_kmf et FX sont figés nets du wallet au checkout.
    // Une application ultérieure débiterait le wallet SANS réduire l'encaissement
    // cash/PSP ; l'autorité unique est POST /api/orders avec use_wallet.
    await client.query('ROLLBACK');
    return res.status(409).json({
      code: 'WALLET_CHECKOUT_ONLY',
      error: 'Wallet applicable uniquement pendant la création de commande. Pour changer le paiement, recréez la commande.',
    });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.statusCode === 409) {
      return res.status(409).json({
        error: err.message,
        ...(err.items ? { items: err.items } : {}),
      });
    }
    next(err);
  } finally { client.release(); }
});

// POST /api/wallet/remove — verrou de sécurité FA-01 : restitution via annulation
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
    // P5-N2 + FA-01 — après 'paid', interdit ; avant 'paid', le verrou
    // checkout-only plus bas interdit aussi une restitution isolée.
    if (orderCheck.payment_status === 'paid') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Commande déjà payée — retrait wallet impossible via cette route' });
    }

    // FA-01 : le checkout stocke un montant PSP/cash NET du wallet.
    // La restitution isolée laisserait un total à encaisser trop faible.
    // Seule la machine d'annulation contre-passe wallet ET cycle commande
    // dans une transaction. Cette route legacy reste protégée et refusée.
    await client.query('ROLLBACK');
    return res.status(409).json({
      code: 'WALLET_REVERSAL_REQUIRES_CANCELLATION',
      error: 'Le wallet ne peut être restitué séparément : annulez la commande selon le parcours métier.',
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
    const detail = await walletService.getWalletDetail(req.params.userId, req.query.currency);
    if (!detail) return res.status(404).json({ error: 'Wallet introuvable' });
    res.json(detail);
  } catch (err) { next(err); }
});

// POST /api/wallet/admin/credit — crédit manuel admin
router.post('/admin/credit', requireAdmin, async (req, res, next) => {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const { user_id, reason, note, expires_days } = req.body;
    // Compat KMF : `amount_kmf` seul = KMF. Nouveau contrat : `amount` + `currency` (devise du marché du bénéficiaire).
    const hasAmount = req.body.amount !== undefined;
    const amount_kmf = hasAmount ? req.body.amount : req.body.amount_kmf;
    let walletCurrency = 'KMF';
    if (hasAmount) {
      try { walletCurrency = walletService.normalizeWalletCurrency(req.body.currency); } catch (e) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'currency (code ISO 3 lettres) requise avec amount' });
      }
      if (!req.body.currency || (req.body.amount_kmf !== undefined && walletCurrency !== 'KMF')) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'currency requise avec amount ; amount_kmf est réservé au KMF' });
      }
    }
    const rawKey = req.get('Idempotency-Key') || req.body.idempotency_key;
    const callerKey = typeof rawKey === 'string' ? rawKey.trim() : '';

    if (!user_id || !Number.isInteger(amount_kmf) || amount_kmf <= 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'user_id et amount (ou amount_kmf) — entier > 0 — requis' });
    }
    if (!callerKey || callerKey.length > 200) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Idempotency-Key (header ou idempotency_key) requis' });
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
      currency:       walletCurrency,
      reason:         reason || 'admin_gift',
      note:           note || 'Crédit manuel admin',
      createdBy:      req.user.id,
      expiresAt,
      idempotencyKey: `admin_credit:${user_id}:${callerKey}`,
    });
    await client.query('COMMIT');

    // Reçu wallet (post-commit, non bloquant) — crédit manuel significatif
    if (result.transaction?.id && !result.duplicate) {
      walletReceiptService.issue(result.transaction.id, { issuedBy: req.user.id }).catch(err => {
        log.warn({ err, tx_id: result.transaction.id }, '[wallet] émission reçu crédit manuel échouée (non-fatal)');
      });
    }

    res.status(result.duplicate ? 200 : 201).json({
      success: true,
      idempotent: !!result.duplicate,
      message: `${Number(amount_kmf).toLocaleString('fr-FR')} ${walletCurrency} crédités à ${user.full_name}`,
      transaction: result.transaction,
      lot:         result.lot,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally { client.release(); }
});

// POST /api/wallet/admin/order-credit/:orderId — legacy fermé (FA-06).
// Cette route créait un crédit arbitraire sur une commande payée ou non,
// sans prise en compte des remboursements existants et en confondant KMF/XAF.
// L'autorité de remboursement est /api/admin/orders/:id/refund, pas un writer
// wallet concurrent. Les crédits commerciaux admin directs restent distincts.
router.post('/admin/order-credit/:orderId', requireAdmin, (_req, res) => {
  return res.status(409).json({
    code: 'LEGACY_ORDER_CREDIT_DISABLED',
    error: 'Avoir depuis commande désactivé : utilisez le remboursement admin canonique.',
  });
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

