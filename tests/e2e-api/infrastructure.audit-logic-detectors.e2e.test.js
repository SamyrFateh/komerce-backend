'use strict';

/**
 * @test-kind e2e @test-runner jest @test-requires postgres
 * A4: positive/negative proof on a real disposable PostgreSQL connection.
 * Only TEMP tables on an isolated test database, never application tables.
 * The normal write-E2E database identity guard runs before any connection.
 */
const { describeE2E } = require('../helpers/e2eDbKit');
const { runDataRules } = require('../../scripts/lib/logic-data-detectors');

describeE2E('E2E-GOV-A4 — invariants SQL vrais sur PostgreSQL isolé', ({ db }) => {
  let client;
  const definitions = [
    'CREATE TEMP TABLE orders (id text PRIMARY KEY, market_id text, relais_id text, status text, payment_status text, total_kmf numeric)',
    'CREATE TEMP TABLE order_items (id text PRIMARY KEY, order_id text, quantity integer)',
    'CREATE TEMP TABLE parcels (id text PRIMARY KEY, order_id text, relais_id text, relay_id text, shipped_at timestamptz)',
    'CREATE TEMP TABLE parcel_items (id text PRIMARY KEY, parcel_id text, order_item_id text, qty_collected integer, created_at timestamptz)',
    'CREATE TEMP TABLE inventory_items (id text PRIMARY KEY, parcel_id text, order_item_id text)',
    'CREATE TEMP TABLE scan_events (id text PRIMARY KEY, parcel_id text, order_id text, scanned_by text, actor_role text, event_type text, status text)',
    'CREATE TEMP TABLE users (id text PRIMARY KEY, relais_id text)',
    'CREATE TEMP TABLE refunds (id text PRIMARY KEY, order_id text, status text, amount_kmf numeric, created_at timestamptz)',
  ];
  const add = async (table, fields, values) => {
    const placeholders = fields.map((_, i) => '$' + (i + 1)).join(',');
    await client.query('INSERT INTO ' + table + ' (' + fields.join(',') + ') VALUES (' + placeholders + ')', values);
  };
  const rules = () => runDataRules(client, { sampleSize: 10 });
  const check = async (id) => (await rules()).find(x => x.rule === id).samples;
  const order = (id, market = 'KM', relay = 'R1', status = 'confirmed', payment = 'paid', amount = 100) =>
    add('orders', ['id', 'market_id', 'relais_id', 'status', 'payment_status', 'total_kmf'],
      [id, market, relay, status, payment, amount]);
  const parcel = (id, orderId, relay = 'R1', shippedAt = null) =>
    add('parcels', ['id', 'order_id', 'relais_id', 'shipped_at'], [id, orderId, relay, shippedAt]);
  const line = (id, orderId, quantity = 1) =>
    add('order_items', ['id', 'order_id', 'quantity'], [id, orderId, quantity]);
  const membership = (id, parcelId, lineId, qty = 0, at = '2020-01-01T00:00:00Z') =>
    add('parcel_items', ['id', 'parcel_id', 'order_item_id', 'qty_collected', 'created_at'],
      [id, parcelId, lineId, qty, at]);

  beforeAll(async () => {
    client = await db.connect();
    await client.query('BEGIN');
    for (const definition of definitions) await client.query(definition);
  });
  beforeEach(async () => { await client.query('SAVEPOINT logic_case'); });
  afterEach(async () => { await client.query('ROLLBACK TO SAVEPOINT logic_case'); });
  afterAll(async () => {
    if (client) {
      await client.query('ROLLBACK').catch(() => {});
      client.release();
    }
  });

  test('LD-01 : affectation invisible au colis détectée, puis résolue', async () => {
    await order('O1'); await line('L1', 'O1'); await parcel('P1', 'O1');
    await add('inventory_items', ['id', 'parcel_id', 'order_item_id'], ['I1', 'P1', 'L1']);
    expect(await check('LD-01')).toEqual(['I1']);
    await membership('PI1', 'P1', 'L1');
    expect(await check('LD-01')).toEqual([]);
  });

  test('LD-02a/b : marchés et relais isolés, multi-commandes compatibles admises', async () => {
    await order('O1', 'KM', 'R1'); await order('O2', 'CM', 'R1');
    await line('L2', 'O2'); await parcel('P1', 'O1');
    await membership('PI1', 'P1', 'L2');
    expect(await check('LD-02a')).toEqual(['PI1']);
    await client.query("UPDATE orders SET market_id='KM', relais_id='R2' WHERE id='O2'");
    expect(await check('LD-02a')).toEqual([]);
    expect(await check('LD-02b')).toEqual(['PI1']);
    await client.query("UPDATE orders SET relais_id='R1' WHERE id='O2'");
    expect(await check('LD-02b')).toEqual([]);
  });

  test('LD-03 : appartenance créée après shipped_at, pas avant', async () => {
    await order('O1'); await line('L1', 'O1');
    await parcel('P1', 'O1', 'R1', '2020-01-02T00:00:00Z');
    await membership('PI1', 'P1', 'L1', 0, '2020-01-03T00:00:00Z');
    expect(await check('LD-03')).toEqual(['PI1']);
    await client.query("UPDATE parcel_items SET created_at='2020-01-01' WHERE id='PI1'");
    expect(await check('LD-03')).toEqual([]);
  });

  test('LD-04 : clôture interdite si une ligne n est pas remise', async () => {
    await order('O1', 'KM', 'R1', 'collected'); await line('L1', 'O1', 2); await parcel('P1', 'O1');
    await membership('PI1', 'P1', 'L1', 1);
    expect(await check('LD-04')).toEqual(['O1']);
    await client.query("UPDATE parcel_items SET qty_collected=2 WHERE id='PI1'");
    expect(await check('LD-04')).toEqual([]);
  });

  test('LD-05/06 : agent hors relais et remise non payée détectés séparément', async () => {
    await order('O1', 'KM', 'R1', 'available', 'pending'); await parcel('P1', 'O1');
    await add('users', ['id', 'relais_id'], ['U1', 'R2']);
    await add('scan_events', ['id', 'parcel_id', 'order_id', 'scanned_by', 'actor_role', 'event_type', 'status'],
      ['E1', 'P1', 'O1', 'U1', 'relay_agent', 'customer_collected', 'applied']);
    expect(await check('LD-05')).toEqual(['E1']);
    expect(await check('LD-06')).toEqual(['E1']);
    await client.query("UPDATE users SET relais_id='R1' WHERE id='U1'");
    await client.query("UPDATE orders SET payment_status='paid' WHERE id='O1'");
    expect(await check('LD-05')).toEqual([]);
    expect(await check('LD-06')).toEqual([]);
  });

  test('LD-07a/b : remboursement abandonné ou partiel détecté', async () => {
    await order('O1', 'KM', 'R1', 'confirmed', 'refunded', 100);
    await add('refunds', ['id', 'order_id', 'status', 'amount_kmf', 'created_at'],
      ['RF1', 'O1', 'pending', 30, '2020-01-01T00:00:00Z']);
    expect(await check('LD-07a')).toEqual(['RF1']);
    expect(await check('LD-07b')).toEqual(['O1']);
    await client.query("UPDATE refunds SET status='completed', amount_kmf=100 WHERE id='RF1'");
    expect(await check('LD-07a')).toEqual([]);
    expect(await check('LD-07b')).toEqual([]);
  });

  test('zéro anomalie sur une base vide : tous les contrôles ont été réellement exécutés', async () => {
    const all = await rules();
    expect(all).toHaveLength(9);
    expect(all.every(x => x.detectedAtLeast === 0)).toBe(true);
  });
});
