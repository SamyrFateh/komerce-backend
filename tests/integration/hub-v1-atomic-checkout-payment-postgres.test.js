'use strict';
/**
 * @test-kind integration
 * @test-runner jest
 * @test-requires postgres
 * @integration hub-v1-atomic-checkout-payment-postgres.test.js
 * @brief Même commande E2E-HUB-V1 : vrai checkout atomique puis paiement fictif canonique sur PG16 éphémère.
 */
const crypto=require('crypto');
const db=require('../../db');
const {assertTestDatabase,activateLocalPrice,seedApprovedEurUsdObservationForTest}=require('../helpers/e2eDbKit');
const {runOrderCheckout}=require('../../services/order-checkout-service');
const {confirmFixturePayment}=require('../../services/hub-v1-fixture-payment');
const q=(sql,args)=>db.query(sql,args);
const uuid=()=>crypto.randomUUID();
const describeDb=process.env.DATABASE_URL?describe:describe.skip;
jest.setTimeout(90000);

describeDb('Hub V1 — commande canonique puis paiement fictif même objet (PG16 jetable)',()=>{
  const run='T'+crypto.randomBytes(4).toString('hex').toUpperCase().slice(0,7);
  const reference='E2E-HUB-V1-'+run+'-KOM-101';
  const ids={buyer:uuid(),admin:uuid(),relay:uuid(),product:uuid()};
  const previousEnv=process.env.KOMERCE_ENV;
  const cleanup={track:()=>{},trackSql:()=>{}};
  const buyer={id:ids.buyer,full_name:'E2E Buyer '+run,phone:'+2694112233'};
  beforeAll(async()=>{
    assertTestDatabase();
    const host=new URL(process.env.DATABASE_URL).hostname;
    if(!['localhost','127.0.0.1','::1'].includes(host))
      throw Error('HUB_V1_CHECKOUT_TEST_LOCAL_POSTGRES_ONLY');
    process.env.KOMERCE_ENV='staging';
    const {rows:[market]}=await q("SELECT id,currency,lifecycle_status FROM markets WHERE code='KM' LIMIT 1");
    expect(market).toBeTruthy();
    expect(market.lifecycle_status).toBe('ACTIVE');
    await q("INSERT INTO users(id,full_name,email,phone,role) VALUES ($1,$2,$3,$4,'client')",
      [ids.buyer,buyer.full_name,'e2e-hub-v1-'+run.toLowerCase()+'@komerce.test',buyer.phone]);
    await q("INSERT INTO users(id,full_name,email,phone,role) VALUES ($1,$2,$3,$4,'admin')",
      [ids.admin,'E2E Admin '+run,run.toLowerCase()+'-admin@komerce.test','+2694000011']);
    await q("INSERT INTO relais(id,name,agent_name,phone,address,market_id,island,island_code,is_active) VALUES ($1,$2,'E2E agent','+2693000011','Moroni',$3,'Grande Comore','MORONI',TRUE)",
      [ids.relay,'E2E-HUB-V1-'+run+'-RELAIS',market.id]);
    await q("INSERT INTO products(id,name,product_ref,price_kmf,cost_kmf,stock,price_aed,weight_kg,volume_cm3,inventory_model,is_active) VALUES ($1,$2,$3,10000,3000,10,100,1,1000,'LEGACY_VARIANTS',TRUE)",
      [ids.product,'E2E product '+run,'E2E-HUB-V1-'+run+'-P1']);
    await activateLocalPrice(db,cleanup,{marketId:market.id,productId:ids.product,amount:10000,currency:'KMF'});
    await seedApprovedEurUsdObservationForTest(db);
  });
  afterAll(async()=>{
    if(previousEnv===undefined)delete process.env.KOMERCE_ENV;
    else process.env.KOMERCE_ENV=previousEnv;
    await db.pool.end().catch(()=>{});
  });
  test('vrai checkout → pending scope atomique → faux paiement → ordered, zéro caisse/PSP',async()=>{
    const checkout=await runOrderCheckout({
      user:buyer,
      body:{items:[{product_id:ids.product,quantity:1}],relais_id:ids.relay,
        payment_mode:'cash_relais',use_wallet:false},
      internalSimulation:{scope:'E2E-HUB-V1',reference,actorId:ids.admin,
        expectedProductTotalKmf:10000,reason:'Fixture Hub V1 PG16 test isolé'}
    });
    expect(checkout).toMatchObject({ok:true});
    const {rows:[created]}=await q(
      'SELECT id,reference,status::text AS status,payment_status::text AS payment_status,simulation_scope,coalesce(total_kmf,0)::numeric AS total FROM orders WHERE reference=$1',[reference]);
    expect(created).toMatchObject({reference,status:'pending',payment_status:'pending',simulation_scope:'E2E-HUB-V1'});
    expect(Number(created.total)).toBeGreaterThanOrEqual(10000);
    const applied=await confirmFixturePayment({reference,actorId:ids.admin,env:{
      KOMERCE_ENV:'staging',NODE_ENV:'test',HUB_V1_E2E_APPLY_MODE:'approved'}});
    expect(applied).toMatchObject({ok:true,idempotent_replay:false,proof:'SIMULATION_ONLY_NO_DEBIT'});
    const {rows:[after]}=await q('SELECT status::text AS status,payment_status::text AS payment_status,cash_paid_at,stripe_payment_id FROM orders WHERE id=$1',[created.id]);
    expect(after).toMatchObject({status:'ordered',payment_status:'paid',cash_paid_at:null,stripe_payment_id:null});
    expect((await q('SELECT count(*)::int AS n FROM cash_collections WHERE order_id=$1',[created.id])).rows[0].n).toBe(0);
    const retryCheckout=await runOrderCheckout({
      user:buyer,body:{items:[{product_id:ids.product,quantity:1}],relais_id:ids.relay,payment_mode:'cash_relais'},
      internalSimulation:{scope:'E2E-HUB-V1',reference,actorId:ids.admin,expectedProductTotalKmf:10000,reason:'fixture duplicate test'}
    });
    expect(retryCheckout).toMatchObject({ok:false,status:409,body:{code:'HUB_V1_ORDER_ALREADY_EXISTS'}});
    expect((await q('SELECT COUNT(*)::int AS n FROM orders WHERE reference=$1',[reference])).rows[0].n).toBe(1);
  });
});
