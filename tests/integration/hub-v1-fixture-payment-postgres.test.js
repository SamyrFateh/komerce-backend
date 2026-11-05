'use strict';
/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 * @integration hub-v1-fixture-payment-postgres.test.js
 * @brief E2E-HUB-V1 : paiement fictif atomique via writer canonique, zéro caisse/PSP.
 */
const crypto=require('crypto');
const db=require('../../db');
const {confirmFixturePayment}=require('../../services/hub-v1-fixture-payment');
jest.setTimeout(60000);
const q=(sql,args)=>db.query(sql,args);
const uid=()=>crypto.randomUUID();
const describeDb=process.env.DATABASE_URL?describe:describe.skip;
describeDb('Hub V1 — faux paiement sur PG16 réel isolé',()=>{
  const run='P'+crypto.randomBytes(4).toString('hex').toUpperCase().slice(0,7);
  const ref='E2E-HUB-V1-'+run+'-KOM-101';
  const id={admin:uid(),buyer:uid(),relais:uid(),product:uid(),sku:uid(),order:uid(),item:uid()};
  const env={KOMERCE_ENV:'staging',NODE_ENV:'test',HUB_V1_E2E_APPLY_MODE:'approved'};
  beforeAll(async()=>{
    const {rows:[market]}=await q("SELECT id FROM markets WHERE code='KM'");
    await q("INSERT INTO users(id,full_name,email,phone,role) VALUES($1,'Hub V1 Test Admin',$2,$3,'admin')",
      [id.admin,run.toLowerCase()+'-admin@komerce.test','+2693'+String(Date.now()).slice(-7)]);
    await q("INSERT INTO users(id,full_name,email,phone,role) VALUES($1,'Hub V1 Test Buyer',$2,$3,'client')",
      [id.buyer,'e2e-hub-v1-'+run.toLowerCase()+'@komerce.test','+2694'+String(Date.now()).slice(-7)]);
    await q("INSERT INTO relais(id,name,agent_name,phone,address,market_id) VALUES($1,$2,'test','+2693000001','test',$3)",
      [id.relais,'E2E-HUB-V1-'+run+'-RELAIS',market.id]);
    await q("INSERT INTO products(id,name,price_kmf,cost_kmf,volume_cm3,stock,price_aed,inventory_model,product_ref) VALUES($1,$2,10000,3000,1000,0,100,'SKU',$3)",
      [id.product,'E2E Test Product '+run,'E2E-HUB-V1-'+run+'-A']);
    await q("INSERT INTO product_skus(id,product_id,sku,stock,is_active,source) VALUES($1,$2,$3,0,true,'SUPPLIER')",
      [id.sku,id.product,'E2E-HUB-V1-'+run+'-SKU']);
    await q("INSERT INTO orders(id,user_id,relais_id,market_id,reference,status,payment_status,payment_mode,total_kmf,total_eur,simulation_scope) VALUES($1,$2,$3,$4,$5,'pending','pending','cash_relais',10000,20,'E2E-HUB-V1')",
      [id.order,id.buyer,id.relais,market.id,ref]);
    await q("INSERT INTO order_items(id,order_id,product_id,quantity,price_kmf,sku_id,fulfillment_source) VALUES($1,$2,$3,1,10000,$4,'IMPORT')",
      [id.item,id.order,id.product,id.sku]);
  });
  afterAll(async()=>{await db.pool.end();});
  test('aucun encaissement externe; payé puis ordered sur son vrai état commande',async()=>{
    const before=await q('SELECT count(*)::int AS n FROM cash_collections WHERE order_id=$1',[id.order]);
    expect(before.rows[0].n).toBe(0);
    const first=await confirmFixturePayment({reference:ref,actorId:id.admin,env});
    expect(first).toMatchObject({ok:true,idempotent_replay:false,proof:'SIMULATION_ONLY_NO_DEBIT'});
    const {rows:[order]}=await q(
      'SELECT status::text AS status,payment_status::text AS payment_status,cash_paid_at,stripe_payment_id FROM orders WHERE id=$1',
      [id.order]);
    expect(order).toMatchObject({status:'ordered',payment_status:'paid',cash_paid_at:null,stripe_payment_id:null});
    expect((await q('SELECT count(*)::int AS n FROM cash_collections WHERE order_id=$1',[id.order])).rows[0].n).toBe(0);
    const {rows:hist}=await q('SELECT status::text AS status FROM order_status_history WHERE order_id=$1 ORDER BY created_at,id',[id.order]);
    expect(hist.map(x=>x.status)).toEqual(expect.arrayContaining(['confirmed','ordered']));
    const again=await confirmFixturePayment({reference:ref,actorId:id.admin,env});
    expect(again.idempotent_replay).toBe(true);
    const {rows:[cnt]}=await q('SELECT count(*)::int AS n FROM order_status_history WHERE order_id=$1',[id.order]);
    expect(cnt.n).toBe(hist.length);
  });
  test('refus du mode non autorisé même si le compte est fictif',async()=>{
    await expect(confirmFixturePayment({reference:ref,actorId:id.admin,env:{...env,HUB_V1_E2E_APPLY_MODE:'audit'}}))
      .rejects.toMatchObject({code:'HUB_V1_FIXTURE_PAYMENT_ENV_FORBIDDEN'});
  });
});
