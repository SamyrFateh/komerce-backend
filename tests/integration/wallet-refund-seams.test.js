/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 */

/**
 * WAVE 1 — Wallet & Refund seams (REAL_DB_INTEGRATION).
 *
 * Lot R4 — Partie 2/2 — W1-5 / W1-6 / W1-8 (docs/E2E_MASTER_VALIDATION_PLAN.md WAVE 1).
 *
 * Same doctrine as stripe-payment-seams.test.js / post-o8-payments-seams.test.js:
 * real Postgres, real service code, only external/fire-and-forget boundaries
 * mocked (none needed here — wallet-service and admin-order-refund are pure
 * DB-transactional).
 *
 * W1-5 wallet-100% REAL_DB              : débit + idempotency_key + solde (DEBT-01)
 * W1-6 wallet-double-credit-concurrent   : 2 crédits même clé → l'index unique
 *                                          idx_wtx_idempotency (migrations/014c)
 *                                          doit bloquer le doublon (DEBT-01, TOCTOU)
 * W1-8 refund manual_cash                : 202 / manual_required indépendant de
 *                                          l'échec de l'alerte (P0-C, même pattern
 *                                          SAVEPOINT que P0-A)
 */

'use strict';

const hasIntegrationEnv = Boolean(process.env.DATABASE_URL);

if (!hasIntegrationEnv) {
  describe.skip('Wallet & refund seams (REAL_DB) — SKIPPED: no DATABASE_URL', () => {
    it('requires DATABASE_URL', () => {});
  });
} else {
  const db = require('../../db');
  const walletService = require('../../services/wallet-service');
  const alertsUtil = require('../../utils/alerts');
  const { refundCancelledOrder } = require('../../services/admin-order-refund');
  const {
    createUser, createTestRelais, createPendingOrder,
    cleanupBusinessFixtures, cleanup: cleanupUsers,
  } = require('./test-harness/seed-helpers.EXTENDED');

  jest.setTimeout(30000);

  async function getWalletBalance(userId) {
    const { rows } = await db.query('SELECT balance_kmf FROM wallets WHERE user_id = $1', [userId]);
    return rows.length ? rows[0].balance_kmf : 0;
  }

  async function countTxByKey(idempotencyKey) {
    const { rows } = await db.query(
      'SELECT COUNT(*)::int AS c FROM wallet_transactions WHERE idempotency_key = $1', [idempotencyKey]
    );
    return rows[0].c;
  }

  async function withClient(fn) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  describe('WAVE 1 — Wallet & refund proof (REAL_DB)', () => {
    let relais;

    beforeAll(async () => {
      await cleanupBusinessFixtures();
      relais = await createTestRelais();
    });

    afterAll(async () => {
      await cleanupBusinessFixtures();
      await cleanupUsers();
    });

    // ── W1-5 — wallet 100% : crédit → débit → idempotency_key → solde ──────
    it('W1-5 WALLET-100% — crédit puis débit REAL_DB, idempotency_key respecté, solde exact', async () => {
      const user = await createUser({ role: 'client' });

      const creditRes = await withClient((client) => walletService.credit(client, {
        userId: user.id, amountKmf: 15000, reason: 'itest_credit',
        idempotencyKey: `itest-credit-${user.id}`,
      }));
      expect(creditRes.duplicate).toBe(false);
      expect(await getWalletBalance(user.id)).toBe(15000);

      // Re-crédit avec la MÊME clé → doit être un no-op idempotent, pas un
      // second crédit (preuve directe DEBT-01 côté credit()).
      const creditRetry = await withClient((client) => walletService.credit(client, {
        userId: user.id, amountKmf: 15000, reason: 'itest_credit',
        idempotencyKey: `itest-credit-${user.id}`,
      }));
      expect(creditRetry.duplicate).toBe(true);
      expect(await getWalletBalance(user.id)).toBe(15000); // unchanged

      // Débit partiel avec idempotency_key.
      const debitKey = `itest-debit-${user.id}`;
      const debitRes = await withClient((client) => walletService.debit(client, {
        userId: user.id, amountKmf: 4000, reason: 'itest_debit', idempotencyKey: debitKey,
      }));
      expect(debitRes.duplicate).toBe(false);
      expect(await getWalletBalance(user.id)).toBe(11000); // 15000 - 4000

      // Rejouer le MÊME débit (même idempotency_key) → no-op, solde inchangé.
      const debitRetry = await withClient((client) => walletService.debit(client, {
        userId: user.id, amountKmf: 4000, reason: 'itest_debit', idempotencyKey: debitKey,
      }));
      expect(debitRetry.duplicate).toBe(true);
      expect(await getWalletBalance(user.id)).toBe(11000); // still unchanged

      // Solde insuffisant → doit throw, pas de débit partiel silencieux.
      await expect(withClient((client) => walletService.debit(client, {
        userId: user.id, amountKmf: 999999, reason: 'itest_debit_toomuch',
        idempotencyKey: `itest-debit-toomuch-${user.id}`,
      }))).rejects.toThrow(/Solde insuffisant/);
      expect(await getWalletBalance(user.id)).toBe(11000); // untouched by the failed attempt

      expect(await countTxByKey(debitKey)).toBe(1); // exactly one row despite 2 debit() calls
    });

    // ── W1-6 — double-crédit concurrent, même idempotency_key ──────────────
    it('W1-6 WALLET-DOUBLE-CREDIT-CONCURRENT — idx_wtx_idempotency bloque le doublon sous concurrence réelle', async () => {
      const user = await createUser({ role: 'client' });
      const sharedKey = `itest-concurrent-${user.id}`;

      // Deux crédits CONCURRENTS, même idempotency_key, chacun dans sa PROPRE
      // transaction/connexion (2 client.connect() distincts) — c'est la seule
      // façon de vraiment tester la race : le SELECT de dédup dans credit()
      // n'a pas de FOR UPDATE, donc si l'index unique n'existait pas, les 2
      // transactions verraient "pas de doublon" et créditeraient deux fois.
      const attempt = () => withClient((client) => walletService.credit(client, {
        userId: user.id, amountKmf: 20000, reason: 'itest_concurrent_credit',
        idempotencyKey: sharedKey,
      }));

      const results = await Promise.allSettled([attempt(), attempt()]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      // Exactly ONE row can ever exist for this idempotency_key — whether the
      // second call resolved as {duplicate:true} (serialized after the first
      // committed) or was rejected with a unique-violation (truly
      // concurrent race caught by idx_wtx_idempotency), both outcomes prove
      // the same thing: the guard works. What must NEVER happen is 2 rows
      // and a doubled balance.
      expect(await countTxByKey(sharedKey)).toBe(1);
      expect(await getWalletBalance(user.id)).toBe(20000); // credited exactly once, never 40000

      // Sanity on the shape of what we observed (informational, not the core
      // assertion — the core assertion above already proves the guard).
      expect(fulfilled.length + rejected.length).toBe(2);
      if (rejected.length) {
        expect(String(rejected[0].reason?.message || rejected[0].reason)).toMatch(/duplicate key|idx_wtx_idempotency|unique/i);
      }
    });

    // ── W1-8 — refund manual_cash (P0-C) ────────────────────────────────────
    it('W1-8 REFUND-MANUAL-CASH — 202/manual_required même si l\'INSERT alerte échoue (P0-C, commande reste cancelled)', async () => {
      const admin = { id: (await createUser({ role: 'admin' })).id, role: 'admin' };

      const order = await createPendingOrder({
        relais_id: relais.id, total_kmf: 12000, total_eur: 24,
        payment_mode: 'cash_relais',
      });
      await db.query(
        `UPDATE orders SET status = 'cancelled', payment_status = 'paid' WHERE id = $1`,
        [order.id]
      );

      // Force l'échec de l'INSERT alerte dans le SAVEPOINT — même vérif que
      // W1-2 : le contrat fonctionnel doit survivre à cet échec (P0-A/P0-C
      // sont le même pattern SAVEPOINT dans 2 fichiers différents).
      const alertSpy = jest.spyOn(alertsUtil, 'createAlert').mockRejectedValue(
        new Error('itest: simulated refund alert insert failure')
      );

      const res = await refundCancelledOrder({
        orderId: order.id, user: admin, dryRun: false, cashMode: 'manual',
      });

      expect(res.status).toBe(202);
      expect(res.body.manual_required).toBe(true);
      expect(res.body.success).toBe(false);

      const { rows: [after] } = await db.query('SELECT * FROM orders WHERE id = $1', [order.id]);
      // La commande reste cancelled — pas de transition vers refunded tant
      // que le remboursement cash n'est pas confirmé manuellement.
      expect(after.status).toBe('cancelled');
      expect(after.payment_status).not.toBe('refunded');

      // Rejouer refundCancelledOrder sur la MÊME commande cancelled+non-refunded
      // doit redonner le même contrat (pas de double side-effect bloquant) —
      // preuve que l'échec d'alerte précédent n'a pas laissé la commande dans
      // un état incohérent qui empêcherait un nouvel essai.
      alertSpy.mockRestore();
      const res2 = await refundCancelledOrder({
        orderId: order.id, user: admin, dryRun: false, cashMode: 'manual',
      });
      expect(res2.status).toBe(202);
      expect(res2.body.manual_required).toBe(true);
    });
  });
}
