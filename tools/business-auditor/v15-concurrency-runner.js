'use strict';
/**
 * V1.5 two live PostgreSQL connections, same pre-insert capacity snapshot.
 * Fixtures are committed on isolated LOCAL komerce_test for inter-session
 * visibility, then explicitly deleted and checked. No real system touched.
 */
const crypto=require('node:crypto'),{assertLocalTestTarget}=require('./cli');
const uuid=()=>crypto.randomUUID();
function barrier(parties=2,timeoutMs=15000){
 let arrived=0,resolve,reject;
 const done=new Promise((a,b)=>{resolve=a;reject=b});
 const timer=setTimeout(()=>reject(Error('TOOL_ERROR: concurrency barrier timeout')),timeoutMs);
 timer.unref?.();
 return {wait:async()=>{arrived++;if(arrived===parties){clearTimeout(timer);resolve()}await done},
  get arrived(){return arrived}};
}
async function setup(c){
 const x={relay:uuid(),product:uuid(),A:uuid(),B:uuid(),carrier:uuid(),firstParcel:uuid(),items:[]};
 await c.query('BEGIN');
 try{
  const {rows:[market]}=await c.query("SELECT id FROM markets WHERE code='KM' LIMIT 1");
  if(!market)throw Error('TOOL_ERROR: missing market KM');
  await c.query("INSERT INTO relais(id,name,agent_name,phone,address,market_id) VALUES($1,'KBA V15','KBA','+269000001','LOCAL',$2)",[x.relay,market.id]);
  await c.query("INSERT INTO products(id,name,price_kmf,stock) VALUES($1,'KBA V15',5000,100)",[x.product]);
  for(const [label,o,n] of [['A',x.A,1],['B',x.B,1],['CARRIER',x.carrier,29]])
   await c.query("INSERT INTO orders(id,reference,relais_id,market_id,total_kmf,payment_mode,status,payment_status) VALUES($1,$2,$3,$4,$5,'stripe_eur','ordered','paid')",
    [o,'KBA15-'+label+'-'+o.slice(0,12),x.relay,market.id,n*5000]);
  await c.query("INSERT INTO parcels(id,order_id,relais_id,reference,status,type) VALUES($1,$2,$3,$4,'preparation','standard')",
   [x.firstParcel,x.carrier,x.relay,'KBA15-P-'+x.firstParcel.slice(0,12)]);
  for(const [order,n] of [[x.A,1],[x.B,1],[x.carrier,29]]){
   for(let i=0;i<n;i++){
    const item=uuid();x.items.push(item);
    await c.query("INSERT INTO order_items(id,order_id,product_id,quantity,price_kmf,fulfillment_source) VALUES($1,$2,$3,1,5000,'IMPORT')",
     [item,order,x.product]);
    if(order===x.carrier)
     await c.query('INSERT INTO parcel_items(parcel_id,order_item_id,product_id,quantity) VALUES($1,$2,$3,1)',
      [x.firstParcel,item,x.product]);
   }
  }
  await c.query('COMMIT');
  return x;
 }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e}
}
async function observe(c,x){
 const {rows}=await c.query('SELECT p.id,p.status,COUNT(pi.id)::int AS members FROM parcels p LEFT JOIN parcel_items pi ON pi.parcel_id=p.id WHERE p.relais_id=$1 GROUP BY p.id,p.status ORDER BY p.id',[x.relay]);
 const {rows:members}=await c.query('SELECT oi.order_id,COUNT(pi.id)::int AS members FROM order_items oi LEFT JOIN parcel_items pi ON pi.order_item_id=oi.id WHERE oi.order_id=ANY($1::uuid[]) GROUP BY oi.order_id ORDER BY oi.order_id',[[x.A,x.B]]);
 return {parcels:rows.map(r=>({id:r.id,status:r.status,members:Number(r.members)})),
  assignedByOrder:members.map(r=>({order:r.order_id,members:Number(r.members)})),
  total:rows.reduce((n,r)=>n+Number(r.members),0)};
}
async function cleanup(c,x){
 await c.query('BEGIN');
 try{
  await c.query('DELETE FROM parcel_items WHERE order_item_id=ANY($1::uuid[])',[x.items]);
  await c.query('DELETE FROM parcels WHERE relais_id=$1',[x.relay]);
  await c.query('DELETE FROM order_items WHERE order_id=ANY($1::uuid[])',[[x.A,x.B,x.carrier]]);
  await c.query('DELETE FROM orders WHERE id=ANY($1::uuid[])',[[x.A,x.B,x.carrier]]);
  await c.query('DELETE FROM products WHERE id=$1',[x.product]);
  await c.query('DELETE FROM relais WHERE id=$1',[x.relay]);
  await c.query('COMMIT');
 }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e}
 const {rows:[check]}=await c.query('SELECT (SELECT COUNT(*)::int FROM orders WHERE id=ANY($1::uuid[])) AS orders,(SELECT COUNT(*)::int FROM order_items WHERE id=ANY($2::uuid[])) AS items,(SELECT COUNT(*)::int FROM parcels WHERE relais_id=$3) AS parcels,(SELECT COUNT(*)::int FROM parcel_items WHERE order_item_id=ANY($2::uuid[])) AS memberships',
  [[x.A,x.B,x.carrier],x.items,x.relay]);
 if(Object.values(check).some(v=>Number(v)!==0))throw Error('TOOL_ERROR: physical fixture not cleaned up');
 return {verified:true,remaining:check};
}
function guarded(c,sync){
 return {query:async(sql,args=[])=>{
  const r=await c.query(sql,args);
  if(String(sql).includes('LEFT JOIN LATERAL')&&String(sql).includes('COALESCE(agg.item_count'))
   await sync.wait();
  return r;
 }};
}
async function one(pool,mode,distributeOrder){
 // Connect all three sessions before using the pool. No same-client concurrency.
 const control=await pool.connect(),first=await pool.connect(),second=await pool.connect();
 let x,output,error,clean;
 try{
  x=await setup(control);
  const before=await observe(control,x);
  if(before.parcels.length!==1||before.parcels[0].members!==29)
   throw Error('TOOL_ERROR: seed has incorrect 29-member baseline');
  let outcomes,arrived=0;
  if(mode==='SEQUENTIAL_CONTROL'){
   const a=await distributeOrder(x.A,first),b=await distributeOrder(x.B,second);
   outcomes=[{status:'fulfilled',value:a},{status:'fulfilled',value:b}];
  }else if(mode==='FORCED_TWO_CONNECTION_RACE'){
   const sync=barrier();
   outcomes=await Promise.allSettled([
    distributeOrder(x.A,guarded(first,sync)),distributeOrder(x.B,guarded(second,sync))]);
   arrived=sync.arrived;
  }else throw Error('TOOL_ERROR: unknown race scenario');
  output={mode,before,after:await observe(control,x),arrived,
   outcomes:outcomes.map((o,i)=>({target:i?'B':'A',status:o.status,
    ...(o.status==='fulfilled'?{result:o.value}:{errorCode:o.reason?.code||'UNCLASSIFIED',
      errorText:String(o.reason?.message||'').slice(0,120)})})),
   carrierParcel:x.firstParcel,orderA:x.A,orderB:x.B};
 }catch(e){error=e}finally{
  try{if(x)clean=await cleanup(control,x)}catch(e){error=error||e}
  control.release();first.release();second.release();
 }
 if(error)throw error;
 return {...output,cleanup:clean};
}
async function run(env=process.env){
 assertLocalTestTarget(env);
 const {Pool}=require('pg'),pool=new Pool({connectionString:env.DATABASE_URL,max:3,connectionTimeoutMillis:7000});
 try{
  const {rows:[identity]}=await pool.query('SELECT current_database() AS name');
  if(identity.name!=='komerce_test')throw Error('TOOL_ERROR: wrong database');
  const {distributeOrder,MAX_ITEMS_PER_PARCEL}=require('../../services/auto-parcel');
  if(MAX_ITEMS_PER_PARCEL!==30)throw Error('TOOL_ERROR: canonical owner capacity limit changed; review fixture');
  const cases=[];
  for(const mode of ['SEQUENTIAL_CONTROL','FORCED_TWO_CONNECTION_RACE'])
   cases.push(await one(pool,mode,distributeOrder));
  return {contract:'komerce-canonical-pg-concurrency-raw/v15',
   scope:'ACTUAL_OWNER_CANONICAL_PG_TWO_INDEPENDENT_CONNECTIONS',
   limitFromActualOwner:MAX_ITEMS_PER_PARCEL,preseed:29,cases,
   allFixturesDeleted:cases.every(x=>x.cleanup?.verified===true),
   onlyLocalTestDb:true,routeHttpExecuted:false,productionIncidentConfirmed:false};
 }finally{await pool.end()}
}
module.exports={run,barrier,observe};
