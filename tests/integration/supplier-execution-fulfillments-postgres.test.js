'use strict';

/** @test-kind integration @test-runner jest @test-requires postgres */

const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');

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

  test('persists one idempotent provider-side fulfillment fact without claiming Hub receipt', async () => {
    const po = '00000000-0000-4000-8000-000000000001';
    await pool.query(`INSERT INTO ${schema}.purchase_orders(id) VALUES ($1)`, [po]);

    const { rows: [order] } = await pool.query(
      `INSERT INTO ${schema}.supplier_execution_orders
        (purchase_order_id, provider, supplier_order_id)
       VALUES ($1,'cj','CJ-ORDER-1')
       RETURNING id`,
      [po]
    );

    const { rows: [fact] } = await pool.query(
      `INSERT INTO ${schema}.supplier_execution_fulfillments
        (supplier_execution_order_id, provider, fulfillment_execution_key,
         expected_quantity, observed_quantity, provider_status,
         tracking_number, reconciliation_status, evidence_source, evidence_ref)
       VALUES ($1,'cj','fulfill:CJ-ORDER-1',2,2,'SHIPPED','TRK-1','matched','order_detail','E-1')
       RETURNING *`,
      [order.id]
    );

    expect(fact).toMatchObject({
      provider: 'cj',
      expected_quantity: 2,
      observed_quantity: 2,
      reconciliation_status: 'matched',
      tracking_number: 'TRK-1',
    });

    await expect(pool.query(
      `INSERT INTO ${schema}.supplier_execution_fulfillments
        (supplier_execution_order_id, provider, fulfillment_execution_key, expected_quantity)
       VALUES ($1,'cj','fulfill:CJ-ORDER-1',2)`,
      [order.id]
    )).rejects.toMatchObject({ code: '23505' });
  });
});
