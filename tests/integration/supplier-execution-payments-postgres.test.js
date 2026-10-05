'use strict';

/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 * @integration supplier-execution-payments-postgres.test.js
 * @brief Migration 280 — fait canonique de paiement fournisseur, cible exacte et idempotence locale.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');

jest.setTimeout(30000);

const hasDb = Boolean(process.env.DATABASE_URL);
const describeDb = hasDb ? describe : describe.skip;
const id = () => crypto.randomUUID();

describeDb('supplier execution payments — migration 280 (REAL_DB)', () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const schemas = [];
  let current;

  function sql(name) {
    return fs.readFileSync(path.join(__dirname, '../../migrations', name), 'utf8')
      .replace(/public\./g, `${current}.`);
  }

  beforeEach(async () => {
    current = `sep280_${process.pid}_${Date.now()}_${schemas.length}`
      .replace(/[^a-zA-Z0-9_]/g, '_');
    schemas.push(current);

    await pool.query(`CREATE SCHEMA ${current}`);
    await pool.query(`
      CREATE TABLE ${current}.purchase_orders (id uuid PRIMARY KEY);
      CREATE TABLE ${current}.purchase_lines (id uuid PRIMARY KEY);
    `);
    await pool.query(sql('279_supplier_execution_persistence.sql'));
    await pool.query(sql('280_supplier_execution_payments.sql'));
  });

  afterAll(async () => {
    for (const schema of schemas) {
      await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    }
    await pool.end();
  });

  async function seedParent(provider = 'cj') {
    const po = id();
    await pool.query(`INSERT INTO ${current}.purchase_orders(id) VALUES ($1)`, [po]);
    const { rows: [group] } = await pool.query(`
      INSERT INTO ${current}.supplier_execution_groups
        (purchase_order_id, provider, supplier_parent_order_id, payment_ref)
      VALUES ($1,$2,$3,$4)
      RETURNING id
    `, [po, provider, 'PARENT-'+po, 'PAY-'+po]);
    return { po, group: group.id, provider };
  }

  test('persiste un paiement prepare sur un parent provider', async () => {
    const { po, group } = await seedParent();

    const { rows: [row] } = await pool.query(`
      INSERT INTO ${current}.supplier_execution_payments
        (purchase_order_id, provider, payment_execution_key, supplier_execution_group_id,
         expected_amount, currency)
      VALUES ($1,'cj','PAYEXEC-1',$2,62.07,'USD')
      RETURNING status, reconciliation_status, real_debit_verified
    `, [po, group]);

    expect(row).toEqual({
      status: 'prepared',
      reconciliation_status: 'pending',
      real_debit_verified: false,
    });
  });

  test('refuse deux paiements avec la meme cle idempotente provider', async () => {
    const { po, group } = await seedParent();

    await pool.query(`
      INSERT INTO ${current}.supplier_execution_payments
        (purchase_order_id, provider, payment_execution_key, supplier_execution_group_id,
         expected_amount, currency)
      VALUES ($1,'cj','PAYEXEC-1',$2,62.07,'USD')
    `, [po, group]);

    await expect(pool.query(`
      INSERT INTO ${current}.supplier_execution_payments
        (purchase_order_id, provider, payment_execution_key, supplier_execution_group_id,
         expected_amount, currency)
      VALUES ($1,'cj','PAYEXEC-1',$2,62.07,'USD')
    `, [po, group])).rejects.toMatchObject({ code: '23505' });
  });

  test('refuse un paiement dont la cible appartient a une autre PO', async () => {
    const a = await seedParent();
    const b = await seedParent();

    await expect(pool.query(`
      INSERT INTO ${current}.supplier_execution_payments
        (purchase_order_id, provider, payment_execution_key, supplier_execution_group_id,
         expected_amount, currency)
      VALUES ($1,'cj','PAYEXEC-X',$2,62.07,'USD')
    `, [a.po, b.group])).rejects.toMatchObject({ code: '23514' });
  });

  test('refuse un debit reel verifie si le paiement n est pas succeeded', async () => {
    const { po, group } = await seedParent();

    await expect(pool.query(`
      INSERT INTO ${current}.supplier_execution_payments
        (purchase_order_id, provider, payment_execution_key, supplier_execution_group_id,
         expected_amount, observed_amount, currency, status, reconciliation_status, real_debit_verified)
      VALUES ($1,'cj','PAYEXEC-R',$2,62.07,62.07,'USD','ambiguous','matched',true)
    `, [po, group])).rejects.toMatchObject({ code: '23514' });
  });

  test('autorise un sandbox rapproche sans pretendre a un debit reel', async () => {
    const { po, group } = await seedParent();

    const { rows: [row] } = await pool.query(`
      INSERT INTO ${current}.supplier_execution_payments
        (purchase_order_id, provider, payment_execution_key, supplier_execution_group_id,
         payment_ref, expected_amount, observed_amount, currency,
         status, reconciliation_status, real_debit_verified)
      VALUES ($1,'cj','PAYEXEC-SBX',$2,'PAY-SBX',62.07,62.07,'USD',
              'succeeded','matched',false)
      RETURNING expected_amount::text, observed_amount::text, reconciliation_status, real_debit_verified
    `, [po, group]);

    expect(row).toEqual({
      expected_amount: '62.0700',
      observed_amount: '62.0700',
      reconciliation_status: 'matched',
      real_debit_verified: false,
    });
  });
});
