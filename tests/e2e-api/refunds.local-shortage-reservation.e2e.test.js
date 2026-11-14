'use strict';
/** @test-kind e2e
 * @test-runner jest
 * @test-requires postgres
 * Fable #4114: isolated PG16 transactions, native cash/MM ledger, no payouts.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { describeE2E } = require('../helpers/e2eDbKit');
const { reserveLocalShortage } = require('../../services/local-item-refund-reservation');
const uuid = () => crypto.randomUUID();

describeE2E('F1/F2 native shortage obligation — real PostgreSQL isolation', ({ db }) => {
  const schema = 'fable_local_' + crypto.randomBytes(7).toString('hex');
  const orderId = uuid(), marketId = uuid(), itemId = uuid(), incidentId = uuid(),
    adminId = uuid(), relayId = uuid(), sourceId = uuid();
  let primary, workerA, workerB;
  const adapter = client => ({
    getClient: async () => ({ query: client.query.bind(client), release: () => {} })
  });
  const input = (client, opKey = uuid(), quantity = 2) => ({
    orderId, orderItemId: itemId, incidentId, quantity, operationKey: opKey,
    reason: 'Rupture fournisseur physiquement attestée',
    actor: { id: adminId, role: 'admin' }, db: adapter(client)
  });

  beforeAll(async () => {
    primary = await db.connect();
    try {
      await primary.query('CREATE SCHEMA ' + schema);
      for (const create of [
        'CREATE TABLE users (id uuid PRIMARY KEY)',
        'CREATE TABLE markets (id uuid PRIMARY KEY, currency text)',
        'CREATE TABLE orders (id uuid PRIMARY KEY,user_id uuid,market_id uuid,relais_id uuid,payment_mode text,payment_status text,total_kmf numeric(14,2),fx_snapshot jsonb)',
        'CREATE TABLE order_items (id uuid PRIMARY KEY,order_id uuid,quantity int,qty_collected int DEFAULT 0,qty_refunded int DEFAULT 0,price_kmf numeric(14,2))',
        'CREATE TABLE incidents (id uuid PRIMARY KEY,order_id uuid,order_item_id uuid,incident_type text,details jsonb)',
        'CREATE TABLE cash_collections (id uuid PRIMARY KEY,order_id uuid,relais_id uuid,amount_kmf numeric(14,2))',
        'CREATE TABLE mobile_money_transactions (id uuid PRIMARY KEY,order_id uuid,market_id uuid,provider text,currency text,minor_unit int,amount_minor bigint,external_transaction_id text,status text)',
        'CREATE TABLE international_shipment_relay_receipts (order_item_id uuid,incident_id uuid,expected_qty int,received_qty int)',
        'CREATE TABLE refund_execution_intents (id uuid PRIMARY KEY,order_id uuid)',
        'CREATE TABLE order_item_refund_reservations (id uuid PRIMARY KEY,order_id uuid)',
        'CREATE TABLE refunds (id uuid PRIMARY KEY,order_id uuid)',
      ]) await primary.query('CREATE ' + create.slice('CREATE '.length).replace('TABLE ', 'TABLE '));
      // All tables created under one isolated search_path, never public.
      // Re-run canonical migration 416 against the isolated schema.
      const source = fs.readFileSync(
        path.join(__dirname, '../../migrations/416_fable_local_item_refund_reservations.sql'), 'utf8'
      );
      await primary.query(source.replace(/public\./g, schema + '.'));
      workerA = await db.connect(); workerB = await db.connect();
      for (const c of [primary, workerA, workerB]) await c.query('SET search_path TO ' + schema + ',public');
      const pids = await Promise.all([primary, workerA, workerB].map(async c =>
        (await c.query('SELECT pg_backend_pid() AS pid')).rows[0].pid));
      expect(new Set(pids).size).toBe(3);
    } catch (e) {
      for (const c of [workerB, workerA, primary]) if (c) {
        await c.query('RESET search_path').catch(() => {}); c.release();
      }
      workerB = workerA = primary = null;
      await db.query('DROP SCHEMA IF EXISTS ' + schema + ' CASCADE').catch(() => {});
      throw e;
    }
  });

  beforeEach(async () => {
    await primary.query(
      'TRUNCATE local_item_refund_reservations,international_shipment_relay_receipts,'
      + 'order_item_refund_reservations,refund_execution_intents,refunds,'
      + 'mobile_money_transactions,cash_collections,incidents,order_items,orders,markets,users CASCADE'
    );
    await primary.query('INSERT INTO users(id) VALUES($1)', [adminId]);
    await primary.query("INSERT INTO markets(id,currency) VALUES($1,'KMF')", [marketId]);
    await primary.query(
      `INSERT INTO orders(id,user_id,market_id,relais_id,payment_mode,payment_status,total_kmf)
       VALUES($1,$2,$3,$4,'cash_relais','paid',10000)`,
      [orderId, adminId, marketId, relayId]
    );
    await primary.query(
      'INSERT INTO order_items(id,order_id,quantity,qty_collected,qty_refunded,price_kmf) VALUES($1,$2,3,1,0,1000)',
      [itemId, orderId]
    );
    await primary.query(
      `INSERT INTO incidents(id,order_id,order_item_id,incident_type,details)
       VALUES($1,$2,$3,'reconciliation_error',$4)`,
      [incidentId, orderId, itemId, JSON.stringify({ type: 'supplier_shortage', missing_quantity: 2 })]
    );
    await primary.query(
      'INSERT INTO cash_collections(id,order_id,relais_id,amount_kmf) VALUES($1,$2,$3,10000)',
      [sourceId, orderId, relayId]
    );
  });

  afterAll(async () => {
    for (const c of [workerB, workerA, primary]) if (c) {
      await c.query('RESET search_path').catch(() => {}); c.release();
    }
    await db.query('DROP SCHEMA IF EXISTS ' + schema + ' CASCADE').catch(() => {});
  });

  test('two sessions reserve the same shortage: one committed liability only', async () => {
    const [a, b] = await Promise.allSettled([
      reserveLocalShortage(input(workerA)),
      reserveLocalShortage(input(workerB))
    ]);
    expect([a,b].filter(x => x.status === 'fulfilled')).toHaveLength(1);
    expect([a,b].filter(x => x.status === 'rejected')[0].reason.code)
      .toBe('LOCAL_REFUND_SHORTAGE_EXCEEDED');
    const { rows: [result] } = await primary.query(
      'SELECT COUNT(*)::int AS n, SUM(quantity)::int AS qty FROM local_item_refund_reservations'
    );
    expect(result).toEqual({ n:1, qty:2 });
    expect((await primary.query('SELECT COUNT(*)::int AS n FROM refunds')).rows[0].n).toBe(0);
  });

  test('concurrent identical operation UUID creates only one reserve', async () => {
    const k = uuid();
    const [a,b] = await Promise.all([
      reserveLocalShortage(input(workerA,k)),
      reserveLocalShortage(input(workerB,k))
    ]);
    expect(a.reservationId).toBe(b.reservationId);
    expect([a.replayed,b.replayed].sort()).toEqual([false,true]);
    expect((await primary.query(
      'SELECT COUNT(*)::int AS n FROM local_item_refund_reservations'
    )).rows[0].n).toBe(1);
  });

  test('physical handoff, legacy refund, PSP and mutation blocked by DB guards', async () => {
    await reserveLocalShortage(input(workerA));
    await expect(workerB.query('UPDATE order_items SET qty_collected=2 WHERE id=$1', [itemId]))
      .rejects.toThrow(/LOCAL_ITEM_REFUND_QTY_RESERVED_NOT_COLLECTABLE/);
    await expect(workerB.query('INSERT INTO refunds(id,order_id) VALUES($1,$2)', [uuid(),orderId]))
      .rejects.toThrow(/REFUND_LOCAL_OBLIGATION_UNRESOLVED/);
    await expect(workerB.query('INSERT INTO order_item_refund_reservations(id,order_id) VALUES($1,$2)', [uuid(),orderId]))
      .rejects.toThrow(/ITEM_REFUND_LOCAL_CROSS_RAIL_UNRESOLVED/);
    await expect(workerB.query("UPDATE local_item_refund_reservations SET status='cancelled'"))
      .rejects.toThrow(/LOCAL_REFUND_RESERVATION_IMMUTABLE/);
    expect((await primary.query('SELECT COUNT(*)::int AS n FROM refunds')).rows[0].n).toBe(0);
  });

  test('native mobile money XAF uses succeeded provider capture, no second payout', async () => {
    await primary.query("UPDATE markets SET currency='XAF' WHERE id=$1", [marketId]);
    await primary.query(
      `UPDATE orders SET payment_mode='mobile_money',
      fx_snapshot=$2::jsonb WHERE id=$1`,
      [orderId, JSON.stringify({ market: {
        market_id: marketId, currency: 'XAF', minor_unit: 0, amount_text: '250000'
      } })]
    );
    await primary.query(
      `INSERT INTO mobile_money_transactions
        (id,order_id,market_id,provider,currency,minor_unit,amount_minor,external_transaction_id,status)
       VALUES($1,$2,$3,'orange_money','XAF',0,250000,'tx-test-verified','succeeded')`,
      [sourceId,orderId,marketId]
    );
    const outcome = await reserveLocalShortage(input(workerA));
    expect(outcome).toMatchObject({ status:'reserved', paid:false,
      amountMinor:'50000', currency:'XAF' });
    const { rows: [row] } = await primary.query(
      'SELECT capture_ref,payment_mode,currency,minor_unit FROM local_item_refund_reservations'
    );
    expect(row).toMatchObject({ capture_ref: sourceId,
      payment_mode:'mobile_money', currency:'XAF', minor_unit:0 });
  });
});
