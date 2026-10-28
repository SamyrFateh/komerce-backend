#!/usr/bin/env node
'use strict';
/* V3.2: canonical owner, two markets and one operator, one disposable PG clone
 * per scenario. No mock DB/service and no external network or HTTP auth claim.
 */
const crypto=require('node:crypto'),http=require('node:http'),https=require('node:https');
const env=process.env,mode=process.argv[2],url=new URL(env.DATABASE_URL||'');
if(!['CATALOG','AUTH'].includes(mode)||env.NODE_ENV!=='test'||
 env.KOMERCE_DISABLE_CRONS!=='true'||
 !['localhost','127.0.0.1','::1'].includes(url.hostname)||
 !/^\/kba_[a-f0-9]{18}$/.test(url.pathname))
 throw Error('V32_TOOL_ERROR: local disposable PG clone required');
for(const m of [http,https]){
 m.request=()=>{throw Error('V32_NETWORK_FORBIDDEN')};
 m.get=()=>{throw Error('V32_NETWORK_FORBIDDEN')};
}
global.fetch=()=>{throw Error('V32_NETWORK_FORBIDDEN')};
const {Pool}=require('pg');
const pool=new Pool({connectionString:env.DATABASE_URL,max:3,connectionTimeoutMillis:5000});
const catalog=require('../../services/market-delegation-catalog-service');
const exposure=require('../../services/catalog-market-exposure-service');
const team=require('../../services/market-delegation-team-service');
const uuid=()=>crypto.randomUUID();
async function setup(){
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  const {rows:m}=await client.query("SELECT id,code FROM markets WHERE code IN ('KM','CM') AND lifecycle_status='ACTIVE' ORDER BY code");
  if(m.length!==2)throw Error('V32_TOOL_ERROR: requires two ACTIVE canonical market rows KM and CM');
  const km=m.find(x=>x.code==='KM'),cm=m.find(x=>x.code==='CM');
  const user=uuid(),without=uuid(),product=uuid(),assignmentKm=uuid(),assignmentCm=uuid(),membership=uuid(),nonce=uuid().slice(0,12);
  await client.query("INSERT INTO users(id,full_name,email,role) VALUES($1,'KBA V32 authorised',$3,'client'),($2,'KBA V32 not capable',$4,'client')",
   [user,without,'v32-good-'+nonce+'@example.test','v32-bad-'+nonce+'@example.test']);
  await client.query("INSERT INTO products(id,name,price_kmf,stock,is_active) VALUES($1,'KBA V32 publication',10000,10,true)",[product]);
  await client.query("INSERT INTO market_operating_assignments(id,market_id,status) VALUES($1,$3,'ACTIVE'),($2,$4,'ACTIVE')",
   [assignmentKm,assignmentCm,km.id,cm.id]);
  await client.query("INSERT INTO assignment_memberships(id,assignment_id,user_id,status) VALUES($1,$2,$3,'ACTIVE')",
   [membership,assignmentKm,user]);
  const {rows:[cap]}=await client.query(
   "SELECT capability FROM capability_registry WHERE capability='catalog.expose' AND status='LIVE' LIMIT 1");
  if(!cap)throw Error('V32_TOOL_ERROR: catalog.expose missing from capability_registry');
  await client.query("INSERT INTO assignment_capability_ceiling(assignment_id,capability) VALUES($1,'catalog.expose')",[assignmentKm]);
  await client.query("INSERT INTO membership_capabilities(membership_id,capability) VALUES($1,'catalog.expose')",[membership]);
  await client.query('COMMIT');
  return {km,cm,user,without,product,assignmentKm,assignmentCm,membership};
 }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}finally{client.release()}
}
async function observe(ids){
 const {rows:records}=await pool.query(
  "SELECT market_id,commercial_exposure,decided_by FROM product_market_exposure WHERE product_id=$1 ORDER BY market_id",
  [ids.product]);
 const {rows:[p]}=await pool.query("SELECT id,is_active,price_kmf,name FROM products WHERE id=$1",[ids.product]);
 const {rows:audits}=await pool.query(
  "SELECT market_id,actor_user_id,capability,action FROM market_delegation_audit WHERE actor_user_id=$1 ORDER BY id",
  [ids.user]);
 const {rows:memberships}=await pool.query(
  "SELECT id,status FROM assignment_memberships WHERE id=$1",[ids.membership]);
 return {records,product:p,audits,membership:memberships[0]||null};
}
async function callAuth(user,market){
 try{
  const result=await team.resolveAuthorization(pool,{userId:user,marketCode:market,requiredCapability:'catalog.expose'});
  return {allowed:true,code:null,status:null,marketId:result.market_id,membershipId:result.membership_id};
 }catch(e){return {allowed:false,code:e.code||null,status:e.status||null}}
}
async function callExposure(ids,market,who,decision){
 try{
  const result=await catalog.setExposure(pool,{marketCode:market,actorUserId:who,
   productId:ids.product,exposure:decision});
  return {allowed:true,code:null,status:null,marketId:result.market_id,
   exposure:result.commercial_exposure};
 }catch(e){return {allowed:false,code:e.code||null,status:e.status||null}}
}
async function catalogCase(ids){
 const before=await observe(ids);
 const defaultKm=await exposure.getExposure(ids.product,ids.km.id,pool);
 const defaultCm=await exposure.getExposure(ids.product,ids.cm.id,pool);
 const enabled=await callExposure(ids,'KM',ids.user,'ENABLED');
 const afterEnable=await observe(ids);
 const kmVisible=await exposure.isProductExposedForMarketCode(ids.product,'KM',pool);
 const cmVisible=await exposure.isProductExposedForMarketCode(ids.product,'CM',pool);
 const disabled=await callExposure(ids,'KM',ids.user,'DISABLED');
 const afterDisable=await observe(ids);
 const finalKm=await exposure.getExposure(ids.product,ids.km.id,pool);
 const finalCm=await exposure.getExposure(ids.product,ids.cm.id,pool);
 return {mode:'CATALOG',ids,before,defaultKm,defaultCm,enabled,afterEnable,
  kmVisible,cmVisible,disabled,afterDisable,finalKm,finalCm};
}
async function authCase(ids){
 const before=await observe(ids);
 const authorized=await callAuth(ids.user,'KM');
 const otherMarket=await callAuth(ids.user,'CM');
 const noMembership=await callAuth(ids.without,'KM');
 const missingCapability=await callExposure(ids,'CM',ids.user,'ENABLED');
 const unauthorizedProduct=await callExposure(ids,'KM',ids.without,'ENABLED');
 const afterDenied=await observe(ids);
 await pool.query("UPDATE assignment_memberships SET status='REVOKED',revoked_at=now() WHERE id=$1",[ids.membership]);
 const afterRevocation=await callAuth(ids.user,'KM');
 const revokedExposure=await callExposure(ids,'KM',ids.user,'ENABLED');
 const final=await observe(ids);
 return {mode:'AUTH',ids,before,authorized,otherMarket,noMembership,missingCapability,
  unauthorizedProduct,afterDenied,afterRevocation,revokedExposure,final};
}
async function main(){
 try{
  const ids=await setup();
  const result=mode==='CATALOG'?await catalogCase(ids):await authCase(ids);
  console.log('BUSINESS_AUDIT_V32_PHYSICAL '+JSON.stringify({
   contract:'komerce-catalog-market-auth-physical/v32',...result,
   realOwnerCalled:true,canonicalPg:true,noExternalNetwork:true,
   noProductionAccess:true,authenticatedHttpRouteTested:false}));
 }finally{await pool.end()}
}
main().catch(e=>{console.error('BUSINESS_AUDIT_V32_CHILD_TOOL_ERROR '+(e.stack||e.message));process.exitCode=2});
