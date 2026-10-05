'use strict';

/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 */

const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const {Pool}=require('pg');

jest.setTimeout(30000);
const hasDb=Boolean(process.env.DATABASE_URL);
const describeDb=hasDb?describe:describe.skip;
const id=()=>crypto.randomUUID();

describeDb('supplier payment proofs — migration 281 (REAL_DB)',()=>{
  const pool=new Pool({connectionString:process.env.DATABASE_URL});
  const schemas=[];
  let current;
  function sql(name){
    return fs.readFileSync(path.join(__dirname,'../../migrations',name),'utf8')
      .replace(/public\./g,`${current}.`);
  }
  beforeEach(async()=>{
    current=`spp281_${process.pid}_${Date.now()}_${schemas.length}`.replace(/[^a-zA-Z0-9_]/g,'_');
    schemas.push(current);
    await pool.query(`CREATE SCHEMA ${current}`);
    await pool.query(`
      CREATE TABLE ${current}.purchase_orders (id uuid PRIMARY KEY);
      CREATE TABLE ${current}.purchase_lines (id uuid PRIMARY KEY);
    `);
    await pool.query(sql('279_supplier_execution_persistence.sql'));
    await pool.query(sql('280_supplier_execution_payments.sql'));
    await pool.query(sql('281_supplier_payment_proofs.sql'));
  });
  afterAll(async()=>{
    for(const s of schemas) await pool.query(`DROP SCHEMA IF EXISTS ${s} CASCADE`);
    await pool.end();
  });

  test('proof_ref natif est unique par provider/source',async()=>{
    const po=id(), group=id(), pay=id();
    await pool.query(`INSERT INTO ${current}.purchase_orders(id) VALUES($1)`,[po]);
    await pool.query(`
      INSERT INTO ${current}.supplier_execution_groups
        (id,purchase_order_id,provider,supplier_parent_order_id)
      VALUES($1,$2,'cj','PARENT-1')
    `,[group,po]);
    await pool.query(`
      INSERT INTO ${current}.supplier_execution_payments
        (id,purchase_order_id,provider,payment_execution_key,supplier_execution_group_id,expected_amount,currency,status,reconciliation_status)
      VALUES($1,$2,'cj','PEK-1',$3,62.07,'USD','succeeded','matched')
    `,[pay,po,group]);

    await pool.query(`
      INSERT INTO ${current}.supplier_execution_payment_proofs
        (supplier_payment_id,provider,proof_source,proof_ref,observed_amount,currency,debit_confirmed)
      VALUES($1,'cj','cj_wallet_billing_history','BILL-1',62.07,'USD',true)
    `,[pay]);

    await expect(pool.query(`
      INSERT INTO ${current}.supplier_execution_payment_proofs
        (supplier_payment_id,provider,proof_source,proof_ref,observed_amount,currency,debit_confirmed)
      VALUES($1,'cj','cj_wallet_billing_history','BILL-1',62.07,'USD',true)
    `,[pay])).rejects.toMatchObject({code:'23505'});
  });
});
