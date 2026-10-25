'use strict';
/**
 * R&D Logistics blind second-domain trial.
 *
 * Actual HTTP Express route (real Joi validation) + real canonical mutation
 * guard + PostgreSQL CI ROLLBACK. Test token authentication is replaced only
 * to supply a known admin actor; NO production session or live Railway access.
 * Diagnostic tests assert current behavior and are NOT remediation tests.
 */
const ci=process.env.GITHUB_ACTIONS==='true'
 &&process.env.NODE_ENV==='test'
 &&process.env.KOMERCE_DISABLE_CRONS==='true'
 &&process.env.DATABASE_URL==='postgresql://komerce:komerce@localhost:5432/komerce_test';
if(!ci){
 describe.skip('Logistics parcel-items real route vs market invariant — CI PostgreSQL only',()=>{
   test('CI only',()=>{});
 });
}else{
 jest.setTimeout(30000);
 const {randomUUID}=require('node:crypto');
 const {Pool}=require('pg');
 const express=require('express');
 const request=require('supertest');
 const pool=new Pool({connectionString:process.env.DATABASE_URL});
 let mockClient;
 jest.mock('../../db',()=>({query:(...a)=>mockClient.query(...a)}));
 jest.mock('../../middleware/auth',()=>({
  authenticate:(req,res,next)=>{req.user={id:'ci-admin',role:'admin'};next();},
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
  // A failed HTTP mutation may leave PostgreSQL transaction in aborted
  // state. Keep the experiment alive WITHOUT bypassing the constraints.
  await q('SAVEPOINT before_http');
  const response=await request(app).post('/api/parcels/'+ids.parcel+'/items').send({order_item_id:itemId,quantity});
  if(response.status>=400){
   console.log('BLIND_LOGISTICS_HTTP_ERROR '+JSON.stringify({status:response.status,body:response.body}));
   await q('ROLLBACK TO SAVEPOINT before_http');
  } else await q('RELEASE SAVEPOINT before_http');
  return response;
 }
 async function parcelState(){
  const {rows}=await q(
   'SELECT pi.order_item_id,oi.order_id,o.market_id,pi.quantity FROM parcel_items pi JOIN order_items oi ON oi.id=pi.order_item_id JOIN orders o ON o.id=oi.order_id WHERE pi.parcel_id=$1 ORDER BY oi.order_id',
   [ids.parcel]);
  return rows;
 }
 const output=(mode,expected,observed,invariantOK)=>console.log('BLIND_LOGISTICS_TRIAL '+JSON.stringify({
  hypothesis:'MULTI_ORDER_PARCEL_MUST_REMAIN_SINGLE_MARKET',mode,
  api:'POST /api/parcels/:id/items',service:'routes/parcels.js vs parcel-item-mutation-service.addParcelItemTraced',
  db:'POSTGRES_REAL',expected,observed,invariantOK
 }));
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
 test('NOMINAL: item from carrier order is accepted',async()=>{
  const response=await post(ids.kmItem);
  const rows=await parcelState();
  expect(response.status).toBe(201);
  expect(rows).toHaveLength(1);
  expect(rows[0].market_id).toBe(marketKM);
  output('NOMINAL_SAME_ORDER',{http:201,markets:[marketKM]},{http:response.status,markets:rows.map(x=>x.market_id)},true);
 });
 test('NEGATIVE CONTROL: distinct order but SAME market is legitimate parcel groupage',async()=>{
  const response=await post(ids.sameMarketItem);
  const rows=await parcelState();
  expect(response.status).toBe(201);
  expect(rows).toHaveLength(1);
  expect(rows[0].market_id).toBe(marketKM);
  output('NEGATIVE_SAME_MARKET_CROSS_ORDER',{http:201,markets:[marketKM]},{http:response.status,markets:rows.map(x=>x.market_id)},true);
 });
 test('DEVIATION: legacy HTTP route accepts item from a different market',async()=>{
  await post(ids.kmItem);
  const response=await post(ids.cmItem);
  const rows=await parcelState();
  const markets=[...new Set(rows.map(x=>x.market_id))].sort();
  expect(response.status).toBe(201);
  expect(markets).toEqual([marketKM,marketCM].sort());
  const violations=await findParcelMarketViolations(mockClient);
  expect(violations.some(x=>x.parcel_id===ids.parcel)).toBe(true);
  output('DEVIATION_CROSS_MARKET',{http:409,uniqueMarkets:1,detectorViolations:0},
   {http:response.status,markets,detectorViolations:violations.filter(x=>x.parcel_id===ids.parcel).length},false);
 });
 test('CANONICAL CONTROL: same cross-market addition is rejected by owner guard',async()=>{
  await expect(addParcelItemTraced(mockClient,{
   parcelId:ids.parcel,orderItemId:ids.cmItem,quantity:1,actorId:null
  })).rejects.toMatchObject({code:'MARKET_MISMATCH',status:409});
  const rows=await parcelState();
  expect(rows).toHaveLength(0);
  output('CANONICAL_GUARD',{code:'MARKET_MISMATCH',rows:0},{code:'MARKET_MISMATCH',rows:rows.length},true);
 });
}
