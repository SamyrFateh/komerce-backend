'use strict';
/**
 * Non-regression issue #2958: actual Express/Joi route, canonical service
 * and disposable PostgreSQL. Only the login middleware is stubbed to supply
 * a scoped CI admin; all SQL runs inside an outer ROLLBACK transaction.
 *
 * Since the real route owns its BEGIN/COMMIT, the CI executor translates them
 * into SAVEPOINT/RELEASE so the entire fixture can ALWAYS roll back.
 */
const ci=process.env.GITHUB_ACTIONS==='true'
 &&process.env.NODE_ENV==='test'
 &&process.env.KOMERCE_DISABLE_CRONS==='true'
 &&process.env.DATABASE_URL==='postgresql://komerce:komerce@localhost:5432/komerce_test';
if(!ci){
 describe.skip('Parcel-item route real PostgreSQL acceptance — CI only',()=>{
   test('CI only',()=>{});
 });
}else{
 jest.setTimeout(30000);
 const {randomUUID}=require('node:crypto');
 const {Pool}=require('pg');
 const express=require('express');
 const request=require('supertest');
 const pool=new Pool({connectionString:process.env.DATABASE_URL});
 let mockClient, mockTxnSeq=0;
 jest.mock('../../db',()=>({
  query:(...a)=>mockClient.query(...a),
  connect:async()=>{
   const name='http_tx_'+(++mockTxnSeq);
   return {
    query:(sql,params)=>{
     const norm=String(sql).trim().toUpperCase();
     if(norm==='BEGIN')return mockClient.query('SAVEPOINT '+name);
     if(norm==='COMMIT')return mockClient.query('RELEASE SAVEPOINT '+name);
     if(norm==='ROLLBACK')return mockClient.query('ROLLBACK TO SAVEPOINT '+name);
     return mockClient.query(sql,params);
    },
    release:()=>{}
   };
  }
 }));
 jest.mock('../../middleware/auth',()=>({
  authenticate:(req,res,next)=>{req.user={id:null,role:'admin'};next();},
  requireRole:roles=>(req,res,next)=>roles.includes(req.user.role)?next():res.status(403).json({error:'forbidden'})
 }));
 const router=require('../../routes/parcels');
 const {addParcelItemTraced,findParcelMarketViolations}=require('../../services/parcel-item-mutation-service');
 const app=express();
 app.use(express.json());
 app.use('/api/parcels',router);
 app.use((err,req,res,next)=>res.status(err.status||500).json({code:err.code||null,error:err.message}));
 const id=()=>randomUUID();
 const ids={kmOrder:id(),kmOtherOrder:id(),cmOrder:id(),kmRelay:id(),cmRelay:id(),product:id(),kmItem:id(),sameMarketItem:id(),cmItem:id(),parcel:id()};
 let marketKM,marketCM;
 async function q(sql,args=[]){return mockClient.query(sql,args);}
 async function post(itemId,quantity=1){
  return request(app).post('/api/parcels/'+ids.parcel+'/items').send({order_item_id:itemId,quantity});
 }
 async function parcelState(){
  const {rows}=await q(
   'SELECT pi.order_item_id,oi.order_id,o.market_id,pi.quantity FROM parcel_items pi JOIN order_items oi ON oi.id=pi.order_item_id JOIN orders o ON o.id=oi.order_id WHERE pi.parcel_id=$1 ORDER BY oi.order_id',
   [ids.parcel]);
  return rows;
 }
 const evidence=(mode,details)=>console.log('PARCEL_ROUTE_FIX_PROOF '+JSON.stringify({mode,db:'POSTGRES_REAL',...details}));
 beforeAll(async()=>{
  mockClient=await pool.connect();await q('BEGIN');
  const {rows:[a]}=await q("SELECT id FROM markets WHERE code='KM'");
  if(!a)throw Error('KM seed missing in isolated PostgreSQL');
  marketKM=a.id;
  const {rows:[b]}=await q("SELECT id FROM markets WHERE code='CM'");
  if(b)marketCM=b.id;
  else{
   const {rows:[created]}=await q("INSERT INTO markets(code,name,currency,minor_unit,is_active) VALUES('CM','CI Cameroon','XAF',0,false) RETURNING id");
   marketCM=created.id;
  }
  for(const [relayId,label,marketId,island] of [
   [ids.kmRelay,'KM',marketKM,'Ngazidja'],[ids.cmRelay,'CM',marketCM,null]
  ]){
   await q(
    "INSERT INTO relais(id,name,agent_name,phone,address,island,market_id,is_active) VALUES($1,$2,'CI test hub', $3, 'CI isolated', $4, $5,false)",
    [relayId,'CI LOG '+label+' '+ids.parcel.slice(0,8),label==='KM'?'+2690001991':'+237600000991',island,marketId]);
  }
  await q("INSERT INTO products(id,name,price_kmf,stock) VALUES($1,'CI parcel market isolation',12000,10)",[ids.product]);
  const orders=[
   [ids.kmOrder,'KM',marketKM,ids.kmRelay],[ids.kmOtherOrder,'K2',marketKM,ids.kmRelay],[ids.cmOrder,'CM',marketCM,ids.cmRelay]
  ];
  for(const [orderId,code,marketId,relayId] of orders){
   await q(
    "INSERT INTO orders(id,reference,user_id,relais_id,market_id,total_kmf,payment_mode,payment_status,status) VALUES($1,$2,NULL,$4,$3,12000,'cash_relais','paid','confirmed')",
    [orderId,'CI-LOG-BLIND-'+code+'-'+ids.parcel.slice(0,8),marketId,relayId]);
  }
  for(const [itemId,orderId] of [[ids.kmItem,ids.kmOrder],[ids.sameMarketItem,ids.kmOtherOrder],[ids.cmItem,ids.cmOrder]]){
   await q('INSERT INTO order_items(id,order_id,product_id,quantity,price_kmf) VALUES($1,$2,$3,1,12000)',[itemId,orderId,ids.product]);
  }
  await q("INSERT INTO parcels(id,order_id,reference,status) VALUES($1,$2,$3,'draft')",
    [ids.parcel,ids.kmOrder,'CI-LOG-PARCEL-'+ids.parcel.slice(0,8)]);
  await q('SAVEPOINT clean_fixture');
 });
 afterAll(async()=>{
  if(mockClient){await q('ROLLBACK').catch(()=>{});mockClient.release();}
  await pool.end();
 });
 beforeEach(async()=>q('ROLLBACK TO SAVEPOINT clean_fixture'));
 test('NOMINAL: same-order add succeeds and commits item + event with product identity',async()=>{
  const response=await post(ids.kmItem);
  expect(response.status).toBe(201);
  expect(response.body.product_id).toBe(ids.product);
  const rows=await parcelState();
  expect(rows).toHaveLength(1);
  expect(rows[0].order_item_id).toBe(ids.kmItem);
  expect(rows[0].market_id).toBe(marketKM);
  const {rows:[evt]}=await q(
   "SELECT event_type FROM parcel_events WHERE parcel_id=$1 LIMIT 1",[ids.parcel]);
  expect(evt.event_type).toBe('item_assigned');
  evidence('NOMINAL',{http:response.status,productId:response.body.product_id,items:rows.length,event:evt.event_type});
 });
 test('NOMINAL: multi-order groupage within same market and relay is allowed',async()=>{
  const response=await post(ids.sameMarketItem);
  expect(response.status).toBe(201);
  expect(response.body.product_id).toBe(ids.product);
  const rows=await parcelState();
  expect(rows).toHaveLength(1);
  expect(rows[0].order_id).toBe(ids.kmOtherOrder);
  expect(rows[0].market_id).toBe(marketKM);
  evidence('SAME_MARKET_GROUPAGE',{http:response.status,market:rows[0].market_id,crossOrder:true});
 });
 test('DEVIATION: foreign-market item is rejected, zero persisted rows or events',async()=>{
  const response=await post(ids.cmItem);
  expect(response.status).toBe(409);
  expect(response.body.code).toBe('MARKET_MISMATCH');
  expect(await parcelState()).toHaveLength(0);
  const {rows:[evt]}=await q('SELECT count(*)::int AS n FROM parcel_events WHERE parcel_id=$1',[ids.parcel]);
  expect(evt.n).toBe(0);
  evidence('MARKET_MISMATCH',{http:response.status,code:response.body.code,items:0,events:evt.n});
 });
 test('DEVIATION: quantity cannot exceed line quantity',async()=>{
  const response=await post(ids.kmItem,2);
  expect(response.status).toBe(400);
  expect(response.body.code).toBe('QUANTITY_EXCEEDS_ORDER_LINE');
  expect(await parcelState()).toHaveLength(0);
  evidence('QUANTITY_GUARD',{http:response.status,code:response.body.code,items:0});
 });
 test('DEVIATION: shipped parcel has frozen item assignments',async()=>{
  // Shipping DB guard requires a real destination, even for a test parcel.
  await q("UPDATE parcels SET relais_id=$2, status='shipped' WHERE id=$1",[ids.parcel,ids.kmRelay]);
  const response=await post(ids.kmItem);
  expect(response.status).toBe(409);
  expect(response.body.code).toBe('PARCEL_NOT_MUTABLE');
  expect(await parcelState()).toHaveLength(0);
  evidence('FROZEN_PARCEL',{http:response.status,code:response.body.code,items:0});
 });
 test('DEVIATION: same item repeated returns 409 without extra parcel-event',async()=>{
  expect((await post(ids.kmItem)).status).toBe(201);
  const response=await post(ids.kmItem);
  expect(response.status).toBe(409);
  expect(response.body.code).toBe('PARCEL_ITEM_ALREADY_ASSIGNED');
  expect(await parcelState()).toHaveLength(1);
  const {rows:[evt]}=await q(
   "SELECT count(*)::int AS n FROM parcel_events WHERE parcel_id=$1 AND event_type='item_assigned'",[ids.parcel]);
  expect(evt.n).toBe(1);
  evidence('DUPLICATE',{http:response.status,code:response.body.code,items:1,events:evt.n});
 });
 test('CONTROL: Joi rejects zero quantity before acquiring a DB connection',async()=>{
  const response=await post(ids.kmItem,0);
  expect(response.status).toBe(400);
  expect(await parcelState()).toHaveLength(0);
  evidence('INVALID_QUANTITY',{http:response.status,items:0});
 });
}
