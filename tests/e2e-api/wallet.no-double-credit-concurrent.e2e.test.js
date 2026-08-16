'use strict';

/**
 * @test-kind e2e
 * @test-runner jest
 * @test-requires postgres
 */

/**
 * E2E-P1-WALLET — intégrité monétaire sous concurrence réelle PostgreSQL
 *
 * Invariant : une même idempotency_key ne peut appliquer le mouvement wallet
 * qu'une seule fois, y compris lorsque deux transactions ont toutes deux
 * passé le SELECT d'idempotence avant que l'une ne commit.
 *
 * Le test force précisément cette fenêtre de course :
 *   1. un troisième client verrouille la ligne wallets ;
 *   2. deux transactions credit()/debit() démarrent en parallèle ;
 *   3. on attend que LES DEUX soient bloquées sur SELECT ... FOR UPDATE,
 *      ce qui prouve qu'elles ont déjà passé leur fast-path d'idempotence ;
 *   4. on libère le verrou ;
 *   5. une seule transaction gagne, l'autre doit revenir duplicate:true sans
 *      erreur et sans second mouvement de solde.
 *
 * Sans la récupération 23505 + ROLLBACK TO SAVEPOINT, le perdant rejette sur
 * idx_wtx_idempotency après avoir tenté son UPDATE de balance.
 */

const { describeE2E, createCleanup, tag, uuid } = require('../helpers/e2eDbKit');

jest.setTimeout(60000);

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

describeE2E('E2E-P1-WALLET — no double credit/debit concurrent', ({ db }) => {
  const walletService = require('../../services/wallet-service');

  const creditUserId = uuid();
  const debitUserId = uuid();
  let cleanup;

  async function waitForTwoWalletLockWaiters() {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const { rows: [row] } = await db.query(`
        SELECT COUNT(*)::int AS c
          FROM pg_stat_activity
         WHERE datname = current_database()
           AND wait_event_type = 'Lock'
           AND query ILIKE '%SELECT * FROM wallets WHERE user_id = $1%FOR UPDATE%'
      `);
      if (row.c >= 2) return;
      await sleep(25);
    }
    throw new Error('Les deux opérations wallet ne se sont pas retrouvées simultanément en attente du verrou FOR UPDATE');
  }

  async function runContendedPair(userId, operation) {
    const blocker = await db.pool.connect();
    let blockerOpen = false;
    try {
      await blocker.query('BEGIN');
      blockerOpen = true;
      await blocker.query('SELECT id FROM wallets WHERE user_id = $1 FOR UPDATE', [userId]);

      const first = operation();
      const second = operation();

      await waitForTwoWalletLockWaiters();
      await blocker.query('COMMIT');
      blockerOpen = false;

      return Promise.allSettled([first, second]);
    } finally {
      if (blockerOpen) await blocker.query('ROLLBACK').catch(() => {});
      blocker.release();
    }
  }

  async function walletState(userId) {
    const { rows: [wallet] } = await db.query(
      'SELECT id, balance_kmf FROM wallets WHERE user_id = $1',
      [userId]
    );
    return wallet;
  }

  beforeAll(async () => {
    cleanup = createCleanup(db);

    cleanup.trackSql('DELETE FROM users WHERE id = ANY($1::uuid[])', [[creditUserId, debitUserId]]);
    cleanup.trackSql('DELETE FROM wallets WHERE user_id = ANY($1::uuid[])', [[creditUserId, debitUserId]]);
    cleanup.trackSql(
      `DELETE FROM wallet_transactions
        WHERE wallet_id IN (SELECT id FROM wallets WHERE user_id = ANY($1::uuid[]))`,
      [[creditUserId, debitUserId]]
    );
    cleanup.trackSql(
      `DELETE FROM wallet_credit_lots
        WHERE wallet_id IN (SELECT id FROM wallets WHERE user_id = ANY($1::uuid[]))`,
      [[creditUserId, debitUserId]]
    );

    await db.query(
      `INSERT INTO users (id, full_name, email, phone, role) VALUES
         ($1, 'E2E Wallet Credit Concurrent', $2, $3, 'client'),
         ($4, 'E2E Wallet Debit Concurrent',  $5, $6, 'client')`,
      [
        creditUserId, `${tag('wallet-credit')}@komerce.test`, `+2693${Math.floor(Math.random() * 9e6 + 1e6)}`,
        debitUserId, `${tag('wallet-debit')}@komerce.test`, `+2693${Math.floor(Math.random() * 9e6 + 1e6)}`,
      ]
    );

    await db.query('INSERT INTO wallets (user_id, balance_kmf) VALUES ($1, 0)', [creditUserId]);

    await db.withTransaction(client => walletService.credit(client, {
      userId: debitUserId,
      amountKmf: 10000,
      reason: 'order_cancel',
      idempotencyKey: `e2e_seed_${tag('debit')}`,
      note: 'Seed déterministe test concurrence debit',
    }));
  });

  afterAll(async () => {
    if (cleanup) await cleanup.run();
  });

  it('credit() x2 même clé : solde crédité exactement une fois, 1 gagnant + 1 duplicate, aucune erreur', async () => {
    const idempotencyKey = `e2e_wallet_credit_${tag('same')}`;
    const amountKmf = 5000;

    const settled = await runContendedPair(creditUserId, () =>
      db.withTransaction(client => walletService.credit(client, {
        userId: creditUserId,
        amountKmf,
        reason: 'order_cancel',
        idempotencyKey,
        note: 'Concurrent credit proof',
      }))
    );

    expect(settled.filter(r => r.status === 'rejected')).toHaveLength(0);
    const results = settled.map(r => r.value);
    expect(results.filter(r => r.duplicate === false)).toHaveLength(1);
    expect(results.filter(r => r.duplicate === true)).toHaveLength(1);
    expect(new Set(results.map(r => r.transaction.id)).size).toBe(1);

    const wallet = await walletState(creditUserId);
    expect(Number(wallet.balance_kmf)).toBe(amountKmf);

    const { rows: [txCount] } = await db.query(
      'SELECT COUNT(*)::int AS c FROM wallet_transactions WHERE idempotency_key = $1',
      [idempotencyKey]
    );
    expect(txCount.c).toBe(1);

    const { rows: [lotCount] } = await db.query(
      'SELECT COUNT(*)::int AS c FROM wallet_credit_lots WHERE wallet_id = $1',
      [wallet.id]
    );
    expect(lotCount.c).toBe(1);
  });

  it('debit() x2 même clé : solde débité exactement une fois, 1 gagnant + 1 duplicate, aucune erreur', async () => {
    const idempotencyKey = `e2e_wallet_debit_${tag('same')}`;
    const amountKmf = 3000;

    const before = await walletState(debitUserId);
    expect(Number(before.balance_kmf)).toBe(10000);

    const settled = await runContendedPair(debitUserId, () =>
      db.withTransaction(client => walletService.debit(client, {
        userId: debitUserId,
        amountKmf,
        reason: 'checkout',
        idempotencyKey,
        note: 'Concurrent debit proof',
      }))
    );

    expect(settled.filter(r => r.status === 'rejected')).toHaveLength(0);
    const results = settled.map(r => r.value);
    expect(results.filter(r => r.duplicate === false)).toHaveLength(1);
    expect(results.filter(r => r.duplicate === true)).toHaveLength(1);
    expect(new Set(results.map(r => r.transaction.id)).size).toBe(1);

    const after = await walletState(debitUserId);
    expect(Number(after.balance_kmf)).toBe(7000);

    const { rows: [txCount] } = await db.query(
      'SELECT COUNT(*)::int AS c FROM wallet_transactions WHERE idempotency_key = $1',
      [idempotencyKey]
    );
    expect(txCount.c).toBe(1);

    const { rows: [lots] } = await db.query(
      'SELECT COALESCE(SUM(remaining_kmf), 0)::bigint AS remaining FROM wallet_credit_lots WHERE wallet_id = $1',
      [after.id]
    );
    expect(Number(lots.remaining)).toBe(7000);
  });
});
