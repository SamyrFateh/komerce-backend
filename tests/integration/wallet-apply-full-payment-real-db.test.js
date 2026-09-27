'use strict';

/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 *
 * GAP-1 — post-checkout wallet full payment on disposable PostgreSQL only.
 * All business fixtures live in the test transaction and are ROLLBACKed.
 * No provider, real payment, production data or external service is touched.
 */

if (!process.env.DATABASE_URL) {
  describe.skip('GAP-1 wallet post-checkout — DATABASE_URL required', () => {
    test('requires disposable PostgreSQL', () => {});
  });
} else {
  const db = require('../../db');
  const walletService = require('../../services/wallet-service');
  const { createUser } = require('./test-harness/seed-helpers');

  jest.setTimeout(30000);

  let user;
  let marketId;
  let client;

  beforeAll(async () => {
    user = await createUser({ role: 'client' });
    const { rows: [market] } = await db.query(
      "SELECT id FROM markets WHERE code = 'KM' AND is_active = TRUE LIMIT 1"
    );
    if (!market) throw new Error('GAP-1 requires the disposable KM market seed');
    marketId = market.id;
  });

  afterAll(async () => {
    if (client) {
      await client.query('ROLLBACK').catch(() => {});
      client.release();
      client = null;
    }
    if (user) await db.query('DELETE FROM users WHERE id = $1', [user.id]);
  });

  beforeEach(async () => {
    client = await db.getClient();
    await client.query('BEGIN');
  });

  afterEach(async () => {
    if (client) {
      await client.query('ROLLBACK');
      client.release();
      client = null;
    }
  });

  async function fixture({ stock = 2 } = {}) {
    const tag = 'ITEST-GAP1-' + Math.random().toString(36).slice(2, 11);
    const { rows: [relay] } = await client.query(
      `INSERT INTO relais (name, agent_name, phone, address, island, market_id, is_active)
       VALUES ($1,$1,'+2693999999','Wallet GAP-1 disposable fixture','Ngazidja',$2,TRUE)
       RETURNING id`,
      [tag, marketId]
    );
    const { rows: [product] } = await client.query(
      `INSERT INTO products (name, price_kmf, price_eur, stock, inventory_model, is_active)
       VALUES ($1,3000,6,$2,'LEGACY_VARIANTS',TRUE) RETURNING id, stock`,
      [tag, stock]
    );
    const { rows: [order] } = await client.query(
      `INSERT INTO orders
         (reference, user_id, relais_id, market_id, total_kmf, total_eur,
          payment_mode, payment_status, status)
       VALUES ($1,$2,$3,$4,3000,6,'cash_relais','pending','pending')
       RETURNING id, reference, status, payment_status, wallet_applied_kmf`,
      [tag, user.id, relay.id, marketId]
    );
    await client.query(
      `INSERT INTO order_items (order_id, product_id, quantity, price_kmf, fulfillment_source)
       VALUES ($1,$2,1,3000,'IMPORT')`,
      [order.id, product.id]
    );
    await walletService.credit(client, {
      userId: user.id,
      amountKmf: 5000,
      reason: 'manual',
      idempotencyKey: 'gap1-credit-' + order.id,
    });
    const { rows: [wallet] } = await client.query(
      'SELECT id, balance_kmf FROM wallets WHERE user_id = $1', [user.id]
    );
    return { order, product, relay, wallet };
  }

  async function snapshot({ order, product, wallet }) {
    const { rows: [o] } = await client.query(
      `SELECT status, payment_status, wallet_applied_kmf, pickup_secret_hash
       FROM orders WHERE id = $1`, [order.id]
    );
    const { rows: [p] } = await client.query(
      'SELECT stock FROM products WHERE id = $1', [product.id]
    );
    const { rows: [w] } = await client.query(
      'SELECT balance_kmf FROM wallets WHERE id = $1', [wallet.id]
    );
    const { rows: [ledger] } = await client.query(
      `SELECT COUNT(*)::int AS n FROM wallet_transactions
       WHERE wallet_id = $1 AND type = 'debit' AND idempotency_key = $2`,
      [wallet.id, 'checkout_' + order.id]
    );
    const { rows: [invoice] } = await client.query(
      'SELECT COUNT(*)::int AS n FROM invoices WHERE order_id = $1', [order.id]
    );
    return { order: o, stock: Number(p.stock), balance: Number(w.balance_kmf),
      debits: ledger.n, invoices: invoice.n };
  }

  test('full coverage: paid + canonical status + one stock decrement + invoice + pickup secret', async () => {
    const f = await fixture({ stock: 2 });
    const before = await snapshot(f);
    expect(before.debits).toBe(0);

    const applied = await walletService.applyToOrder(client, {
      userId: user.id, orderId: f.order.id, amountKmf: 3000,
    });
    expect(applied.applied_kmf).toBe(3000);
    expect(applied.remaining_to_pay).toBe(0);

    const after = await snapshot(f);
    expect(after.order.payment_status).toBe('paid');
    expect(after.order.status).toBe('ordered');
    expect(Number(after.order.wallet_applied_kmf)).toBe(3000);
    expect(after.order.pickup_secret_hash).toBeTruthy();
    expect(after.stock).toBe(before.stock - 1);
    expect(after.balance).toBe(before.balance - 3000);
    expect(after.debits - before.debits).toBe(1);
    expect(after.invoices - before.invoices).toBe(1);

    // The same business key must not charge or decrement stock twice.
    await expect(walletService.applyToOrder(client, {
      userId: user.id, orderId: f.order.id, amountKmf: 3000,
    })).rejects.toThrow('Rien à appliquer');
    const replay = await snapshot(f);
    expect(replay.stock).toBe(after.stock);
    expect(replay.balance).toBe(after.balance);
    expect(replay.debits).toBe(after.debits);
    expect(replay.invoices).toBe(after.invoices);
  });

  test('stockBlocked: caller rollback restores wallet, ledger and wallet_applied_kmf', async () => {
    const f = await fixture({ stock: 0 });
    const before = await snapshot(f);
    await client.query('SAVEPOINT gap1_wallet_attempt');

    await expect(walletService.applyToOrder(client, {
      userId: user.id, orderId: f.order.id, amountKmf: 3000,
    })).rejects.toMatchObject({ statusCode: 409 });

    // Equivalent of the HTTP caller's ROLLBACK, preserving only the fixture.
    await client.query('ROLLBACK TO SAVEPOINT gap1_wallet_attempt');
    const after = await snapshot(f);
    expect(after).toEqual(before);
    expect(after.order.payment_status).toBe('pending');
    expect(after.order.status).toBe('pending');
    expect(after.debits).toBe(0);
  });
}
