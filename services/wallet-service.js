/**
 * KOMERCE — Wallet Service v1.2 (F23 race fix) (Phase 5: reverseLot with consumption guard)
 *
 * Système de portefeuille client unifié.
 * Remplace l'ancien système store_credits.
 *
 * Tables : wallets, wallet_transactions, wallet_credit_lots, wallet_consumptions
 *
 * Principes :
 *   - 1 wallet par user (lazy creation)
 *   - Transactions immutables (contrepassation uniquement, pas de suppression)
 *   - Consommation FIFO des lots de crédit
 *   - Idempotence sur les créations automatiques
 *   - Traçabilité complète
 */

'use strict';

const db = require('../db');

// ── Schema Migration ────────────────────────────────────────────────────────
async function ensureWalletTables() {
  const client = await db.getClient();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS wallets (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
        balance_kmf INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS wallet_transactions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        wallet_id UUID NOT NULL REFERENCES wallets(id),
        type VARCHAR(20) NOT NULL CHECK (type IN ('credit','debit','reversal','expiration')),
        amount_kmf INTEGER NOT NULL CHECK (amount_kmf > 0),
        balance_after_kmf INTEGER NOT NULL,
        reason VARCHAR(50) NOT NULL,
        reference_id UUID,
        idempotency_key VARCHAR(100),
        note TEXT,
        metadata JSONB DEFAULT '{}',
        created_by UUID,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS wallet_credit_lots (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        wallet_id UUID NOT NULL REFERENCES wallets(id),
        transaction_id UUID NOT NULL REFERENCES wallet_transactions(id),
        original_amount_kmf INTEGER NOT NULL,
        remaining_kmf INTEGER NOT NULL CHECK (remaining_kmf >= 0),
        reason VARCHAR(50) NOT NULL,
        source_order_id UUID,
        expires_at TIMESTAMPTZ,
        status VARCHAR(20) NOT NULL DEFAULT 'active'
          CHECK (status IN ('active','used','expired','reversed')),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS wallet_consumptions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        order_id UUID NOT NULL,
        credit_lot_id UUID NOT NULL REFERENCES wallet_credit_lots(id),
        transaction_id UUID NOT NULL REFERENCES wallet_transactions(id),
        amount_kmf INTEGER NOT NULL CHECK (amount_kmf > 0),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_wallets_user
        ON wallets(user_id);
      CREATE INDEX IF NOT EXISTS idx_wtx_wallet
        ON wallet_transactions(wallet_id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_wtx_idempotency
        ON wallet_transactions(idempotency_key)
        WHERE idempotency_key IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_wlots_wallet_active
        ON wallet_credit_lots(wallet_id) WHERE status = 'active';
      CREATE INDEX IF NOT EXISTS idx_wcons_order
        ON wallet_consumptions(order_id);

      ALTER TABLE orders ADD COLUMN IF NOT EXISTS wallet_applied_kmf INTEGER DEFAULT 0;
    `);
    console.log('✅ Wallet tables ready');
  } catch (err) {
    console.error('⚠️ Wallet migration error:', err.message);
  } finally {
    client.release();
  }
}

// ── Core : Get or Create Wallet ─────────────────────────────────────────────
async function getOrCreateWallet(client, userId, { forUpdate = false } = {}) {
  const lock = forUpdate ? ' FOR UPDATE' : '';
  const { rows } = await client.query(
    `SELECT * FROM wallets WHERE user_id = $1${lock}`, [userId]
  );
  if (rows.length) return rows[0];

  const res = await client.query(
    `INSERT INTO wallets (user_id)
     VALUES ($1)
     ON CONFLICT (user_id) DO UPDATE SET updated_at = NOW()
     RETURNING *`,
    [userId]
  );
  return res.rows[0];
}

// ── Credit : Ajouter un avoir au wallet ─────────────────────────────────────
async function credit(client, opts) {
  const {
    userId, amountKmf, reason, referenceId,
    idempotencyKey, note, metadata, expiresAt, createdBy,
  } = opts;

  // Idempotence
  if (idempotencyKey) {
    const dup = await client.query(
      'SELECT * FROM wallet_transactions WHERE idempotency_key = $1',
      [idempotencyKey]
    );
    if (dup.rows.length) return { transaction: dup.rows[0], duplicate: true };
  }

  const wallet = await getOrCreateWallet(client, userId, { forUpdate: true });

  // F23 fix: atomic update prevents race conditions
  const { rows: [updatedW] } = await client.query(
    'UPDATE wallets SET balance_kmf = balance_kmf + $1, updated_at = NOW() WHERE id = $2 RETURNING balance_kmf',
    [amountKmf, wallet.id]
  );
  const newBalance = updatedW.balance_kmf;

  const txRes = await client.query(`
    INSERT INTO wallet_transactions
      (wallet_id, type, amount_kmf, balance_after_kmf,
       reason, reference_id, idempotency_key, note, metadata, created_by)
    VALUES ($1,'credit',$2,$3,$4,$5,$6,$7,$8::jsonb,$9)
    RETURNING *
  `, [
    wallet.id, amountKmf, newBalance, reason,
    referenceId || null, idempotencyKey || null,
    note || null, JSON.stringify(metadata || {}),
    createdBy || null,
  ]);
  const tx = txRes.rows[0];

  const lotRes = await client.query(`
    INSERT INTO wallet_credit_lots
      (wallet_id, transaction_id, original_amount_kmf, remaining_kmf,
       reason, source_order_id, expires_at)
    VALUES ($1,$2,$3,$3,$4,$5,$6)
    RETURNING *
  `, [wallet.id, tx.id, amountKmf, reason, referenceId || null, expiresAt || null]);

  return { transaction: tx, lot: lotRes.rows[0], duplicate: false };
}

// ── Debit : Consommation FIFO des lots ──────────────────────────────────────
async function debit(client, opts) {
  const {
    userId, amountKmf, reason, referenceId,
    idempotencyKey, note, metadata,
  } = opts;

  if (idempotencyKey) {
    const dup = await client.query(
      'SELECT * FROM wallet_transactions WHERE idempotency_key = $1',
      [idempotencyKey]
    );
    if (dup.rows.length) {
      return { transaction: dup.rows[0], consumptions: [], duplicate: true };
    }
  }

  const wallet = await getOrCreateWallet(client, userId, { forUpdate: true });
  if (wallet.balance_kmf < amountKmf) {
    throw new Error(
      `Solde insuffisant : ${wallet.balance_kmf} KMF dispo, ${amountKmf} KMF demandé`
    );
  }

  // F23 fix: atomic update prevents race conditions
  const { rows: [updatedW] } = await client.query(
    'UPDATE wallets SET balance_kmf = balance_kmf - $1, updated_at = NOW() WHERE id = $2 RETURNING balance_kmf',
    [amountKmf, wallet.id]
  );
  const newBalance = updatedW.balance_kmf;

  const txRes = await client.query(`
    INSERT INTO wallet_transactions
      (wallet_id, type, amount_kmf, balance_after_kmf,
       reason, reference_id, idempotency_key, note, metadata)
    VALUES ($1,'debit',$2,$3,$4,$5,$6,$7,$8::jsonb)
    RETURNING *
  `, [
    wallet.id, amountKmf, newBalance, reason,
    referenceId || null, idempotencyKey || null,
    note || null, JSON.stringify(metadata || {}),
  ]);
  const tx = txRes.rows[0];

  // FIFO — lots les plus anciens en premier
  const lots = await client.query(`
    SELECT * FROM wallet_credit_lots
    WHERE wallet_id = $1 AND status = 'active' AND remaining_kmf > 0
      AND (expires_at IS NULL OR expires_at > NOW())
    ORDER BY created_at ASC
    FOR UPDATE
  `, [wallet.id]);

  let remaining = amountKmf;
  const consumptions = [];

  for (const lot of lots.rows) {
    if (remaining <= 0) break;
    const consume      = Math.min(remaining, lot.remaining_kmf);
    const newRemaining = lot.remaining_kmf - consume;
    const newStatus    = newRemaining === 0 ? 'used' : 'active';

    await client.query(
      'UPDATE wallet_credit_lots SET remaining_kmf=$1, status=$2 WHERE id=$3',
      [newRemaining, newStatus, lot.id]
    );

    if (referenceId) {
      const cRes = await client.query(`
        INSERT INTO wallet_consumptions
          (order_id, credit_lot_id, transaction_id, amount_kmf)
        VALUES ($1,$2,$3,$4) RETURNING *
      `, [referenceId, lot.id, tx.id, consume]);
      consumptions.push(cRes.rows[0]);
    }
    remaining -= consume;
  }

  return { transaction: tx, consumptions, duplicate: false };
}

// ── Checkout : appliquer wallet à une commande ──────────────────────────────
async function applyToOrder(client, { userId, orderId, amountKmf }) {
  const { rows: [order] } = await client.query(
    'SELECT * FROM orders WHERE id = $1', [orderId]
  );
  if (!order) throw new Error('Commande introuvable');

  const wallet = await getOrCreateWallet(client, userId);
  const max    = Math.min(amountKmf || wallet.balance_kmf, wallet.balance_kmf, order.total_kmf);
  if (max <= 0) throw new Error('Rien à appliquer');

  const result = await debit(client, {
    userId,
    amountKmf:      max,
    reason:         'checkout',
    referenceId:    orderId,
    idempotencyKey: `checkout_${orderId}`,
    note:           `Appliqué à commande ${order.reference}`,
  });

  const remainingToPay = Math.max(0, order.total_kmf - max);
  await client.query(`
    UPDATE orders SET
      wallet_applied_kmf = $1,
      payment_status = CASE WHEN $2 <= 0 THEN 'paid' ELSE payment_status END,
      updated_at = NOW()
    WHERE id = $3
  `, [max, remainingToPay, orderId]);

  return { ...result, applied_kmf: max, remaining_to_pay: remainingToPay };
}

// ── Checkout reversal : retirer wallet d'une commande ───────────────────────
async function removeFromOrder(client, { orderId }) {
  const cRes = await client.query(`
    SELECT wc.*, wl.wallet_id
    FROM wallet_consumptions wc
    JOIN wallet_credit_lots wl ON wl.id = wc.credit_lot_id
    WHERE wc.order_id = $1
  `, [orderId]);
  if (!cRes.rows.length) throw new Error('Aucun crédit wallet sur cette commande');

  const walletId = cRes.rows[0].wallet_id;
  let totalReversed = 0;

  for (const c of cRes.rows) {
    await client.query(
      'UPDATE wallet_credit_lots SET remaining_kmf = remaining_kmf + $1, status = \'active\' WHERE id = $2',
      [c.amount_kmf, c.credit_lot_id]
    );
    totalReversed += c.amount_kmf;
  }
  await client.query('DELETE FROM wallet_consumptions WHERE order_id = $1', [orderId]);

  const wRes = await client.query(
    'UPDATE wallets SET balance_kmf = balance_kmf + $1, updated_at = NOW() WHERE id = $2 RETURNING *',
    [totalReversed, walletId]
  );

  const txRes = await client.query(`
    INSERT INTO wallet_transactions
      (wallet_id, type, amount_kmf, balance_after_kmf, reason, reference_id, note)
    VALUES ($1,'reversal',$2,$3,'checkout_reversal',$4,'Crédit retiré de la commande')
    RETURNING *
  `, [walletId, totalReversed, wRes.rows[0].balance_kmf, orderId]);

  await client.query(
    'UPDATE orders SET wallet_applied_kmf = 0, updated_at = NOW() WHERE id = $1',
    [orderId]
  );

  return { transaction: txRes.rows[0], reversed_kmf: totalReversed };
}

// ── Auto-credit depuis annulation ───────────────────────────────────────────
async function createCreditFromCancel(client, { orderId, adminId, amountKmf }) {
  const { rows: [order] } = await client.query(
    'SELECT * FROM orders WHERE id = $1', [orderId]
  );
  if (!order) throw new Error('Commande introuvable');

  return credit(client, {
    userId:         order.user_id,
    amountKmf:      amountKmf || order.total_kmf,
    reason:         'order_cancel',
    referenceId:    orderId,
    idempotencyKey: `cancel_${orderId}`,
    note:           `Avoir auto — annulation commande ${order.reference}`,
    createdBy:      adminId || null,
  });
}


// ── Reversal : annuler un lot de crédit (Phase 5 — D5) ─────────────────────
// RÈGLE : reversal BLOQUÉ si le lot a été consommé (même partiellement).
// Pour corriger une erreur sur un lot consommé, l'admin doit d'abord annuler
// la commande qui a utilisé le crédit (removeFromOrder), puis reverser le lot.
async function reverseLot(client, { lotId, adminId, note }) {
  // Load + lock the lot
  const { rows: [lot] } = await client.query(
    'SELECT * FROM wallet_credit_lots WHERE id = $1 FOR UPDATE',
    [lotId]
  );
  if (!lot) throw new Error('Lot introuvable');
  if (lot.status === 'reversed') throw new Error('Lot déjà annulé');
  if (lot.status !== 'active') throw new Error(`Lot ${lot.status} — reversal impossible`);

  // Phase 5 Decision: BLOCK if lot has ANY consumptions
  const { rows: [{ c: consumptionCount }] } = await client.query(
    'SELECT COUNT(*)::int AS c FROM wallet_consumptions WHERE credit_lot_id = $1',
    [lotId]
  );
  if (consumptionCount > 0) {
    throw new Error(
      `Lot partiellement/totalement consommé (${consumptionCount} consommation(s)). ` +
      `Reversal bloqué (décision D5). ` +
      `Pour corriger : annulez d'abord la commande → le wallet sera re-crédité → puis reversez le lot.`
    );
  }

  // Reverse: deduct from wallet balance
  const { rows: [w] } = await client.query(
    'SELECT * FROM wallets WHERE id = $1 FOR UPDATE',
    [lot.wallet_id]
  );
  const amountToReverse = lot.remaining_kmf;
  const newBalance = w.balance_kmf - amountToReverse;
  if (newBalance < 0) {
    throw new Error(
      `Reversal causerait un solde négatif (${w.balance_kmf} - ${amountToReverse} = ${newBalance}). ` +
      `Le client a probablement dépensé via un autre lot.`
    );
  }

  await client.query(
    'UPDATE wallets SET balance_kmf = $1, updated_at = NOW() WHERE id = $2',
    [newBalance, lot.wallet_id]
  );

  await client.query(
    "UPDATE wallet_credit_lots SET status = 'reversed', remaining_kmf = 0 WHERE id = $1",
    [lotId]
  );

  const { rows: [tx] } = await client.query(`
    INSERT INTO wallet_transactions
      (wallet_id, type, amount_kmf, balance_after_kmf, reason, reference_id, note, created_by)
    VALUES ($1, 'reversal', $2, $3, 'lot_reversal', $4, $5, $6)
    RETURNING *
  `, [lot.wallet_id, amountToReverse, newBalance, lot.source_order_id, note || 'Reversal admin', adminId]);

  console.log(`[WALLET] ✅ Lot ${lotId} reversed: ${amountToReverse} KMF — new balance: ${newBalance}`);

  return { transaction: tx, reversed_kmf: amountToReverse };
}

// ── Queries (read-only, pool) ───────────────────────────────────────────────
async function getBalance(userId) {
  const r = await db.query(
    'SELECT balance_kmf FROM wallets WHERE user_id = $1', [userId]
  );
  return r.rows.length ? r.rows[0].balance_kmf : 0;
}

async function getBalanceInTx(client, userId) {
  const wallet = await getOrCreateWallet(client, userId);
  return wallet.balance_kmf;
}

async function getTransactions(userId, { limit = 20, offset = 0 } = {}) {
  const wRes = await db.query('SELECT id FROM wallets WHERE user_id = $1', [userId]);
  if (!wRes.rows.length) return { transactions: [], total: 0 };
  const wid = wRes.rows[0].id;

  const [cntRes, txRes] = await Promise.all([
    db.query('SELECT COUNT(*)::int AS c FROM wallet_transactions WHERE wallet_id = $1', [wid]),
    db.query(`
      SELECT wt.*,
        (SELECT reference FROM orders WHERE id = wt.reference_id LIMIT 1) AS order_reference
      FROM wallet_transactions wt
      WHERE wt.wallet_id = $1
      ORDER BY wt.created_at DESC
      LIMIT $2 OFFSET $3
    `, [wid, limit, offset]),
  ]);
  return { transactions: txRes.rows, total: cntRes.rows[0].c };
}

// ── Admin queries ───────────────────────────────────────────────────────────
async function listWallets({ limit = 50, offset = 0, search } = {}) {
  const p = [];
  let where = '', idx = 1;
  if (search) {
    where = `WHERE u.full_name ILIKE $${idx} OR u.email ILIKE $${idx} OR u.phone ILIKE $${idx}`;
    p.push(`%${search}%`); idx++;
  }
  const cntRes = await db.query(
    `SELECT COUNT(*)::int AS c FROM wallets w JOIN users u ON u.id = w.user_id ${where}`, p
  );
  p.push(limit, offset);
  const res = await db.query(`
    SELECT w.*, u.full_name, u.email, u.phone,
      (SELECT COUNT(*)::int FROM wallet_transactions WHERE wallet_id = w.id) AS tx_count
    FROM wallets w JOIN users u ON u.id = w.user_id
    ${where}
    ORDER BY w.balance_kmf DESC, w.updated_at DESC
    LIMIT $${idx} OFFSET $${idx+1}
  `, p);
  return { wallets: res.rows, total: cntRes.rows[0].c };
}

async function getWalletDetail(userId) {
  const wRes = await db.query(`
    SELECT w.*, u.full_name, u.email, u.phone
    FROM wallets w JOIN users u ON u.id = w.user_id
    WHERE w.user_id = $1
  `, [userId]);
  if (!wRes.rows.length) return null;
  const w = wRes.rows[0];

  const [txRes, lotsRes] = await Promise.all([
    db.query(`
      SELECT wt.*,
        (SELECT reference FROM orders WHERE id = wt.reference_id LIMIT 1) AS order_ref
      FROM wallet_transactions wt WHERE wt.wallet_id = $1
      ORDER BY wt.created_at DESC LIMIT 50
    `, [w.id]),
    db.query(`
      SELECT wcl.*,
        (SELECT reference FROM orders WHERE id = wcl.source_order_id LIMIT 1) AS source_ref
      FROM wallet_credit_lots wcl WHERE wcl.wallet_id = $1
      ORDER BY wcl.created_at DESC
    `, [w.id]),
  ]);
  return { wallet: w, transactions: txRes.rows, lots: lotsRes.rows };
}

module.exports = {
  ensureWalletTables,
  getOrCreateWallet,
  credit,
  debit,
  applyToOrder,
  removeFromOrder,
  createCreditFromCancel,
  reverseLot,
  getBalance,
  getBalanceInTx,
  getTransactions,
  listWallets,
  getWalletDetail,
};

