'use strict';

/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 * @integration hub-physical-hardening-postgres.test.js
 * @brief HUB-001 hardening — outbound mono-destination + quarantaine F2/F3 résoluble.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');
const {
  receiveSupplierPackage,
  revalidateQuarantinedInbound,
  createPhysicalUnit,
  transitionPhysicalUnit,
  moveAllocationQuantity,
  recordPhysicalUnitOutcome,
} = require('../../services/hub-physical-identity');

jest.setTimeout(30000);

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const schema = `hub001_hard_${process.pid}_${Date.now()}`.replace(/[^a-zA-Z0-9_]/g, '_');
const migration233 = fs.readFileSync(
  path.join(__dirname, '../../migrations/233_hub_physical_identity_allocation_custody.sql'),
  'utf8'
);
const migration234 = fs.readFileSync(
  path.join(__dirname, '../../migrations/234_hub_outbound_destination_and_quarantine_release.sql'),
  'utf8'
);

function id() { return crypto.randomUUID(); }

async function clientInSchema() {
  const client = await pool.connect();
  await client.query(`SET search_path TO ${schema}, public`);
  return client;
}

async function query(sql, params = []) {
  const client = await clientInSchema();
  try { return await client.query(sql, params); }
  finally { client.release(); }
}

async function transact(fn) {
  const client = await clientInSchema();
  try {
    await client.query('BEGIN');
    const value = await fn(client);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw error;
  } finally {
    client.release();
  }
}

async function seedPurchase({ marketId, relaisId, qty = 1, supplierUnitRef = 'UNIT-1', soi } = {}) {
  const market = marketId || id();
  const destination = relaisId || id();
  const supplier = id();
  const sku = id();
  const order = id();
  const item = id();
  const po = id();
  const identity = soi === undefined
    ? { provider: 'manual', version: 1, payload: { supplier_sku: supplierUnitRef } }
    : soi;

  await query('INSERT INTO markets(id) VALUES ($1) ON CONFLICT DO NOTHING', [market]);
  await query('INSERT INTO suppliers(id) VALUES ($1)', [supplier]);
  await query('INSERT INTO product_skus(id) VALUES ($1)', [sku]);
  await query(
    'INSERT INTO orders(id, market_id, relais_id, reference, status) VALUES ($1,$2,$3,$4,$5)',
    [order, market, destination, `ORD-${order.slice(0, 8)}`, 'ordered']
  );
  await query('INSERT INTO order_items(id, order_id, sku_id) VALUES ($1,$2,$3)', [item, order, sku]);
  await query(
    `INSERT INTO purchase_orders(
       id, order_id, order_item_id, product_sku_id, supplier_id,
       supplier_unit_ref, supplier_order_identity, qty, status
     ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,'confirmed')`,
    [po, order, item, sku, supplier, supplierUnitRef, identity ? JSON.stringify(identity) : null, qty]
  );
  return { market, destination, supplier, sku, order, item, po };
}

async function advanceToPicked(unitId) {
  return transact(async (client) => {
    for (const state of ['IDENTIFIED', 'QUALITY_CHECKED', 'LOCATED', 'ALLOCATED', 'PICKED']) {
      await transitionPhysicalUnit(client, { unitId, toState: state, locationRef: 'HUB-A1' });
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
      CREATE TABLE incidents (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        parcel_id uuid,
        order_id uuid,
        order_item_id uuid,
        scan_event_id uuid,
        incident_type text NOT NULL,
        severity text NOT NULL DEFAULT 'medium',
        status text NOT NULL DEFAULT 'open',
        title text,
        description text,
        details jsonb NOT NULL DEFAULT '{}'::jsonb,
        client_impact text NOT NULL DEFAULT 'none',
        client_notified boolean NOT NULL DEFAULT false,
        detected_by uuid,
        detected_source text,
        origin_domain text,
        resolver_domain text,
        resolution_class text,
        due_at timestamptz,
        escalation_level integer NOT NULL DEFAULT 0,
        resolution_type text,
        resolution jsonb,
        resolved_at timestamptz,
        resolved_by uuid,
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
    await client.query(migration233);
    await client.query(migration234);
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
  try { await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); }
  finally { await pool.end(); }
});

describe('HUB-001 hardening — destination commerciale', () => {
  test('same Market but different relais cannot become one outbound Market Parcel', async () => {
    const market = id();
    const a = await seedPurchase({ marketId: market, relaisId: id(), supplierUnitRef: 'A' });
    const b = await seedPurchase({ marketId: market, relaisId: id(), supplierUnitRef: 'B' });

    const inbound = await transact((client) => receiveSupplierPackage(client, {
      reference: 'IN-SAME-MARKET-DIFF-DEST',
      contents: [
        { purchase_order_id: a.po, quantity: 1 },
        { purchase_order_id: b.po, quantity: 1 },
      ],
    }));
    expect(inbound.quarantined).toBe(false);

    const target = await transact((client) => createPhysicalUnit(client, {
      reference: 'OUT-MIXED-DEST', unitType: 'MARKET_PARCEL', initialState: 'RECEIVED',
    }));
    await advanceToPicked(target.id);

    for (const item of inbound.allocations) {
      await transact((client) => moveAllocationQuantity(client, {
        fromUnitId: inbound.unit.id,
        toUnitId: target.id,
        allocationId: item.allocation.id,
        quantity: 1,
        operationType: 'SPLIT',
      }));
    }

    await expect(transact((client) => transitionPhysicalUnit(client, {
      unitId: target.id,
      toState: 'PACKED',
    }))).rejects.toThrow(/hub_outbound_destination_not_homogeneous/);

    const { rows: [state] } = await query('SELECT state, market_id FROM hub_physical_units WHERE id=$1', [target.id]);
    expect(state).toEqual({ state: 'PICKED', market_id: null });
  });
});

describe('HUB-001 hardening — quarantaine gouvernée F2/F3', () => {
  test('orphan non-destructive quarantine is rejected at commit', async () => {
    await expect(transact((client) => createPhysicalUnit(client, {
      reference: 'ORPHAN-QUARANTINE',
      unitType: 'SUPPLIER_PACKAGE',
      initialState: 'QUARANTINED',
    }))).rejects.toThrow(/hub_quarantine_incident_required/);

    expect((await query("SELECT COUNT(*)::integer AS n FROM hub_physical_units WHERE reference='ORPHAN-QUARANTINE'")).rows[0].n)
      .toBe(0);
  });

  test('missing SOI creates durable Purchasing incident and cannot release while OPEN', async () => {
    const purchase = await seedPurchase({ soi: null });
    const result = await transact((client) => receiveSupplierPackage(client, {
      reference: 'IN-MISSING-SOI',
      contents: [{ purchase_order_id: purchase.po, quantity: 1 }],
    }));

    expect(result.quarantined).toBe(true);
    expect(result.reason_code).toBe('HUB_SUPPLIER_IDENTITY_UNRESOLVABLE');
    expect(result.incident).toMatchObject({
      incident_type: 'reconciliation_error',
      status: 'open',
      origin_domain: 'PURCHASING',
      resolver_domain: 'PURCHASING',
      resolution_class: 'UPSTREAM_TRUTH',
    });
    expect(result.incident.due_at).toBeTruthy();
    expect(result.incident.details).toMatchObject({
      type: 'hub_purchase_identity_conflict',
      physical_unit_id: String(result.unit.id),
      purchase_order_id: String(purchase.po),
    });

    await expect(query(
      "UPDATE hub_physical_units SET state='RECEIVED' WHERE id=$1",
      [result.unit.id]
    )).rejects.toThrow(/hub_quarantine_incident_active/);
  });

  test('authoritative SOI correction + F3 revalidation resolves incident and materializes the same physical unit', async () => {
    const purchase = await seedPurchase({ soi: null });
    const quarantined = await transact((client) => receiveSupplierPackage(client, {
      reference: 'IN-REVALIDATE-SOI',
      contents: [{ purchase_order_id: purchase.po, quantity: 1 }],
    }));

    await query(
      `UPDATE purchase_orders
          SET supplier_order_identity=$2::jsonb
        WHERE id=$1`,
      [purchase.po, JSON.stringify({ provider: 'manual', version: 1, payload: { supplier_sku: 'UNIT-1' } })]
    );

    const result = await transact((client) => revalidateQuarantinedInbound(client, {
      unitId: quarantined.unit.id,
      incidentId: quarantined.incident.id,
      notes: 'SOI corrected by Purchasing',
    }));

    expect(result.resolved).toBe(true);
    expect(result.unit.state).toBe('RECEIVED');
    expect(result.allocations).toHaveLength(1);

    const { rows: [incident] } = await query(
      'SELECT status, resolution_type, resolver_domain FROM incidents WHERE id=$1',
      [quarantined.incident.id]
    );
    expect(incident).toEqual({
      status: 'resolved',
      resolution_type: 'auto_resolved',
      resolver_domain: 'PURCHASING',
    });

    const { rows: [placement] } = await query(
      `SELECT p.quantity, a.purchase_order_id
         FROM hub_physical_unit_placements p
         JOIN hub_purchase_allocations a ON a.id=p.allocation_id
        WHERE p.physical_unit_id=$1 AND p.removed_at IS NULL`,
      [quarantined.unit.id]
    );
    expect(Number(placement.quantity)).toBe(1);
    expect(String(placement.purchase_order_id)).toBe(String(purchase.po));
  });

  test('destructive outcome may quarantine without repair incident and remains terminal', async () => {
    const purchase = await seedPurchase();
    const inbound = await transact((client) => receiveSupplierPackage(client, {
      reference: 'IN-DESTRUCTIVE',
      contents: [{ purchase_order_id: purchase.po, quantity: 1 }],
    }));

    const outcome = await transact((client) => recordPhysicalUnitOutcome(client, {
      unitId: inbound.unit.id,
      outcomeType: 'DESTROYED',
    }));
    expect(outcome.unit).toMatchObject({ state: 'QUARANTINED', outcome_type: 'DESTROYED' });
    expect((await query('SELECT COUNT(*)::integer AS n FROM incidents')).rows[0].n).toBe(0);

    await expect(query(
      "UPDATE hub_physical_units SET state='RECEIVED' WHERE id=$1",
      [inbound.unit.id]
    )).rejects.toThrow(/hub_destructive_outcome_quarantine_terminal/);
  });
});
