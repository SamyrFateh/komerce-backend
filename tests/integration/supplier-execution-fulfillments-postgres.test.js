'use strict';

/** @test-kind integration @test-runner jest @test-requires postgres */

const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const { persistSupplierFulfillment } = require('../../services/suppliers/supplier-fulfillment-persistence');

const sql = (name) => fs.readFileSync(path.join(__dirname, '../../migrations', name), 'utf8');

describe('supplier_execution_fulfillments persistence', () => {
  let pool;
  let schema;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    schema = 't_fulfillment_' + Date.now();
    await pool.query(`CREATE SCHEMA ${schema}`);
    await pool.query(`CREATE TABLE ${schema}.purchase_orders (id uuid PRIMARY KEY)`);
    await pool.query(`CREATE TABLE ${schema}.purchase_lines (id uuid PRIMARY KEY)`);
    await pool.query(sql('279_supplier_execution_persistence.sql').replace(/public\./g, `${schema}.`));
    await pool.query(sql('284_supplier_execution_fulfillments.sql').replace(/public\./g, `${schema}.`));
  });

  afterAll(async () => {
    if (pool) {
      await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await pool.end();
    }
  });

  test('persists and refreshes one idempotent provider-side fulfillment fact without claiming Hub receipt', async () => {
    const client = await pool.connect();
    try {
      await client.query(`SET search_path TO ${schema}, public`);
      const po = '00000000-0000-4000-8000-000000000001';
      await client.query('INSERT INTO purchase_orders(id) VALUES ($1)', [po]);

      const { rows: [order] } = await client.query(
        `INSERT INTO supplier_execution_orders
          (purchase_order_id, provider, supplier_order_id)
         VALUES ($1,'cj','CJ-ORDER-1')
         RETURNING id`,
        [po]
      );

      const pending = {
        scope: 'FULFILLMENT',
        provider: 'cj',
        verdict: 'PENDING',
        expected: { quantity: 2 },
        observed: {
          supplier_order_id: 'CJ-ORDER-1',
          supplier_unit_ref: 'VID-1',
          quantity: 2,
          provider_status: 'UNSHIPPED',
          pending: true,
        },
        evidence: { proof_source: 'cj_order_detail', proof_ref: 'CJ-ORDER-1' },
        external_ref: 'CJ-ORDER-1',
        reason: 'FULFILLMENT_PROVIDER_PENDING',
      };

      const first = await persistSupplierFulfillment(client, {
        supplierExecutionOrderId: order.id,
        supplierUnitRef: 'VID-1',
        reconciliationResult: pending,
      });

      expect(first).toMatchObject({
        provider: 'cj',
        expected_quantity: 2,
        observed_quantity: 2,
        provider_status: 'UNSHIPPED',
        reconciliation_status: 'pending',
      });

      const matched = {
        ...pending,
        verdict: 'MATCHED',
        observed: {
          ...pending.observed,
          provider_status: 'SHIPPED',
          tracking_number: 'TRK-1',
          pending: false,
        },
        reason: null,
      };

      const replay = await persistSupplierFulfillment(client, {
        supplierExecutionOrderId: order.id,
        supplierUnitRef: 'VID-1',
        reconciliationResult: matched,
      });

      expect(replay.id).toBe(first.id);
      expect(replay).toMatchObject({
        reconciliation_status: 'matched',
        provider_status: 'SHIPPED',
        tracking_number: 'TRK-1',
      });

      const { rows: facts } = await client.query('SELECT * FROM supplier_execution_fulfillments');
      expect(facts).toHaveLength(1);

      const { rows: events } = await client.query(
        `SELECT operation, outcome
           FROM supplier_execution_events
          WHERE supplier_execution_order_id = $1
          ORDER BY created_at`,
        [order.id]
      );
      expect(events).toEqual([
        { operation: 'reconcile_fulfillment', outcome: 'observed' },
        { operation: 'reconcile_fulfillment', outcome: 'observed' },
      ]);
    } finally {
      client.release();
    }
  });

  test('refuses to rebind one native evidence reference to another supplier execution order', async () => {
    const client = await pool.connect();
    try {
      await client.query(`SET search_path TO ${schema}, public`);
      const poA = '00000000-0000-4000-8000-000000000011';
      const poB = '00000000-0000-4000-8000-000000000012';
      await client.query('INSERT INTO purchase_orders(id) VALUES ($1),($2)', [poA, poB]);

      const { rows: orders } = await client.query(
        `INSERT INTO supplier_execution_orders
          (purchase_order_id, provider, supplier_order_id)
         VALUES
          ($1,'cj','CJ-ORDER-A'),
          ($2,'cj','CJ-ORDER-B')
         RETURNING id, supplier_order_id
         ORDER BY supplier_order_id`,
        [poA, poB]
      );

      const result = (externalRef) => ({
        scope: 'FULFILLMENT',
        provider: 'cj',
        verdict: 'MATCHED',
        expected: { quantity: 1 },
        observed: {
          supplier_order_id: externalRef,
          supplier_unit_ref: 'VID-1',
          quantity: 1,
          provider_status: 'SHIPPED',
          pending: false,
        },
        evidence: { proof_source: 'provider_fact', proof_ref: 'NATIVE-EVIDENCE-1' },
        external_ref: externalRef,
        reason: null,
      });

      await persistSupplierFulfillment(client, {
        supplierExecutionOrderId: orders[0].id,
        supplierUnitRef: 'VID-1',
        reconciliationResult: result('CJ-ORDER-A'),
      });

      await expect(persistSupplierFulfillment(client, {
        supplierExecutionOrderId: orders[1].id,
        supplierUnitRef: 'VID-1',
        reconciliationResult: result('CJ-ORDER-B'),
      })).rejects.toThrow('SUPPLIER_FULFILLMENT_REBIND_REFUSED');
    } finally {
      client.release();
    }
  });
});
