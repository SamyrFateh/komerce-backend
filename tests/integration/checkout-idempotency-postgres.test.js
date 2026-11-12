'use strict';
/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 * @integration checkout-idempotency-postgres.test.js
 * @brief L3: PostgreSQL 16 serializes simultaneous claims on one user+key; rollback frees the claim.
 */
const crypto = require('crypto');
const db = require('../../db');
const { claimCheckout } = require('../../services/order-checkout-idempotency');

jest.setTimeout(30000);
const describeDb = process.env.DATABASE_URL ? describe : describe.skip;
describeDb('L3 checkout Idempotency-Key — physical PostgreSQL concurrency', () => {
  const userId = crypto.randomUUID();
  const key = crypto.randomUUID();
  const body = { items: [{ product_id: crypto.randomUUID(), quantity: 1 }], payment_mode: 'cash_relais', expected_total_kmf: 7990 };
  let first;
  let second;

  beforeAll(async () => {
    await db.query(
      `INSERT INTO users (id, full_name, email, phone, role)
       VALUES ($1, 'Checkout L3 Test', $2, $3, 'client')`,
      [userId, `l3-claim-${userId}@komerce.test`, '+2693' + String(parseInt(userId.slice(0, 6), 16) % 10000000).padStart(7, '0')]);
  });

  afterAll(async () => {
    await first?.query('ROLLBACK').catch(() => {});
    await second?.query('ROLLBACK').catch(() => {});
    first?.release();
    second?.release();
    await db.query('DELETE FROM order_checkout_idempotency WHERE user_id=$1', [userId]).catch(() => {});
    await db.query('DELETE FROM users WHERE id=$1', [userId]).catch(() => {});
    await db.pool.end().catch(() => {});
  });

  test('same key: second claim waits for first; its rollback permits exactly one remaining claimant', async () => {
    first = await db.getClient();
    second = await db.getClient();
    await first.query('BEGIN');
    const a = await claimCheckout(first, { userId, key, body });
    expect(a.claimed).toBe(true);

    await second.query('BEGIN');
    let settled = false;
    const pending = claimCheckout(second, { userId, key, body }).then((r) => { settled = true; return r; });
    // Give PG an opportunity to reach the blocked UNIQUE constraint.
    await new Promise(resolve => setTimeout(resolve, 60));
    expect(settled).toBe(false);
    await first.query('ROLLBACK');
    const b = await pending;
    expect(b.claimed).toBe(true);
    await second.query('ROLLBACK');
    first.release(); second.release();
    first = null; second = null;
    const { rows: [row] } = await db.query(
      'SELECT count(*)::int AS n FROM order_checkout_idempotency WHERE user_id=$1 AND idempotency_key=$2',
      [userId, key]);
    expect(row.n).toBe(0);
  });
});
