'use strict';

/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 * @integration hub-physical-identity-postgres.test.js
 * @brief HUB-001 — preuve PostgreSQL réelle : identité achat, split multi-market, custody append-only, concurrence et outbox atomique.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');
const {
  HubPhysicalError,
  snapshotPurchaseAllocation,
  createPhysicalUnit,
  receiveSupplierPackage,
  transitionPhysicalUnit,
  moveAllocationQuantity,
  recordPhysicalUnitOutcome,
} = require('../../services/hub-physical-identity');

jest.setTimeout(30000);

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const schema = `hub001_${process.pid}_${Date.now()}`.replace(/[^a-zA-Z0-9_]/g, '_');
const migrationSql = fs.readFileSync(
  path.join(__dirname, '../../migrations/233_hub_physical_identity_allocation_custody.sql'),
  'utf8'
);

function id() {
  return crypto.randomUUID();
}

async function clientInSchema() {
  const client = await pool.connect();
  await client.query(`SET search_path TO ${schema}, public`);
  return client;
}

async function query(sql, params = []) {
  const client = await clientInSchema();
  try {
    return await client.query(sql, params);
  } finally {
    client.release();
  }
}

async function transact(fn) {
  const client = await clientInSchema();
  try {
    await client.query('BEGIN');
    const value = await fn(client);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) { /* connection may already be gone */ }
    throw error;
  } finally {
    client.release();
  }
}

async function seedPurchase({ marketId, relaisId, qty = 1, soi = null, supplierUnitRef = 'UNIT-1', itemSkuMismatch = false } = {}) {
  const market = marketId || id();
  const supplier = id();
  const sku = id();
  const itemSku = itemSkuMismatch ? id() : sku;
  const order = id();
  const item = id();
  const po = id();
  const destination = relaisId || id();
  const identity = soi === null
    ? { provider: 'manual', version: 1, payload: { supplier_sku: supplierUnitRef } }
    : soi;

  await query('INSERT INTO markets(id) VALUES ($1) ON CONFLICT DO NOTHING', [market]);
  await query('INSERT INTO suppliers(id) VALUES ($1)', [supplier]);
  await query('INSERT INTO product_skus(id) VALUES ($1),($2) ON CONFLICT DO NOTHING', [sku, itemSku]);
  await query(
    'INSERT INTO orders(id, market_id, relais_id, reference, status) VALUES ($1,$2,$3,$4,$5)',
    [order, market, destination, `ORD-${order.slice(0, 8)}`, 'ordered']
  );
  await query(
    'INSERT INTO order_items(id, order_id, sku_id) VALUES ($1,$2,$3)',
    [item, order, itemSku]
  );
  await query(
    `INSERT INTO purchase_orders(
       id, order_id, order_item_id, product_sku_id, supplier_id,
       supplier_unit_ref, supplier_order_identity, qty, status
     ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,'confirmed')`,
    [po, order, item, sku, supplier, supplierUnitRef, identity ? JSON.stringify(identity) : null, qty]
  );

  return { market, supplier, sku, order, item, po, destination, identity };
}

async function advanceToPicked(unitId) {
  return transact(async (client) => {
    for (const state of ['IDENTIFIED', 'QUALITY_CHECKED', 'LOCATED', 'ALLOCATED', 'PICKED']) {
      await transitionPhysicalUnit(client, { unitId, toState: state, locationRef: 'HUB-DXB-A1' });
    }
  });
}

beforeAll(async () => {
  await pool.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
  await pool.query(`CREATE SCHEMA ${schema}`);
  const client = await clientInSchema();
  try {
    await client.query(`
      CREATE TABLE markets (id uuid PRIMARY KEY);
      CREATE TABLE users (id uuid PRIMARY KEY);
      CREATE TABLE suppliers (id uuid PRIMARY KEY);
      CREATE TABLE product_skus (id uuid PRIMARY KEY);
      CREATE TABLE orders (
        id uuid PRIMARY KEY,
        market_id uuid,
        relais_id uuid,
        reference text,
        status text
      );
      CREATE TABLE order_items (
        id uuid PRIMARY KEY,
        order_id uuid NOT NULL REFERENCES orders(id),
        sku_id uuid REFERENCES product_skus(id)
      );
      CREATE TABLE purchase_orders (
        id uuid PRIMARY KEY,
        order_id uuid NOT NULL REFERENCES orders(id),
        order_item_id uuid REFERENCES order_items(id),
        product_sku_id uuid REFERENCES product_skus(id),
        supplier_id uuid NOT NULL REFERENCES suppliers(id),
        supplier_unit_ref text,
        supplier_order_identity jsonb,
        qty integer NOT NULL,
        status text NOT NULL
      );
      CREATE TABLE outbox_events (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        aggregate_type text NOT NULL,
        aggregate_id text NOT NULL,
        aggregate_sequence bigint NOT NULL,
        event_type text NOT NULL,
        payload jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        processed_at timestamptz,
        attempts integer NOT NULL DEFAULT 0,
        last_error text,
        UNIQUE (aggregate_type, aggregate_id, aggregate_sequence)
      );
    `);
    await client.query(migrationSql);
  } finally {
    client.release();
  }
});

afterEach(async () => {
  await query(`TRUNCATE
    hub_custody_events,
    hub_physical_unit_placements,
    hub_physical_units,
    hub_purchase_allocations,
    outbox_events,
    purchase_orders,
    order_items,
    orders,
    product_skus,
    suppliers,
    users,
    markets
    CASCADE`);
});

afterAll(async () => {
  try {
    await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  } finally {
    await pool.end();
  }
});

describe('HUB-001 — market-safe physical identity', () => {
  test('mixed-market inbound is allowed, outbound is fail-closed until explicit physical split', async () => {
    const km = await seedPurchase({ qty: 1, supplierUnitRef: 'KM-UNIT' });
    const cm = await seedPurchase({ qty: 1, supplierUnitRef: 'CM-UNIT' });

    const inbound = await transact((client) => receiveSupplierPackage(client, {
      reference: 'SUP-MIX-001',
      externalRef: 'SUPPLIER-BOX-77',
      locationRef: 'HUB-DXB-RECEIVE',
      contents: [
        { purchase_order_id: km.po, quantity: 1 },
        { purchase_order_id: cm.po, quantity: 1 },
      ],
    }));

    expect(inbound.quarantined).toBe(false);
    expect(inbound.allocations).toHaveLength(2);
    expect(inbound.unit.market_id).toBeNull();

    await advanceToPicked(inbound.unit.id);

    await expect(transact((client) => transitionPhysicalUnit(client, {
      unitId: inbound.unit.id,
      toState: 'PACKED',
    }))).rejects.toThrow(/hub_outbound_market_not_homogeneous/);

    const stateAfterRejectedPack = await query(
      'SELECT state, market_id FROM hub_physical_units WHERE id=$1',
      [inbound.unit.id]
    );
    expect(stateAfterRejectedPack.rows[0]).toEqual({ state: 'PICKED', market_id: null });

    const targets = await transact(async (client) => {
      const kmUnit = await createPhysicalUnit(client, {
        reference: 'OUT-KM-001', unitType: 'MARKET_PARCEL', initialState: 'PICKED', locationRef: 'HUB-DXB-PACK',
      });
      const cmUnit = await createPhysicalUnit(client, {
        reference: 'OUT-CM-001', unitType: 'MARKET_PARCEL', initialState: 'PICKED', locationRef: 'HUB-DXB-PACK',
      });
      return { kmUnit, cmUnit };
    });

    const kmAllocation = inbound.allocations.find((x) => String(x.allocation.market_id) === String(km.market));
    const cmAllocation = inbound.allocations.find((x) => String(x.allocation.market_id) === String(cm.market));

    const splitA = await transact((client) => moveAllocationQuantity(client, {
      fromUnitId: inbound.unit.id,
      toUnitId: targets.kmUnit.id,
      allocationId: kmAllocation.allocation.id,
      quantity: 1,
      operationType: 'SPLIT',
    }));
    const splitB = await transact((client) => moveAllocationQuantity(client, {
      fromUnitId: inbound.unit.id,
      toUnitId: targets.cmUnit.id,
      allocationId: cmAllocation.allocation.id,
      quantity: 1,
      operationType: 'SPLIT',
    }));

    expect(splitA.operation_id).toBeTruthy();
    expect(splitB.source_state).toBe('SUPERSEDED');

    const packed = await transact(async (client) => {
      const a = await transitionPhysicalUnit(client, { unitId: targets.kmUnit.id, toState: 'PACKED' });
      const b = await transitionPhysicalUnit(client, { unitId: targets.cmUnit.id, toState: 'PACKED' });
      return { a, b };
    });

    expect(String(packed.a.unit.market_id)).toBe(String(km.market));
    expect(String(packed.b.unit.market_id)).toBe(String(cm.market));

    const allocationStillExact = await query(
      'SELECT purchase_order_id, order_item_id, product_sku_id, market_id, destination_ref FROM hub_purchase_allocations ORDER BY purchase_order_id'
    );
    expect(allocationStillExact.rows).toHaveLength(2);
    expect(allocationStillExact.rows.map((r) => String(r.market_id)).sort())
      .toEqual([String(km.market), String(cm.market)].sort());
  });

  test('economic allocation and custody history are immutable while SPLIT lineage is explicit', async () => {
    const purchase = await seedPurchase({ qty: 2 });
    const inbound = await transact((client) => receiveSupplierPackage(client, {
      reference: 'SUP-SPLIT-001',
      contents: [{ purchase_order_id: purchase.po, quantity: 2 }],
    }));
    const allocation = inbound.allocations[0].allocation;

    await advanceToPicked(inbound.unit.id);
    const target = await transact((client) => createPhysicalUnit(client, {
      reference: 'OUT-SPLIT-001', unitType: 'MARKET_PARCEL', initialState: 'PICKED',
    }));

    const move = await transact((client) => moveAllocationQuantity(client, {
      fromUnitId: inbound.unit.id,
      toUnitId: target.id,
      allocationId: allocation.id,
      quantity: 1,
      operationType: 'SPLIT',
    }));

    const active = await query(
      `SELECT physical_unit_id, quantity FROM hub_physical_unit_placements
        WHERE allocation_id=$1 AND removed_at IS NULL ORDER BY physical_unit_id`,
      [allocation.id]
    );
    expect(active.rows.map((r) => Number(r.quantity))).toEqual([1, 1]);

    const lineage = await query(
      `SELECT event_type, physical_unit_id, quantity, operation_type
         FROM hub_custody_events
        WHERE operation_id=$1 ORDER BY event_type`,
      [move.operation_id]
    );
    expect(lineage.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ event_type: 'PLACEMENT_OUT', operation_type: 'SPLIT' }),
      expect.objectContaining({ event_type: 'PLACEMENT_IN', operation_type: 'SPLIT' }),
    ]));

    await expect(query(
      'UPDATE hub_purchase_allocations SET market_id=$2 WHERE id=$1',
      [allocation.id, id()]
    )).rejects.toThrow(/hub_purchase_allocation_immutable/);

    const event = (await query('SELECT id FROM hub_custody_events WHERE operation_id=$1 LIMIT 1', [move.operation_id])).rows[0];
    await expect(query('UPDATE hub_custody_events SET details=$2::jsonb WHERE id=$1', [event.id, '{}']))
      .rejects.toThrow(/hub_custody_event_append_only/);

    const placement = (await query('SELECT id FROM hub_physical_unit_placements WHERE removed_at IS NULL LIMIT 1')).rows[0];
    await expect(query('DELETE FROM hub_physical_unit_placements WHERE id=$1', [placement.id]))
      .rejects.toThrow(/hub_placement_history_no_delete/);
  });

  test('concurrent physical placement cannot duplicate quantity bought', async () => {
    const purchase = await seedPurchase({ qty: 1 });
    const allocation = await transact((client) => snapshotPurchaseAllocation(client, purchase.po));
    const units = await transact(async (client) => ({
      a: await createPhysicalUnit(client, { reference: 'CONC-A', unitType: 'SUPPLIER_PACKAGE' }),
      b: await createPhysicalUnit(client, { reference: 'CONC-B', unitType: 'SUPPLIER_PACKAGE' }),
    }));

    const c1 = await clientInSchema();
    const c2 = await clientInSchema();
    try {
      await c1.query('BEGIN');
      await c2.query('BEGIN');

      await c1.query(
        `INSERT INTO hub_physical_unit_placements(physical_unit_id,allocation_id,quantity)
         VALUES ($1,$2,1)`,
        [units.a.id, allocation.id]
      );

      const secondInsert = c2.query(
        `INSERT INTO hub_physical_unit_placements(physical_unit_id,allocation_id,quantity)
         VALUES ($1,$2,1)`,
        [units.b.id, allocation.id]
      );

      await c1.query('COMMIT');
      await expect(secondInsert).rejects.toThrow(/hub_allocation_overplaced/);
      await c2.query('ROLLBACK');
    } finally {
      try { await c1.query('ROLLBACK'); } catch (_) {}
      try { await c2.query('ROLLBACK'); } catch (_) {}
      c1.release();
      c2.release();
    }

    const total = await query(
      `SELECT COALESCE(SUM(quantity),0)::integer AS quantity
         FROM hub_physical_unit_placements
        WHERE allocation_id=$1 AND removed_at IS NULL`,
      [allocation.id]
    );
    expect(Number(total.rows[0].quantity)).toBe(1);
  });

  test('missing exact supplier identity quarantines inbound instead of guessing', async () => {
    const purchase = await seedPurchase({ qty: 1 });
    await query('UPDATE purchase_orders SET supplier_order_identity=NULL WHERE id=$1', [purchase.po]);

    const result = await transact((client) => receiveSupplierPackage(client, {
      reference: 'SUP-BAD-SOI',
      contents: [{ purchase_order_id: purchase.po, quantity: 1 }],
    }));

    expect(result.quarantined).toBe(true);
    expect(result.reason_code).toBe('HUB_SUPPLIER_IDENTITY_UNRESOLVABLE');
    const counts = await query(`
      SELECT
        (SELECT COUNT(*) FROM hub_purchase_allocations)::integer AS allocations,
        (SELECT COUNT(*) FROM hub_physical_unit_placements)::integer AS placements
    `);
    expect(counts.rows[0]).toEqual({ allocations: 0, placements: 0 });
    expect((await query('SELECT state FROM hub_physical_units WHERE id=$1', [result.unit.id])).rows[0].state)
      .toBe('QUARANTINED');
  });
});

describe('HUB-001 — physical outcome transactional contract', () => {
  test('physical outcome + custody + outbox are atomic and replay-idempotent', async () => {
    const purchase = await seedPurchase({ qty: 1 });
    const inbound = await transact((client) => receiveSupplierPackage(client, {
      reference: 'SUP-LOSS-001',
      contents: [{ purchase_order_id: purchase.po, quantity: 1 }],
    }));

    const rollbackClient = await clientInSchema();
    try {
      await rollbackClient.query('BEGIN');
      const inside = await recordPhysicalUnitOutcome(rollbackClient, {
        unitId: inbound.unit.id,
        outcomeType: 'LOST',
        details: { reason: 'adversarial rollback proof' },
      });
      expect(inside.outbox_event_id).toBeTruthy();
      expect((await rollbackClient.query('SELECT COUNT(*)::integer AS n FROM outbox_events')).rows[0].n).toBe(1);
      expect((await rollbackClient.query('SELECT outcome_type FROM hub_physical_units WHERE id=$1', [inbound.unit.id])).rows[0].outcome_type)
        .toBe('LOST');
      await rollbackClient.query('ROLLBACK');
    } finally {
      rollbackClient.release();
    }

    expect((await query('SELECT state, outcome_type FROM hub_physical_units WHERE id=$1', [inbound.unit.id])).rows[0])
      .toEqual({ state: 'RECEIVED', outcome_type: null });
    expect((await query('SELECT COUNT(*)::integer AS n FROM outbox_events')).rows[0].n).toBe(0);
    expect((await query("SELECT COUNT(*)::integer AS n FROM hub_custody_events WHERE event_type='OUTCOME_REPORTED'")).rows[0].n).toBe(0);

    const committed = await transact((client) => recordPhysicalUnitOutcome(client, {
      unitId: inbound.unit.id,
      outcomeType: 'LOST',
      details: { reason: 'confirmed loss' },
    }));
    expect(committed.noop).toBe(false);

    const replay = await transact((client) => recordPhysicalUnitOutcome(client, {
      unitId: inbound.unit.id,
      outcomeType: 'LOST',
    }));
    expect(replay).toMatchObject({ noop: true, outbox_event_id: null });

    const finalState = await query('SELECT state, outcome_type, outcome_recorded_at FROM hub_physical_units WHERE id=$1', [inbound.unit.id]);
    expect(finalState.rows[0].state).toBe('QUARANTINED');
    expect(finalState.rows[0].outcome_type).toBe('LOST');
    expect(finalState.rows[0].outcome_recorded_at).toBeTruthy();
    expect((await query('SELECT COUNT(*)::integer AS n FROM outbox_events')).rows[0].n).toBe(1);
    expect((await query("SELECT COUNT(*)::integer AS n FROM hub_custody_events WHERE event_type='OUTCOME_REPORTED'")).rows[0].n).toBe(1);
  });

  test('a conflicting second physical outcome is rejected', async () => {
    const purchase = await seedPurchase({ qty: 1 });
    const inbound = await transact((client) => receiveSupplierPackage(client, {
      reference: 'SUP-OUTCOME-IMMUTABLE',
      contents: [{ purchase_order_id: purchase.po, quantity: 1 }],
    }));

    await transact((client) => recordPhysicalUnitOutcome(client, {
      unitId: inbound.unit.id,
      outcomeType: 'DESTROYED',
    }));

    await expect(transact((client) => recordPhysicalUnitOutcome(client, {
      unitId: inbound.unit.id,
      outcomeType: 'LOST',
    }))).rejects.toMatchObject({
      name: 'HubPhysicalError',
      code: 'HUB_PHYSICAL_OUTCOME_IMMUTABLE',
    });

    expect((await query('SELECT outcome_type FROM hub_physical_units WHERE id=$1', [inbound.unit.id])).rows[0].outcome_type)
      .toBe('DESTROYED');
  });
});
