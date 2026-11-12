'use strict';
/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 * @brief L3: key scoped to buyer, single transactional claimant, immutable replay,
 *        request mismatch 409, no new checkout on replay.
 */
const fs = require('fs');
const path = require('path');
const { claimCheckout, completeCheckout, hashRequest, validKey } = require('../../services/order-checkout-idempotency');
const USER = '00000000-0000-4000-8000-000000000001';
const KEY = 'c56c854e-e0ca-4a97-9bf9-9b9e875d0f77';
const BODY = { items: [{ product_id: 'p1', quantity: 1 }], relais_id: 'r1', payment_mode: 'cash_relais', expected_total_kmf: 7990 };

function fakeDb({ inserted = true, existing = null, rowCount = 1 } = {}) {
  const calls = [];
  const client = { query: jest.fn(async (sql, args) => {
    calls.push({ sql, args });
    if (/INSERT INTO order_checkout_idempotency/.test(sql)) return { rows: inserted ? [{ request_hash: hashRequest(BODY) }] : [] };
    if (/SELECT request_hash, order_id/.test(sql)) return { rows: existing ? [existing] : [] };
    if (/UPDATE order_checkout_idempotency/.test(sql)) return { rowCount };
    throw new Error('Unexpected SQL: ' + sql);
  }) };
  return { client, calls };
}

describe('L3 checkout idempotency claim', () => {
  test('fingerprint stable under harmless object-key reordering', () => {
    expect(hashRequest(BODY)).toBe(hashRequest({
      expected_total_kmf: 7990, payment_mode: 'cash_relais', relais_id: 'r1',
      items: [{ quantity: 1, product_id: 'p1' }],
    }));
  });

  test('validates the request key and requires a non-trivial string', () => {
    expect(validKey(KEY)).toBe(true);
    expect(validKey('x')).toBe(false);
    expect(validKey('../unsafe path')).toBe(false);
    expect(validKey('x'.repeat(129))).toBe(false);
  });

  test('new attempt reserves buyer+key before effects, and persists result in same transaction', async () => {
    const { client, calls } = fakeDb();
    const claim = await claimCheckout(client, { userId: USER, key: KEY, body: BODY });
    expect(claim).toMatchObject({ claimed: true, replayed: false, userId: USER });
    const order = { id: 'order-1', reference: 'CMD-1', total_kmf: 7990 };
    await completeCheckout(client, claim, { order, creditApplied: 0, relais: { id: 'rel-1', name: 'Relais' } });
    expect(calls[0].sql).toContain('ON CONFLICT (user_id,idempotency_key) DO NOTHING');
    expect(calls[0].args.slice(0, 2)).toEqual([USER, KEY]);
    expect(calls[1].sql).toContain('response_snapshot=$4::jsonb');
    expect(JSON.parse(calls[1].args[3]).order.id).toBe('order-1');
  });

  test('same key and identical payload replays the original order, without another INSERT/UPDATE', async () => {
    const saved = { order: { id: 'order-1', total_kmf: 7990 }, creditApplied: 0, relais: { id: 'r1', name: 'Relais' } };
    const { client, calls } = fakeDb({
      inserted: false,
      existing: { request_hash: hashRequest(BODY), order_id: 'order-1', response_snapshot: saved },
    });
    const claimed = await claimCheckout(client, { userId: USER, key: KEY, body: BODY });
    expect(claimed).toMatchObject({ claimed: false, replayed: true, snapshot: saved });
    await completeCheckout(client, claimed, saved);
    expect(calls).toHaveLength(2);
    expect(calls.some(c => /UPDATE /.test(c.sql))).toBe(false);
  });

  test('same key, different variants/quantities/total is a hard conflict, never another order', async () => {
    const { client, calls } = fakeDb({
      inserted: false,
      existing: { request_hash: hashRequest(BODY), order_id: 'order-1', response_snapshot: { order: { id: 'order-1' } } },
    });
    await expect(claimCheckout(client, { userId: USER, key: KEY, body: { ...BODY, expected_total_kmf: 8990 } }))
      .rejects.toMatchObject({ code: 'idempotency_key_reused', status: 409 });
    expect(calls).toHaveLength(2);
  });

  test('incomplete entry refuses fail-closed; missing key preserves legacy checkout', async () => {
    const { client } = fakeDb({ inserted: false, existing: { request_hash: hashRequest(BODY), order_id: null, response_snapshot: null } });
    await expect(claimCheckout(client, { userId: USER, key: KEY, body: BODY }))
      .rejects.toMatchObject({ code: 'idempotency_in_progress' });
    expect(await claimCheckout(client, { userId: USER, key: null, body: BODY })).toBeNull();
  });

  test('failure of the final write is an error (caller must rollback entire checkout)', async () => {
    const { client } = fakeDb({ rowCount: 0 });
    const claim = await claimCheckout(client, { userId: USER, key: KEY, body: BODY });
    await expect(completeCheckout(client, claim, { order: { id: 'o' }, creditApplied: 0, relais: null }))
      .rejects.toMatchObject({ code: 'idempotency_finalize_failed' });
  });

  test('migration enforces a buyer-scoped unique key and an atomic snapshot', () => {
    const sql = fs.readFileSync(path.join(__dirname, '../../migrations/408_checkout_idempotency.sql'), 'utf8');
    expect(sql).toMatch(/PRIMARY KEY \(user_id, idempotency_key\)/);
    expect(sql).toMatch(/response_snapshot jsonb/);
    expect(sql).toMatch(/FOREIGN KEY|REFERENCES public.orders/);
  });
});
