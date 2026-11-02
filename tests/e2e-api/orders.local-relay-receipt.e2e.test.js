'use strict';
/**
 * @test-kind e2e-api
 * @test-runner jest
 * @test-requires postgres
 * @feature orders
 * @brief Local relay physical receipt -> available -> one-shot pickup,
 *        with paid, cross-relay and mixed-order guards on real PostgreSQL.
 */
const request=require('supertest');
const express=require('express');
const {signAuthToken}=require('../../utils/auth-session');
const {generateAndStoreSecret}=require('../../services/pickup-secret-service');
const {describeE2E,createCleanup,assertTestDatabase,tag,uuid}=require('../helpers/e2eDbKit');
jest.setTimeout(90000);

describeE2E('Orders - local relay receipt without hub',({db})=>{
  const user=uuid(),agent=uuid(),foreignAgent=uuid(),relay=uuid(),foreignRelay=uuid();
  const product=uuid(),importProduct=uuid(),stock=uuid();
  const orders={local:uuid(),mixed:uuid(),unpaid:uuid()};
  const items={local:uuid(),mixedLocal:uuid(),mixedImport:uuid(),unpaid:uuid()};
  let app,token,foreignToken,cleanup,cleanupClient,market;
  const refs={local: 'E2E-LR-'+tag('local'),mixed:'E2E-LR-'+tag('mixed'),unpaid:'E2E-LR-'+tag('unpaid')};
  const q=(sql,params=[])=>db.query(sql,params);
  const send=(which,auth=token)=>request(app)
    .post('/api/orders/'+orders[which]+'/local-relay-receipt')
    .set('Authorization','Bearer '+auth)
    .send({physical_received:true,note:'Unités présentes et contrôlées au relais'});

  beforeAll(async()=>{
    // Teardown executes under one scoped transaction on the disposable PG test DB.
    // Do not bypass immutable physical facts in application routes.
    cleanup=createCleanup({ query:(sql,args)=> {
      if(!cleanupClient)throw new Error('Local test cleanup client unavailable');
      return cleanupClient.query(sql,args);
    } });
    market=(await q("SELECT id FROM markets WHERE code='KM' LIMIT 1")).rows[0];
    if(!market)throw new Error('Marché KM requis pour la recette');
    const ids=Object.values(orders);
    // E2E database only: teardown all children first; no production writes.
    // createCleanup is LIFO; register parents first and children last.
    cleanup.trackSql('DELETE FROM relais WHERE id=ANY($1::uuid[])',[[relay,foreignRelay]]);
    cleanup.trackSql('DELETE FROM users WHERE id=ANY($1::uuid[])',[[user,agent,foreignAgent]]);
    cleanup.trackSql('DELETE FROM products WHERE id=ANY($1::uuid[])',[[product,importProduct]]);
    cleanup.trackSql('DELETE FROM local_stock WHERE id=$1',[stock]);
    const childCleanup=[
      'DELETE FROM scans WHERE order_id=ANY($1::uuid[])',
      'DELETE FROM parcel_events WHERE parcel_id IN (SELECT id FROM parcels WHERE order_id=ANY($1::uuid[]))',
      'DELETE FROM parcel_items WHERE parcel_id IN (SELECT id FROM parcels WHERE order_id=ANY($1::uuid[]))',
      'DELETE FROM parcels WHERE order_id=ANY($1::uuid[])',
      'DELETE FROM order_status_history WHERE order_id=ANY($1::uuid[])',
      'DELETE FROM pickup_reveal_codes WHERE order_id=ANY($1::uuid[])',
      'DELETE FROM pickup_print_tokens WHERE order_id=ANY($1::uuid[])',
      "DELETE FROM client_notifications WHERE entity_type='order' AND entity_id=ANY($1::uuid[])",
      'DELETE FROM local_stock_allocations WHERE order_id=ANY($1::uuid[])',
      'DELETE FROM order_items WHERE order_id=ANY($1::uuid[])',
      'DELETE FROM orders WHERE id=ANY($1::uuid[])',
    ];
    for(const sql of childCleanup.reverse())cleanup.trackSql(sql,[ids]);

    await q("INSERT INTO relais (id,name,agent_name,phone,address,market_id) VALUES ($1,$2,'Agent','+269000221','Test',$3),($4,$5,'Agent','+269000222','Test',$3)",
      [relay,tag('relay'),market.id,foreignRelay,tag('other'),]);
    await q("INSERT INTO users (id,full_name,email,phone,role) VALUES ($1,'Client',$2,$3,'client')",
      [user,tag('buyer')+'@komerce.test','+2693'+String(Date.now()).slice(-7)]);
    await q("INSERT INTO users (id,full_name,email,phone,role,relais_id) VALUES ($1,'Relay Agent',$2,$3,'agent_relais',$4),($5,'Foreign Agent',$6,$7,'agent_relais',$8)",
      [agent,tag('agent')+'@komerce.test','+2694'+String(Date.now()).slice(-7),relay,
       foreignAgent,tag('foreign')+'@komerce.test','+2695'+String(Date.now()).slice(-7),foreignRelay]);
    await q("INSERT INTO products (id,name,price_kmf,stock) VALUES ($1,$2,10000,0),($3,$4,10000,0)",
      [product,tag('local-product'),importProduct,tag('import-product')]);
    await q("INSERT INTO local_stock (id,product_id,market_id,location,qty_physical,commercial_exposure) VALUES ($1,$2,$3,'KM_MAIN',0,'ENABLED')",
      [stock,product,market.id]);
    for(const which of Object.keys(orders)) {
      await q("INSERT INTO orders (id,user_id,relais_id,market_id,reference,status,payment_status,payment_mode,total_kmf,total_eur) VALUES ($1,$2,$3,$4,$5,'confirmed',$6,'cash_relais',20000,40)",
        [orders[which],user,relay,market.id,refs[which],which==='unpaid'?'pending':'paid']);
    }
    const lines=[
      [items.local,orders.local,product,2,'LOCAL_STOCK'],
      [items.mixedLocal,orders.mixed,product,1,'LOCAL_STOCK'],
      [items.mixedImport,orders.mixed,importProduct,1,'IMPORT'],
      [items.unpaid,orders.unpaid,product,1,'LOCAL_STOCK'],
    ];
    for(const row of lines)await q(
      'INSERT INTO order_items (id,order_id,product_id,quantity,price_kmf,fulfillment_source) VALUES ($1,$2,$3,$4,10000,$5)',row);
    for(const which of ['local','mixed']) await q(
      'INSERT INTO local_stock_allocations (local_stock_id,order_id,quantity,consumed_at) VALUES ($1,$2,$3,NOW())',
      [stock,orders[which],which==='local'?2:1]);
    token=signAuthToken({id:agent,role:'agent_relais'},{method:'e2e'});
    foreignToken=signAuthToken({id:foreignAgent,role:'agent_relais'},{method:'e2e'});
    app=express();app.use(require('cookie-parser')());app.use(express.json());
    app.use('/api/orders',require('../../routes/orders/status'));
    app.use('/api/pickup',require('../../routes/pickup-secret'));
    app.use((err,_req,res,_next)=>res.status(err.status||500).json({error:err.message}));
  });
  afterAll(async()=>{
    if(!cleanup)return;
    // Physical parcel/history deletion is intentionally forbidden in runtime.
    // This cleanup is permitted ONLY on an isolated loopback *test* database.
    const target=assertTestDatabase();
    if(!['localhost','127.0.0.1','::1'].includes(target.host)) {
      throw new Error('Refus du teardown avec triggers désactivés hors PostgreSQL test local');
    }
    const client=await db.getClient();
    let inTx=false;
    try {
      await client.query('BEGIN');inTx=true;
      // SET LOCAL never outlives this transaction and cannot weaken runtime guards.
      await client.query('SET LOCAL session_replication_role = replica');
      cleanupClient=client;
      await cleanup.run();
      await client.query('COMMIT');inTx=false;
    }catch(error){
      if(inTx)await client.query('ROLLBACK').catch(()=>{});
      throw error;
    }finally{
      cleanupClient=null;
      client.release();
    }
  });

  test('paid local -> receipt proof -> available -> secure parcel pickup once',async()=>{
    const secret=await generateAndStoreSecret({orderId:orders.local,relaisId:relay,channel:'cash_relais'});
    const response=await send('local');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({success:true,status:'available'});
    const {rows:[state]}=await q('SELECT status FROM orders WHERE id=$1',[orders.local]);
    expect(state.status).toBe('available');
    const {rows:[parcel]}=await q('SELECT status,shipment_id,shipped_at,in_transit_at,relais_id FROM parcels WHERE id=$1',
      [response.body.parcel_id]);
    expect(parcel).toMatchObject({status:'available',shipment_id:null,shipped_at:null,in_transit_at:null,relais_id:relay});
    const {rows:qty}=await q('SELECT qty_received,qty_shipped FROM parcel_items WHERE parcel_id=$1',[response.body.parcel_id]);
    expect(qty).toMatchObject([{qty_received:2,qty_shipped:0}]);
    const {rows:[count]}=await q("SELECT count(*)::int AS n FROM order_status_history WHERE order_id=$1 AND status='available'",[orders.local]);
    expect(count.n).toBe(1);
    const {rows:[physical]}=await q('SELECT count(*)::int AS n FROM scans WHERE order_id=$1 AND step=\'relais_received\'',[orders.local]);
    expect(physical.n).toBe(1);
    const {rows:[po]}=await q('SELECT count(*)::int AS n FROM purchase_orders WHERE order_id=$1',[orders.local]);
    expect(po.n).toBe(0);
    const again=await send('local');
    expect(again.status).toBe(409);
    const collected=await request(app).post('/api/pickup/collect/'+orders.local)
      .set('Authorization','Bearer '+token)
      .send({collected_by_name:'Client',pickup_code:secret.code});
    expect(collected.status).toBe(200);
    const {rows:[after]}=await q('SELECT status FROM orders WHERE id=$1',[orders.local]);
    expect(after.status).toBe('collected');
  });
  test('mixed: local pickup now, import remains outstanding, then second one-shot pickup',async()=>{
    const secret=await generateAndStoreSecret({orderId:orders.mixed,relaisId:relay,channel:'cash_relais'});
    const local=await send('mixed');
    expect(local.status).toBe(200);
    const {rows:localLines}=await q(
      'SELECT pi.order_item_id, pi.qty_received, pi.qty_shipped FROM parcel_items pi WHERE pi.parcel_id=$1',
      [local.body.parcel_id]);
    expect(localLines).toMatchObject([{order_item_id:items.mixedLocal,qty_received:1,qty_shipped:0}]);
    const first=await request(app).post('/api/pickup/collect/'+orders.mixed)
      .set('Authorization','Bearer '+token)
      .send({collected_by_name:'Client',pickup_code:secret.code});
    expect(first.status).toBe(200);
    const {rows:[partial]}=await q('SELECT status FROM orders WHERE id=$1',[orders.mixed]);
    expect(partial.status).toBe('available');
    const {rows:[localParcel]}=await q('SELECT status FROM parcels WHERE id=$1',[local.body.parcel_id]);
    expect(localParcel.status).toBe('collected');
    // The new one-shot secret is issued atomically after partial pickup.
    const {rows:[next]}=await q('SELECT code FROM pickup_reveal_codes WHERE order_id=$1',[orders.mixed]);
    expect(next?.code).toBeTruthy();
    expect(next.code).not.toBe(secret.code);
    // Simulate an imported parcel *after* its separate Hub/transit/customs
    // journey; this test validates pickup reconciliation, not Hub E2E.
    const importParcel=uuid();
    await q("INSERT INTO parcels (id,order_id,reference,type,status,relais_id,available_at) VALUES ($1,$2,$3,'standard','available',$4,NOW())",
      [importParcel,orders.mixed,'E2E-LR-'+tag('import-parcel'),relay]);
    await q("INSERT INTO parcel_items (parcel_id,order_item_id,product_id,quantity,qty_allocated,qty_packed,qty_shipped,qty_received,verified) VALUES ($1,$2,$3,1,1,1,1,1,TRUE)",
      [importParcel,items.mixedImport,importProduct]);
    const second=await request(app).post('/api/pickup/collect/'+orders.mixed)
      .set('Authorization','Bearer '+token)
      .send({collected_by_name:'Client',pickup_code:next.code});
    expect(second.status).toBe(200);
    const {rows:[complete]}=await q('SELECT status FROM orders WHERE id=$1',[orders.mixed]);
    expect(complete.status).toBe('collected');
    const {rows:[history]}=await q("SELECT COUNT(*)::int AS n FROM order_status_history WHERE order_id=$1 AND status='collected'",[orders.mixed]);
    expect(history.n).toBe(1);
  });
  test('foreign relay and unpaid orders cannot attest, including on mixed checkout',async()=>{
    expect((await send('unpaid')).status).toBe(409);
    expect((await send('mixed',foreignToken)).status).toBe(403);
  });
});
