'use strict';
/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 * @integration purchasing-order-detail-postgres.test.js
 * @brief Real execution projection: cardinalities, PO isolation, decimal precision, explicit safe columns and read-only SQL.
 */
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

jest.mock('../../db', () => ({ query: jest.fn() }));
jest.mock('../../services/purchasing-grouped-service', () => ({ getGroupedPurchaseOrder: jest.fn() }));
const { getGroupedPurchaseOrder } = require('../../services/purchasing-grouped-service');
const { getPurchaseOrderDetail } = require('../../services/purchasing-order-detail');

const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const describeDb = process.env.DATABASE_URL ? describe : describe.skip;

describeDb('purchasing order detail — real PostgreSQL', () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const schema = `podetail_${process.pid}_${Date.now()}`;
  let client;

  beforeAll(async () => {
    client = await pool.connect();
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}`);
    await client.query('CREATE TABLE purchase_orders (id uuid PRIMARY KEY); CREATE TABLE purchase_lines (id uuid PRIMARY KEY, purchase_order_id uuid REFERENCES purchase_orders(id));');
    for (const file of ['279_supplier_execution_persistence.sql', '280_supplier_execution_payments.sql', '281_supplier_payment_proofs.sql']) {
      await client.query(fs.readFileSync(path.join(__dirname, '../../migrations', file), 'utf8').replace(/public\./g, `${schema}.`));
    }
    await client.query('INSERT INTO purchase_orders(id) VALUES ($1),($2),($3)', [id(1), id(2), id(3)]);
    await client.query('INSERT INTO purchase_lines(id,purchase_order_id) VALUES ($1,$2),($3,$2),($4,$5)', [id(11), id(1), id(12), id(13), id(3)]);
    for (const [order, po, line] of [[21, 1, 11], [22, 1, 12], [23, 3, 13]]) {
      await client.query(`INSERT INTO supplier_execution_orders(id,purchase_order_id,provider,supplier_order_id,supplier_order_code,provider_facts)
        VALUES ($1,$2,'cj',$3,$4,'{"raw":"DO_NOT_EXPOSE"}')`, [id(order), id(po), `native-${order}`, `code-${order}`]);
      await client.query('INSERT INTO supplier_execution_order_lines(supplier_execution_order_id,purchase_line_id,quantity) VALUES ($1,$2,2)', [id(order), id(line)]);
    }
    // The reader excludes even a corrupt cross-PO line link (the schema has no guard for this link).
    await client.query('INSERT INTO supplier_execution_order_lines(supplier_execution_order_id,purchase_line_id,quantity) VALUES ($1,$2,1)', [id(21), id(13)]);
    await client.query(`INSERT INTO supplier_execution_groups(id,purchase_order_id,provider,supplier_parent_order_id,provider_facts)
      VALUES ($1,$2,'cj','parent-1','{"raw":"DO_NOT_EXPOSE"}')`, [id(31), id(1)]);
    await client.query('INSERT INTO supplier_execution_group_members(supplier_execution_group_id,supplier_execution_order_id) VALUES ($1,$2),($1,$3)', [id(31), id(21), id(22)]);
    await client.query(`INSERT INTO supplier_execution_payments(id,purchase_order_id,provider,payment_execution_key,supplier_execution_group_id,expected_amount,observed_amount,currency,status,reconciliation_status,real_debit_verified,provider_facts)
      VALUES ($1,$2,'cj','parent-pay',$3,99999999999999.1234,99999999999999.1234,'USD','succeeded','matched',true,'{"raw":"DO_NOT_EXPOSE"}')`, [id(41), id(1), id(31)]);
    for (const [payment, po, order, status, reconciliation] of [[42, 1, 21, 'ambiguous', 'unverified'], [43, 1, 22, 'succeeded', 'mismatched'], [44, 3, 23, 'requested', 'pending']]) {
      await client.query(`INSERT INTO supplier_execution_payments(id,purchase_order_id,provider,payment_execution_key,supplier_execution_order_id,expected_amount,currency,status,reconciliation_status)
        VALUES ($1,$2,'cj',$3,$4,12.3400,'PLN',$5,$6)`, [id(payment), id(po), `pay-${payment}`, id(order), status, reconciliation]);
    }
    for (const [proof, payment, sandbox] of [[51, 41, false], [52, 43, true], [53, 44, true]]) {
      await client.query(`INSERT INTO supplier_execution_payment_proofs(id,supplier_payment_id,provider,proof_source,proof_ref,observed_amount,currency,debit_confirmed,sandbox,simulated,provider_facts)
        VALUES ($1,$2,'cj','billing_history',$3,12.3400,'PLN',true,$4,$4,'{"raw":"DO_NOT_EXPOSE"}')`, [id(proof), id(payment), `proof-${proof}`, sandbox]);
    }
    // Match the parent proof's native amount/currency; the reader must not infer anything from other proofs.
    await client.query("UPDATE supplier_execution_payment_proofs SET observed_amount=99999999999999.1234,currency='USD' WHERE id=$1", [id(51)]);
    for (const [event, po] of [[61, 1], [62, 3]]) {
      await client.query(`INSERT INTO supplier_execution_events(id,purchase_order_id,provider,operation,outcome,provider_message,facts)
        VALUES ($1,$2,'cj','preflight','rejected','DO_NOT_EXPOSE','{"raw":"DO_NOT_EXPOSE"}')`, [id(event), id(po)]);
    }
  });

  beforeEach(() => {
    getGroupedPurchaseOrder.mockImplementation(async poId => ({ purchase_order: { id: poId }, lines: [], markets: [], multi_market: false }));
  });

  afterAll(async () => {
    if (client) {
      await client.query('ROLLBACK');
      await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      client.release();
    }
    await pool.end();
  });

  test('PO without execution has seven empty collections', async () => {
    const { supplier_execution } = await getPurchaseOrderDetail(id(2), client);
    expect(supplier_execution).toEqual({ orders: [], order_lines: [], groups: [], group_members: [], payments: [], proofs: [], events: [] });
  });

  test('keeps parent, children, lines, payments and proofs separate and within the PO', async () => {
    const e = (await getPurchaseOrderDetail(id(1), client)).supplier_execution;
    expect(e.orders.map(o => o.id).sort()).toEqual([id(21), id(22)]);
    expect(e.order_lines).toHaveLength(2);
    expect(e.order_lines.map(l => l.purchase_line_id).sort()).toEqual([id(11), id(12)]);
    expect(e.groups.map(g => g.id)).toEqual([id(31)]);
    expect(e.group_members).toHaveLength(2);
    expect(e.payments).toHaveLength(3);
    expect(e.proofs).toHaveLength(2);
    expect(e.events.map(e => e.id)).toEqual([id(61)]);
    expect(e.events[0]).toMatchObject({ operation: 'preflight', outcome: 'rejected', supplier_execution_order_id: null });
    expect(e.payments.filter(p => p.supplier_execution_group_id === id(31))).toHaveLength(1);
    expect(e.proofs.filter(p => p.supplier_payment_id === id(41))).toHaveLength(1);
  });

  test('preserves exact decimals, currencies and independent payment/reconciliation/proof facts', async () => {
    const e = (await getPurchaseOrderDetail(id(1), client)).supplier_execution;
    expect(e.payments.find(p => p.id === id(41))).toMatchObject({ expected_amount: '99999999999999.1234', observed_amount: '99999999999999.1234', currency: 'USD', real_debit_verified: true });
    expect(e.payments.find(p => p.id === id(42))).toMatchObject({ expected_amount: '12.3400', observed_amount: null, currency: 'PLN', status: 'ambiguous', reconciliation_status: 'unverified', real_debit_verified: false });
    expect(e.payments.find(p => p.id === id(43))).toMatchObject({ status: 'succeeded', reconciliation_status: 'mismatched', real_debit_verified: false });
    expect(e.proofs.find(p => p.id === id(51))).toMatchObject({ observed_amount: '99999999999999.1234', currency: 'USD', sandbox: false });
    expect(e.proofs.find(p => p.id === id(52))).toMatchObject({ sandbox: true, simulated: true });
    expect(e.proofs.some(p => p.supplier_payment_id === id(42))).toBe(false);
  });

  test('executes under READ ONLY and excludes opaque provider data', async () => {
    await client.query('BEGIN READ ONLY');
    try {
      const e = (await getPurchaseOrderDetail(id(1), client)).supplier_execution;
      expect(JSON.stringify(e)).not.toMatch(/DO_NOT_EXPOSE|provider_facts|provider_message|"facts"/);
    } finally {
      await client.query('ROLLBACK');
    }
  });
});
