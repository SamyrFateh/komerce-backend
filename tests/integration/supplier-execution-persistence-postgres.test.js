'use strict';

/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 * @integration supplier-execution-persistence-postgres.test.js
 * @brief Migration 279 — sous-ordres provider, parent provider, rattachements et journal reprenable.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');

jest.setTimeout(30000);

const hasDb = Boolean(process.env.DATABASE_URL);
const describeDb = hasDb ? describe : describe.skip;
const id = () => crypto.randomUUID();

describeDb('supplier execution persistence — migration 279 (REAL_DB)', () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const schemas = [];
  let current;

  function migrationSql() {
    return fs
      .readFileSync(
        path.join(__dirname, '../../migrations/279_supplier_execution_persistence.sql'),
        'utf8'
      )
      .replace(/public\./g, `${current}.`);
  }

  beforeEach(async () => {
    current = `se279_${process.pid}_${Date.now()}_${schemas.length}`
      .replace(/[^a-zA-Z0-9_]/g, '_');
    schemas.push(current);

    await pool.query(`CREATE SCHEMA ${current}`);
    await pool.query(`
      CREATE TABLE ${current}.purchase_orders (id uuid PRIMARY KEY);
      CREATE TABLE ${current}.purchase_lines (id uuid PRIMARY KEY);
    `);
    await pool.query(migrationSql());
  });

  afterAll(async () => {
    for (const schema of schemas) {
      await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    }
    await pool.end();
  });

  test('persiste deux sous-ordres, leur parent et leurs lignes', async () => {
    const po = id();
    const line1 = id();
    const line2 = id();
    await pool.query(
      `INSERT INTO ${current}.purchase_orders(id) VALUES ($1)`,
      [po]
    );
    await pool.query(
      `INSERT INTO ${current}.purchase_lines(id) VALUES ($1),($2)`,
      [line1, line2]
    );

    const { rows: [order1] } = await pool.query(`
      INSERT INTO ${current}.supplier_execution_orders
        (purchase_order_id, provider, supplier_order_id, supplier_order_code)
      VALUES ($1, 'cj', 'ORDER-1', 'SD-1')
      RETURNING id
    `, [po]);

    const { rows: [order2] } = await pool.query(`
      INSERT INTO ${current}.supplier_execution_orders
        (purchase_order_id, provider, supplier_order_id, supplier_order_code)
      VALUES ($1, 'cj', 'ORDER-2', 'SD-2')
      RETURNING id
    `, [po]);

    await pool.query(`
      INSERT INTO ${current}.supplier_execution_order_lines
        (supplier_execution_order_id, purchase_line_id, quantity)
      VALUES ($1,$2,1),($3,$4,1)
    `, [order1.id, line1, order2.id, line2]);

    const { rows: [group] } = await pool.query(`
      INSERT INTO ${current}.supplier_execution_groups
        (purchase_order_id, provider, supplier_parent_order_id, payment_ref)
      VALUES ($1, 'cj', 'PARENT-1', 'PAY-1')
      RETURNING id
    `, [po]);

    await pool.query(`
      INSERT INTO ${current}.supplier_execution_group_members
        (supplier_execution_group_id, supplier_execution_order_id)
      VALUES ($1,$2),($1,$3)
    `, [group.id, order1.id, order2.id]);

    const { rows: [counts] } = await pool.query(`
      SELECT
        (SELECT count(*)::int FROM ${current}.supplier_execution_orders) AS orders,
        (SELECT count(*)::int FROM ${current}.supplier_execution_order_lines) AS lines,
        (SELECT count(*)::int FROM ${current}.supplier_execution_groups) AS groups,
        (SELECT count(*)::int FROM ${current}.supplier_execution_group_members) AS members
    `);
    expect(counts).toEqual({ orders: 2, lines: 2, groups: 1, members: 2 });
  });

  test('refuse un même identifiant natif deux fois chez le même provider', async () => {
    const po = id();
    await pool.query(
      `INSERT INTO ${current}.purchase_orders(id) VALUES ($1)`,
      [po]
    );
    await pool.query(`
      INSERT INTO ${current}.supplier_execution_orders
        (purchase_order_id, provider, supplier_order_id)
      VALUES ($1, 'cj', 'ORDER-1')
    `, [po]);

    await expect(pool.query(`
      INSERT INTO ${current}.supplier_execution_orders
        (purchase_order_id, provider, supplier_order_id)
      VALUES ($1, 'cj', 'ORDER-1')
    `, [po])).rejects.toMatchObject({ code: '23505' });
  });

  test('refuse de rattacher au parent un sous-ordre d une autre PO', async () => {
    const po1 = id();
    const po2 = id();
    await pool.query(
      `INSERT INTO ${current}.purchase_orders(id) VALUES ($1),($2)`,
      [po1, po2]
    );
    const { rows: [order] } = await pool.query(`
      INSERT INTO ${current}.supplier_execution_orders
        (purchase_order_id, provider, supplier_order_id)
      VALUES ($1, 'cj', 'ORDER-X')
      RETURNING id
    `, [po2]);
    const { rows: [group] } = await pool.query(`
      INSERT INTO ${current}.supplier_execution_groups
        (purchase_order_id, provider, supplier_parent_order_id)
      VALUES ($1, 'cj', 'PARENT-X')
      RETURNING id
    `, [po1]);

    await expect(pool.query(`
      INSERT INTO ${current}.supplier_execution_group_members
        (supplier_execution_group_id, supplier_execution_order_id)
      VALUES ($1,$2)
    `, [group.id, order.id])).rejects.toMatchObject({ code: '23514' });
  });

  test('journalise une opération sans accepter un outcome inventé', async () => {
    const po = id();
    await pool.query(
      `INSERT INTO ${current}.purchase_orders(id) VALUES ($1)`,
      [po]
    );

    await pool.query(`
      INSERT INTO ${current}.supplier_execution_events
        (purchase_order_id, provider, operation, outcome, provider_request_id, facts)
      VALUES ($1, 'cj', 'create_order', 'succeeded', 'REQ-1', '{"status":"UNPAID"}'::jsonb)
    `, [po]);

    await expect(pool.query(`
      INSERT INTO ${current}.supplier_execution_events
        (purchase_order_id, provider, operation, outcome)
      VALUES ($1, 'cj', 'create_order', 'maybe')
    `, [po])).rejects.toMatchObject({ code: '23514' });
  });
});
