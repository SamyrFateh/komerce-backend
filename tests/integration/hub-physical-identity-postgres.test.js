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
const { getOrderPhysicalCoverage } = require('../../services/order-physical-coverage-service');
const {
  HubPhysicalError,
  snapshotPurchaseAllocation,
  createPhysicalUnit,
  receiveSupplierPackage,
  transitionPhysicalUnit,
  moveAllocationQuantity,
  recordPhysicalUnitOutcome,
} = require('../../services/hub-physical-identity');

const {observeSupplierReceipt,attestSupplierReturn,listSupplierReceiptChecks}=require('../../services/hub-supplier-receipt-quality');

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

// PO regroupée (order_id NULL) : lignes ouvertes → PO draft → rattachement → PO confirmée.
async function seedGroupedPurchase({ quantities = [1, 1], confirmed = null, submit = true, singleMarket = null } = {}) {
  const supplier = id();
  const sku = id();
  const po = id();
  await query('INSERT INTO suppliers(id) VALUES ($1)', [supplier]);
  await query('INSERT INTO product_skus(id) VALUES ($1)', [sku]);
  const lines = [];
  for (const quantity of quantities) {
    const market = singleMarket || id();
    const order = id();
    const item = id();
    const line = id();
    await query('INSERT INTO markets(id) VALUES ($1) ON CONFLICT DO NOTHING', [market]);
    await query(
      'INSERT INTO orders(id, market_id, relais_id, reference, status) VALUES ($1,$2,$3,$4,$5)',
      [order, market, id(), `ORD-${order.slice(0, 8)}`, 'ordered']
    );
    await query('INSERT INTO order_items(id, order_id, sku_id, quantity) VALUES ($1,$2,$3,$4)', [item, order, sku, quantity]);
    await query(
      `INSERT INTO purchase_lines(id, order_item_id, supplier_id, product_sku_id, supplier_sku, supplier_unit_ref,
                                  supplier_order_identity, quantity, supplier_unit_price, supplier_currency, procurement_hub_ref)
       VALUES ($1,$2,$3,$4,'SKU','UNIT-G',$5::jsonb,$6,10,'USD','DXB')`,
      [line, item, supplier, sku, JSON.stringify({ provider: 'manual', version: 1, payload: { supplier_sku: 'UNIT-G' } }), quantity]
    );
    lines.push({ line, item, order, market, quantity });
  }
  await query(
    "INSERT INTO purchase_orders(id, order_id, supplier_id, status, supplier_sku) VALUES ($1, NULL, $2, 'draft', NULL)",
    [po, supplier]
  );
  await query('UPDATE purchase_lines SET purchase_order_id = $1 WHERE id = ANY($2::uuid[])', [po, lines.map((l) => l.line)]);
  if (submit) {
    await query("UPDATE purchase_orders SET status = 'notified' WHERE id = $1", [po]);
    await query("UPDATE purchase_orders SET status = 'confirmed' WHERE id = $1", [po]);
  }
  if (confirmed !== null) {
    for (let i = 0; i < lines.length; i += 1) {
      await query(
        'UPDATE purchase_lines SET confirmed_quantity = $2, confirmed_at = now() WHERE id = $1',
        [lines[i].line, confirmed[i]]
      );
    }
  }
  return { supplier, sku, po, lines };
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
      CREATE TABLE relais (id uuid PRIMARY KEY);
      CREATE TABLE suppliers (id uuid PRIMARY KEY, system_key text);
      CREATE TABLE product_skus (id uuid PRIMARY KEY);
      CREATE TABLE orders (
        id uuid PRIMARY KEY,
        market_id uuid,
        relais_id uuid,
        reference text,
        status text,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE order_items (
        id uuid PRIMARY KEY,
        order_id uuid NOT NULL REFERENCES orders(id),
        sku_id uuid REFERENCES product_skus(id),
        quantity integer NOT NULL DEFAULT 1
      );
      CREATE TABLE product_suppliers (id uuid PRIMARY KEY);
      CREATE TABLE purchase_orders (
        id uuid PRIMARY KEY,
        market_id uuid REFERENCES markets(id),
        order_id uuid REFERENCES orders(id),
        order_item_id uuid REFERENCES order_items(id),
        product_sku_id uuid REFERENCES product_skus(id),
        product_supplier_id uuid REFERENCES product_suppliers(id),
        supplier_id uuid NOT NULL REFERENCES suppliers(id),
        supplier_sku text NOT NULL DEFAULT 'SKU',
        trigger_mode text DEFAULT 'auto',
        supplier_unit_ref text,
        supplier_order_identity jsonb,
        qty integer,
        received_qty integer NOT NULL DEFAULT 0,
        supplier_unit_price numeric(18,4),
        supplier_currency text,
        status text NOT NULL,
        confirmed_at timestamptz,
        hub_received_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE incidents (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        parcel_id uuid,
        order_id uuid,
        order_item_id uuid,
        incident_type text NOT NULL,
        severity text NOT NULL DEFAULT 'medium',
        status text NOT NULL DEFAULT 'open',
        title text,
        description text,
        details jsonb NOT NULL DEFAULT '{}'::jsonb,
        detected_source text,
        origin_domain text,
        resolver_domain text,
        resolution_class text,
        due_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
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
    // Cette suite isole HUB-001 dans un schéma local créé depuis la migration 233.
    // Le writer canonique contient désormais les colonnes passives des lots 392/393 ;
    // leur présence doit être reproduite ici sans appliquer une migration public.*
    // à la base isolée ni changer les règles métier historiques testées.
    await client.query(`ALTER TABLE hub_physical_units
      ADD COLUMN order_id uuid, ADD COLUMN bag_plan jsonb`);
    await client.query(`ALTER TABLE hub_physical_unit_placements
      ADD COLUMN evidence_method text, ADD COLUMN evidence_code text, ADD COLUMN evidence_ref text`);
    for (const name of ['263_purchase_lines_foundation.sql', '264_purchase_line_progress_view.sql', '265_hub_allocations_purchase_line.sql', '266_purchase_orders_grouped_form.sql', '306_purchase_line_progress_physical.sql', '309_hub_placement_guard_exclude_outcomes.sql', '404_manual_purchase_executions.sql', '414_purchase_line_received_quantity.sql', '425_purchase_line_confirmed_currency.sql', '427_hub_opaque_scan_labels.sql', '450_hub_supplier_receipt_quality.sql']) {
      await client.query(fs.readFileSync(path.join(__dirname, '../../migrations', name), 'utf8').replace(/public\./g, `${schema}.`));
    }
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
    incidents,
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
        reference: 'OUT-KM-001', unitType: 'MARKET_PARCEL', initialState: 'RECEIVED', locationRef: 'HUB-DXB-PACK',
      });
      const cmUnit = await createPhysicalUnit(client, {
        reference: 'OUT-CM-001', unitType: 'MARKET_PARCEL', initialState: 'RECEIVED', locationRef: 'HUB-DXB-PACK',
      });
      return { kmUnit, cmUnit };
    });

    await advanceToPicked(targets.kmUnit.id);
    await advanceToPicked(targets.cmUnit.id);

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
      reference: 'OUT-SPLIT-001', unitType: 'MARKET_PARCEL', initialState: 'RECEIVED',
    }));

    await advanceToPicked(target.id);

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
    expect(result.incident).toMatchObject({
      status: 'open',
      resolver_domain: 'PURCHASING',
      resolution_class: 'UPSTREAM_TRUTH',
    });
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

describe('HUB-001 — DB creation hard stops', () => {
  test('direct INSERT cannot smuggle Market or outbound state into a physical unit', async () => {
    const market = id();
    await query('INSERT INTO markets(id) VALUES ($1)', [market]);

    await expect(query(
      `INSERT INTO hub_physical_units(reference, unit_type, state, market_id)
       VALUES ('SMUGGLE-MARKET', 'MARKET_PARCEL', 'RECEIVED', $1)`,
      [market]
    )).rejects.toThrow(/hub_market_only_derived_at_outbound/);

    await expect(query(
      `INSERT INTO hub_physical_units(reference, unit_type, state)
       VALUES ('SMUGGLE-PACKED', 'MARKET_PARCEL', 'PACKED')`
    )).rejects.toThrow(/hub_physical_initial_state_invalid/);

    await expect(transact((client) => createPhysicalUnit(client, {
      reference: 'SERVICE-SMUGGLE',
      unitType: 'MARKET_PARCEL',
      initialState: 'PACKED',
    }))).rejects.toMatchObject({
      name: 'HubPhysicalError',
      code: 'HUB_PHYSICAL_INITIAL_STATE_INVALID',
    });
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

describe('HUB-001 — réception par ligne d\'achat (PO regroupée)', () => {

  test('M03 Central Hub MANUAL : physical receipt only from exact confirmed execution evidence (PG)', async () => {
    const [market,supplier,sku,order,item,line,po,execution,relais] =
      Array.from({length:9},()=>id());
    await query('INSERT INTO markets(id) VALUES ($1)',[market]);
    await query("INSERT INTO suppliers(id,system_key) VALUES($1,'central_hub')",[supplier]);
    await query('INSERT INTO product_skus(id) VALUES($1)',[sku]);
    await query("INSERT INTO orders(id,market_id,relais_id,reference,status) VALUES($1,$2,$3,'G6-M03-TEST','ordered')",[order,market,relais]);
    await query('INSERT INTO order_items(id,order_id,sku_id,quantity) VALUES($1,$2,$3,1)',[item,order,sku]);
    await query(`INSERT INTO purchase_lines(
      id,order_item_id,supplier_id,product_sku_id,supplier_sku,supplier_unit_ref,
      supplier_order_identity,quantity,supplier_unit_price,supplier_currency,procurement_hub_ref)
      VALUES($1,$2,$3,$4,'CENTRAL',NULL,NULL,1,NULL,NULL,'DXB')`,[line,item,supplier,sku]);
    await query("INSERT INTO purchase_orders(id,order_id,supplier_id,status,trigger_mode,supplier_sku) VALUES($1,NULL,$2,'draft','manual',NULL)",[po,supplier]);
    await query('UPDATE purchase_lines SET purchase_order_id=$2 WHERE id=$1',[line,po]);
    await query("UPDATE purchase_orders SET status='notified' WHERE id=$1",[po]);
    await query("UPDATE purchase_lines SET confirmed_quantity=1,confirmed_unit_price=10,confirmed_currency='EUR',confirmed_at=now() WHERE id=$1",[line]);
    await query("UPDATE purchase_orders SET status='confirmed',confirmed_at=now() WHERE id=$1",[po]);

    const receive=(reference)=>transact(client=>receiveSupplierPackage(client,{
      reference,contents:[{purchase_order_id:po,product_sku_id:sku,quantity:1,
        evidence_method:'MANUAL',evidence_ref:'G6-SIMULATED-RECEIPT'}],
    }));
    const denied=await receive('G6-M03-UNPROVEN');
    expect(denied.quarantined).toBe(true);
    expect(denied.reason_code).toBe('HUB_SUPPLIER_IDENTITY_UNRESOLVABLE');
    const noReceived=await query('SELECT purchase_line_received_quantity($1)::int AS n',[line]);
    expect(noReceived.rows[0].n).toBe(0);

    await query(`INSERT INTO manual_purchase_executions(id,purchase_order_id,purchase_line_id,
      seller_label,channel,quantity,amount,currency,proof_ref)
      VALUES($1,$2,$3,'SIM-STAGING-SELLER','other',1,10,'EUR','SIM-STAGING-PROOF')`,[execution,po,line]);
    const received=await receive('G6-M03-WITH-PROOF');
    expect(received.quarantined).toBe(false);
    expect(received.allocations).toHaveLength(1);
    expect(received.allocations[0].allocation.supplier_order_identity).toEqual({
      provider:'komerce_manual_purchase_evidence',version:1,
      payload:{purchase_order_id:po,purchase_line_id:line,execution_ids:[execution]},
    });
    const unchanged=await query('SELECT supplier_unit_ref,supplier_order_identity FROM purchase_lines WHERE id=$1',[line]);
    expect(unchanged.rows[0]).toEqual({supplier_unit_ref:null,supplier_order_identity:null});
    const proof=await query('SELECT purchase_line_received_quantity($1)::int AS n',[line]);
    expect(proof.rows[0].n).toBe(1);

    const deniedDuplicate=await receive('G6-M03-DUPLICATE');
    expect(deniedDuplicate.quarantined).toBe(true);
    expect(deniedDuplicate.reason_code).toBe('HUB_ALLOCATION_OVERRECEIVED');
    const final=await query('SELECT purchase_line_received_quantity($1)::int AS n',[line]);
    expect(final.rows[0].n).toBe(1);
  });

  test('une réception sur une PO regroupée alloue par ligne, dans l\'ordre des commandes, et alimente la vue', async () => {
    const g = await seedGroupedPurchase({ quantities: [1, 2] });

    const inbound = await transact((client) => receiveSupplierPackage(client, {
      reference: 'SUP-GROUP-001',
      contents: [{ purchase_order_id: g.po, product_sku_id: g.sku, quantity: 2 }],
    }));

    expect(inbound.quarantined).toBe(false);
    expect(inbound.allocations).toHaveLength(2);
    expect(inbound.allocations.map((a) => String(a.allocation.purchase_line_id)).sort())
      .toEqual(g.lines.map((l) => String(l.line)).sort());

    // Le Hub reste l'autorité physique : chaque allocation garde le marché de la commande d'origine de sa ligne.
    const marketByLine = Object.fromEntries(g.lines.map((l) => [String(l.line), String(l.market)]));
    expect(inbound.allocations.every((a) => String(a.allocation.market_id) === marketByLine[String(a.allocation.purchase_line_id)])).toBe(true);
    expect(new Set(inbound.allocations.map((a) => String(a.allocation.market_id))).size).toBe(2);
    expect(inbound.unit.market_id).toBeNull();

    const progress = await query(
      'SELECT line_id, received_quantity, effective_quantity FROM v_purchase_line_progress WHERE purchase_order_id = $1',
      [g.po]
    );
    const received = Object.fromEntries(progress.rows.map((r) => [String(r.line_id), Number(r.received_quantity)]));
    expect(Object.values(received).reduce((a, b) => a + b, 0)).toBe(2);
  });

  test('sans product_sku_id, une PO regroupée est refusée', async () => {
    const g = await seedGroupedPurchase();
    const result = await transact((client) => receiveSupplierPackage(client, {
      reference: 'SUP-GROUP-NOSKU',
      contents: [{ purchase_order_id: g.po, quantity: 1 }],
    }));
    expect(result).toMatchObject({ quarantined: true, reason_code: 'HUB_PURCHASE_SKU_MISMATCH' });
    expect((await query('SELECT COUNT(*)::integer AS n FROM hub_purchase_allocations')).rows[0].n).toBe(0);
  });

  test('un SKU étranger à la PO regroupée est refusé', async () => {
    const g = await seedGroupedPurchase();
    await query('INSERT INTO product_skus(id) VALUES ($1)', [id()]);
    const result = await transact((client) => receiveSupplierPackage(client, {
      reference: 'SUP-GROUP-OTHERSKU',
      contents: [{ purchase_order_id: g.po, product_sku_id: id(), quantity: 1 }],
    }));
    expect(result).toMatchObject({ quarantined: true, reason_code: 'HUB_PURCHASE_SKU_MISMATCH' });
    expect((await query('SELECT COUNT(*)::integer AS n FROM hub_purchase_allocations')).rows[0].n).toBe(0);
  });

  test('une réception supérieure au restant dû des lignes est refusée', async () => {
    const g = await seedGroupedPurchase({ quantities: [1, 1] });
    const result = await transact((client) => receiveSupplierPackage(client, {
      reference: 'SUP-GROUP-OVER',
      contents: [{ purchase_order_id: g.po, product_sku_id: g.sku, quantity: 3 }],
    }));
    expect(result).toMatchObject({ quarantined: true, reason_code: 'HUB_ALLOCATION_OVERRECEIVED' });
    expect((await query('SELECT COUNT(*)::integer AS n FROM hub_purchase_allocations')).rows[0].n).toBe(0);
  });

  test('lot 6 : PO regroupée — une unité perdue ne compte plus, son remplacement est reçu (garde service ET trigger)', async () => {
    const g = await seedGroupedPurchase({ quantities: [1] });
    const first = await transact((client) => receiveSupplierPackage(client, {
      reference: 'SUP-GRP-LOST-1',
      contents: [{ purchase_order_id: g.po, product_sku_id: g.sku, quantity: 1 }],
    }));
    expect(first.quarantined).toBeFalsy();

    // Sans perte déclarée : refus (garde service). Le trigger SQL refuse aussi un placement direct en excès.
    const over = await transact((client) => receiveSupplierPackage(client, {
      reference: 'SUP-GRP-LOST-OVER',
      contents: [{ purchase_order_id: g.po, product_sku_id: g.sku, quantity: 1 }],
    }));
    expect(over).toMatchObject({ quarantined: true, reason_code: 'HUB_ALLOCATION_OVERRECEIVED' });
    const allocationId = (await query('SELECT id FROM hub_purchase_allocations LIMIT 1')).rows[0].id;
    const extra = (await query(
      `INSERT INTO hub_physical_units(reference, unit_type, state) VALUES ('SUP-GRP-DIRECT', 'SUPPLIER_PACKAGE', 'RECEIVED') RETURNING id`
    )).rows[0].id;
    await expect(query(
      `INSERT INTO hub_physical_unit_placements(physical_unit_id, allocation_id, quantity, operation_id, operation_type)
       VALUES ($1,$2,1,$3,'RECEIVE')`,
      [extra, allocationId, id()]
    )).rejects.toThrow(/hub_allocation_overplaced/);

    await transact((client) => recordPhysicalUnitOutcome(client, { unitId: first.unit.id, outcomeType: 'LOST' }));
    const replacement = await transact((client) => receiveSupplierPackage(client, {
      reference: 'SUP-GRP-LOST-2',
      contents: [{ purchase_order_id: g.po, product_sku_id: g.sku, quantity: 1 }],
    }));
    expect(replacement.quarantined).toBeFalsy();
  });

  test('la quantité confirmée réduite par le fournisseur plafonne la réception', async () => {
    const g = await seedGroupedPurchase({ quantities: [2], confirmed: [1] });
    const result = await transact((client) => receiveSupplierPackage(client, {
      reference: 'SUP-GROUP-CONFIRMED',
      contents: [{ purchase_order_id: g.po, product_sku_id: g.sku, quantity: 2 }],
    }));
    expect(result).toMatchObject({ quarantined: true, reason_code: 'HUB_ALLOCATION_OVERRECEIVED' });
    expect((await query('SELECT COUNT(*)::integer AS n FROM hub_purchase_allocations')).rows[0].n).toBe(0);
  });

  test('une PO regroupée encore en brouillon n\'est pas recevable (rien n\'est engagé auprès du fournisseur)', async () => {
    const g = await seedGroupedPurchase({ submit: false });
    const result = await transact((client) => receiveSupplierPackage(client, {
      reference: 'SUP-GROUP-DRAFT',
      contents: [{ purchase_order_id: g.po, product_sku_id: g.sku, quantity: 1 }],
    }));
    expect(result).toMatchObject({ quarantined: true, reason_code: 'HUB_PURCHASE_ORDER_NOT_SUBMITTED' });
    expect((await query('SELECT COUNT(*)::integer AS n FROM hub_purchase_allocations')).rows[0].n).toBe(0);
  });

  test('une PO regroupée annulée n\'est pas recevable', async () => {
    const g = await seedGroupedPurchase();
    await query("UPDATE purchase_orders SET status = 'cancelled' WHERE id = $1", [g.po]);
    const result = await transact((client) => receiveSupplierPackage(client, {
      reference: 'SUP-GROUP-CANCELLED',
      contents: [{ purchase_order_id: g.po, product_sku_id: g.sku, quantity: 1 }],
    }));
    expect(result).toMatchObject({ quarantined: true, reason_code: 'HUB_PURCHASE_ORDER_CANCELLED' });
    expect((await query('SELECT COUNT(*)::integer AS n FROM hub_purchase_allocations')).rows[0].n).toBe(0);
  });

  test('la base refuse une allocation au niveau PO pour une PO regroupée', async () => {
    const g = await seedGroupedPurchase({ quantities: [1] });
    await expect(query(
      `INSERT INTO hub_purchase_allocations(purchase_order_id, order_id, order_item_id, product_sku_id, supplier_id,
                                            supplier_unit_ref, supplier_order_identity, quantity, market_id, destination_ref)
       VALUES ($1,$2,$3,$4,$5,'UNIT-G','{}'::jsonb,1,$6,'x')`,
      [g.po, g.lines[0].order, g.lines[0].item, g.sku, g.supplier, g.lines[0].market]
    )).rejects.toThrow(/hub_allocation_grouped_requires_line/);
  });

  test('la base refuse une allocation dont l\'instantané ne décrit pas la ligne', async () => {
    const g = await seedGroupedPurchase({ quantities: [1, 1] });
    await expect(query(
      `INSERT INTO hub_purchase_allocations(purchase_order_id, purchase_line_id, order_id, order_item_id, product_sku_id,
                                            supplier_id, supplier_unit_ref, supplier_order_identity, quantity, market_id, destination_ref)
       VALUES ($1,$2,$3,$4,$5,$6,'UNIT-G','{}'::jsonb,1,$7,'x')`,
      [g.po, g.lines[0].line, g.lines[1].order, g.lines[1].item, g.sku, g.supplier, g.lines[1].market]
    )).rejects.toThrow(/hub_allocation_line_mismatch/);
  });
});


describe('C2 — couverture physique quantitative avant préparation (PO historiques)', () => {
  beforeAll(async () => {
    await query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS simulation_scope text');
    await query('ALTER TABLE order_items ADD COLUMN IF NOT EXISTS fulfillment_source text');
  });

  const coverage = (orderId) => transact((client) => getOrderPhysicalCoverage(client, orderId));
  const usableOnView = async (po) => (await query('SELECT COALESCE(SUM(received_quantity),0)::int AS n FROM v_purchase_line_progress WHERE purchase_order_id=$1', [po])).rows[0].n;
  async function seedHistorical(qty) {
    const purchase = await seedPurchase({ qty });
    await query('UPDATE order_items SET quantity=$2 WHERE id=$1', [purchase.item, qty]);
    return purchase;
  }
  const receive = (purchase, quantity, reference) => transact((client) => receiveSupplierPackage(client, {
    reference, contents: [{ purchase_order_id: purchase.po, quantity }],
  }));

  test('le compteur déclaratif received_qty ne prouve rien : aucune couverture sans placement physique', async () => {
    const purchase = await seedHistorical(2);
    await query('UPDATE purchase_orders SET received_qty = 2, status = $2, hub_received_at = now() WHERE id = $1', [purchase.po, 'hub_received']);
    const c = await coverage(purchase.order);
    expect(c.covered).toBe(false);
    expect(c.uncovered[0]).toMatchObject({ needed: 2, usable: 0, missing: 2 });
    expect(await usableOnView(purchase.po)).toBe(0);
  });

  test('réception physique complète : couverte ; rejouer la même référence ne double rien (idempotence)', async () => {
    const purchase = await seedHistorical(2);
    await receive(purchase, 2, 'C2-FULL-1');
    expect((await coverage(purchase.order)).covered).toBe(true);
    await receive(purchase, 2, 'C2-FULL-1').catch(() => null);
    expect(await usableOnView(purchase.po)).toBe(2);
    expect((await coverage(purchase.order)).covered).toBe(true);
  });

  test('réception partielle préservée : manquant exact, puis couverture au complément', async () => {
    const purchase = await seedHistorical(3);
    await receive(purchase, 1, 'C2-PART-1');
    const partial = await coverage(purchase.order);
    expect(partial.covered).toBe(false);
    expect(partial.uncovered[0]).toMatchObject({ needed: 3, usable: 1, missing: 2 });
    await receive(purchase, 2, 'C2-PART-2');
    expect((await coverage(purchase.order)).covered).toBe(true);
  });

  test('unité en quarantaine ou perdue : exclue de la couverture', async () => {
    const quarantined = await seedHistorical(1);
    const inbound = await receive(quarantined, 1, 'C2-QUAR-1');
    expect((await coverage(quarantined.order)).covered).toBe(true);
    await query("UPDATE hub_physical_units SET state='QUARANTINED' WHERE id=$1", [inbound.unit.id]);
    expect((await coverage(quarantined.order)).covered).toBe(false);

    const lost = await seedHistorical(1);
    const inbound2 = await receive(lost, 1, 'C2-LOST-1');
    await transact((client) => recordPhysicalUnitOutcome(client, { unitId: inbound2.unit.id, outcomeType: 'LOST', details: { reason: 'c2' } }));
    expect((await coverage(lost.order)).covered).toBe(false);
  });

  test('SPLIT : la matière déplacée n\'est comptée qu\'une fois ; l\'unité fille perdue retire sa part', async () => {
    const purchase = await seedHistorical(2);
    const inbound = await receive(purchase, 2, 'C2-SPLIT-1');
    const allocation = inbound.allocations[0].allocation;
    await advanceToPicked(inbound.unit.id);
    const target = await transact((client) => createPhysicalUnit(client, { reference: 'C2-OUT-1', unitType: 'MARKET_PARCEL', initialState: 'RECEIVED' }));
    await advanceToPicked(target.id);
    await transact((client) => moveAllocationQuantity(client, {
      fromUnitId: inbound.unit.id, toUnitId: target.id, allocationId: allocation.id, quantity: 1, operationType: 'SPLIT',
    }));
    expect(await usableOnView(purchase.po)).toBe(2);
    expect((await coverage(purchase.order)).covered).toBe(true);
    await transact((client) => recordPhysicalUnitOutcome(client, { unitId: target.id, outcomeType: 'DAMAGED_UNUSABLE', details: { reason: 'c2' } }));
    const after = await coverage(purchase.order);
    expect(after.covered).toBe(false);
    expect(after.uncovered[0]).toMatchObject({ needed: 2, usable: 1, missing: 1 });
  });

  test('MERGE : unité consolidée perdue exclue de C2, remplacement reçu sans double comptage', async () => {
    const purchase = await seedHistorical(2);
    const first = await receive(purchase, 1, 'C2-MERGE-IN-1');
    const second = await receive(purchase, 1, 'C2-MERGE-IN-2');
    const allocationId = first.allocations[0].allocation.id;
    expect(second.allocations[0].allocation.id).toBe(allocationId);

    const target = await transact((client) => createPhysicalUnit(client, {
      reference: 'C2-MERGE-OUT-1', unitType: 'MARKET_PARCEL', initialState: 'RECEIVED',
    }));
    for (const unitId of [first.unit.id, second.unit.id, target.id]) {
      await advanceToPicked(unitId);
    }

    await transact((client) => moveAllocationQuantity(client, {
      fromUnitId: first.unit.id, toUnitId: target.id,
      allocationId, quantity: 1, operationType: 'SPLIT',
    }));
    const merged = await transact((client) => moveAllocationQuantity(client, {
      fromUnitId: second.unit.id, toUnitId: target.id,
      allocationId, quantity: 1, operationType: 'MERGE',
    }));
    expect(merged.source_state).toBe('SUPERSEDED');
    expect(await usableOnView(purchase.po)).toBe(2);
    expect((await coverage(purchase.order)).covered).toBe(true);

    const { rows: [placementBeforeLoss] } = await query(
      `SELECT COALESCE(SUM(quantity), 0)::integer AS qty
         FROM hub_physical_unit_placements
        WHERE allocation_id = $1 AND physical_unit_id = $2 AND removed_at IS NULL`,
      [allocationId, target.id]
    );
    expect(placementBeforeLoss.qty).toBe(2);

    await transact((client) => recordPhysicalUnitOutcome(client, {
      unitId: target.id, outcomeType: 'LOST', details: { reason: 'c2-merge' },
    }));
    expect(await usableOnView(purchase.po)).toBe(0);
    expect((await coverage(purchase.order)).uncovered[0])
      .toMatchObject({ needed: 2, usable: 0, missing: 2 });

    const replacement = await receive(purchase, 2, 'C2-MERGE-REPLACEMENT');
    expect(replacement.quarantined).toBe(false);
    expect(replacement.allocations[0].allocation.id).toBe(allocationId);
    expect(await usableOnView(purchase.po)).toBe(2);
    expect((await coverage(purchase.order)).covered).toBe(true);

    const { rows: [activeQuantity] } = await query(
      `SELECT COALESCE(SUM(p.quantity), 0)::integer AS qty
         FROM hub_physical_unit_placements p
         JOIN hub_physical_units u ON u.id = p.physical_unit_id
        WHERE p.allocation_id = $1 AND p.removed_at IS NULL AND u.outcome_type IS NULL`,
      [allocationId]
    );
    expect(activeQuantity.qty).toBe(2);
  });

  test('LOCAL_STOCK exclu ; ligne importée sans aucun achat = couverture 0 ; commande de simulation hors périmètre', async () => {
    const purchase = await seedHistorical(1);
    await query("UPDATE order_items SET fulfillment_source='LOCAL_STOCK' WHERE id=$1", [purchase.item]);
    expect((await coverage(purchase.order)).covered).toBe(true);
    await query("UPDATE order_items SET fulfillment_source='IMPORT' WHERE id=$1", [purchase.item]);
    await query('DELETE FROM purchase_orders WHERE id=$1', [purchase.po]);
    expect((await coverage(purchase.order)).uncovered[0]).toMatchObject({ needed: 1, usable: 0 });
    await query("UPDATE orders SET simulation_scope='RCT1' WHERE id=$1", [purchase.order]);
    expect((await coverage(purchase.order)).covered).toBe(true);
  });
});


describe('Réception V3 — preuve PostgreSQL réelle dans un schéma jetable',()=>{
  async function fixture(quantities=[5]){
    const market=id(),actor=id();
    const g=await seedGroupedPurchase({quantities,singleMarket:market});
    await query('UPDATE purchase_orders SET market_id=$2 WHERE id=$1',[g.po,market]);
    await query('INSERT INTO users(id) VALUES($1)',[actor]);
    const observe=(reference,received,rejected,overrides={})=>transact(client=>observeSupplierReceipt(client,{
      purchaseOrderId:g.po,marketId:market,actorId:actor,reference,physicalConfirmed:true,
      observations:[{product_sku_id:g.sku,received_quantity:received,rejected_quantity:rejected,quantity_confirmed:true,evidence_method:'MANUAL',evidence_ref:'Contrôle physique réel de recette'}],...overrides
    }));
    const remaining=async()=>listSupplierReceiptChecks({query},{purchaseOrderId:g.po,marketId:market});
    const received=async()=>Number((await query('SELECT SUM(purchase_line_received_quantity(id)) AS n FROM purchase_lines WHERE purchase_order_id=$1',[g.po])).rows[0].n);
    return {g,market,actor,observe,remaining,received};
  }
  test('mixte : seuls les conformes entrent dans le writer, retour partiel puis remplacement',async()=>{
    const f=await fixture([2,3]);
    const once=await f.observe('V3-MIX',4,1);
    expect(once.replayed).toBe(false);
    expect(await f.received()).toBe(3);
    const unit=(await query('SELECT state FROM hub_physical_units WHERE id=$1',[once.check.conforming_unit_id])).rows[0];
    expect(unit.state).toBe('QUALITY_CHECKED');
    const again=await f.observe('V3-MIX',4,1);
    expect(again.replayed).toBe(true);
    expect(again.check.id).toBe(once.check.id);
    expect(await f.received()).toBe(3);
    const [line]=(await f.remaining()).checks;
    expect(line).toMatchObject({expected_quantity:5,received_quantity:4,rejected_quantity:1,conforming_quantity:3,missing_quantity:1,to_return_quantity:1});
    const result=await transact(client=>attestSupplierReturn(client,{checkLineId:line.line_id,marketId:f.market,actorId:f.actor,reference:'RET-MIX',quantity:1,physicalConfirmed:true}));
    expect(result.replayed).toBe(false);
    expect((await f.remaining()).checks[0].to_return_quantity).toBe(0);
    expect(await f.received()).toBe(3);
    await f.observe('V3-REPLACEMENT',2,0);
    expect(await f.received()).toBe(5);
  });
  test('tout refusé : aucun placement, retour concurrent plafonné et historique immuable',async()=>{
    const f=await fixture([2]);
    const once=await f.observe('V3-ALL-BAD',2,2);
    expect(once.check.conforming_unit_id).toBeNull();
    expect(await f.received()).toBe(0);
    const [line]=(await f.remaining()).checks;
    const handoff=reference=>transact(client=>attestSupplierReturn(client,{checkLineId:line.line_id,marketId:f.market,actorId:f.actor,reference,quantity:2,physicalConfirmed:true}));
    const results=await Promise.allSettled([handoff('RET-RACE-A'),handoff('RET-RACE-B')]);
    expect(results.filter(x=>x.status==='fulfilled')).toHaveLength(1);
    expect(results.find(x=>x.status==='rejected').reason.code).toBe('HUB_SUPPLIER_RETURN_EXCEEDS_REJECTED');
    expect((await f.remaining()).checks[0]).toMatchObject({returned_quantity:2,to_return_quantity:0});
    await expect(query('UPDATE hub_supplier_receipt_check_lines SET rejected_quantity=0 WHERE id=$1',[line.line_id])).rejects.toMatchObject({code:'P0001'});
    await expect(query('INSERT INTO hub_supplier_return_attestations(reference,check_line_id,quantity,returned_by) VALUES($1,$2,1,$3)',['RET-DB-BYPASS',line.line_id,f.actor])).rejects.toMatchObject({code:'23514'});
    expect(await f.received()).toBe(0);
  });
  test('réception concurrente de la même matière : une seule gagnante et aucun dépassement',async()=>{
    const f=await fixture([2]);
    const results=await Promise.allSettled([f.observe('V3-RACE-A',2,0),f.observe('V3-RACE-B',2,0)]);
    expect(results.filter(x=>x.status==='fulfilled')).toHaveLength(1);
    expect(results.find(x=>x.status==='rejected').reason.code).toBe('HUB_QUALITY_NO_REMAINING');
    expect(await f.received()).toBe(2);
    expect((await f.remaining()).checks).toHaveLength(1);
  });
  test('scope étranger et rollback : aucun constat ou placement résiduel',async()=>{
    const f=await fixture([2]);
    await expect(f.observe('V3-FOREIGN',2,0,{marketId:id()})).rejects.toMatchObject({code:'HUB_QUALITY_PO_SCOPE'});
    await expect(transact(async client=>{
      await observeSupplierReceipt(client,{purchaseOrderId:f.g.po,marketId:f.market,actorId:f.actor,reference:'V3-ROLLBACK',physicalConfirmed:true,
        observations:[{product_sku_id:f.g.sku,received_quantity:2,rejected_quantity:0,quantity_confirmed:true,evidence_method:'MANUAL',evidence_ref:'Contrôle physique réel'}]});
      throw Error('ROLLBACK_TEST');
    })).rejects.toThrow('ROLLBACK_TEST');
    expect(await f.received()).toBe(0);
    expect((await f.remaining()).checks).toEqual([]);
  });
});
