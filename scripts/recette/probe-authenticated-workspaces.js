'use strict';
/**
 * REAL authenticated API proof on the privately-provisioned Railway database.
 * Runs in a pre-deploy container, starts Komerce's real Express bootstrap on
 * 127.0.0.1, then only reads workspaces and verifies the write firewall.
 * No production domain, supplier API or real PSP is contacted.
 */
const assert=require('node:assert/strict');
async function main(){
 if(process.env.KOMERCE_RECETTE_ISOLATED!=='true' ||
    process.env.KOMERCE_ENV!=='staging' ||
    !String(process.env.DATABASE_URL||'').includes('.railway.internal:')){
   throw Error('ISOLATED_PRIVATE_DB_REQUIRED');
 }
 if(process.env.KOMERCE_DISABLE_CRONS!=='true' ||
    process.env.KOMERCE_SKIP_STARTUP_MIGRATIONS!=='true'){
   throw Error('ISOLATED_AUTOMATIONS_NOT_DISABLED');
 }
 const app=require('../../server');
 const server=app.get('httpServer');
 let completed=false;
 try{
  await server.ready;
  const origin='http://127.0.0.1:'+(server.address()?.port||process.env.PORT||3000);
  async function read(path,{method='GET',body,cookie,bearer}={}){
   const response=await fetch(origin+path,{
     method,headers:{...(body?{'content-type':'application/json'}:{}),
       ...(cookie?{cookie}:{}),...(bearer?{authorization:'Bearer '+bearer}:{})},
     body:body?JSON.stringify(body):undefined,
     signal:AbortSignal.timeout(15000),
   });
   const json=await response.json().catch(()=>({}));
   return {status:response.status,json,cookie:response.headers.get('set-cookie')};
  }
  const health=await read('/health/version');
  assert.equal(health.status,200,'health version HTTP 200');
  const login=await read('/api/auth/login',{method:'POST',body:{
    email:'recette-admin@example.invalid',password:process.env.ADMIN_PASSWORD,
  }});
  assert.equal(login.status,200,'synthetic admin authenticated');
  assert.equal(login.json?.user?.role,'admin');
  const cookie=(login.cookie||'').split(';')[0];
  assert(cookie.length>15,'session cookie exists');
  for(const path of ['/api/admin/workspaces/catalog?unified=1',
                     '/api/admin/workspaces/sourcing',
                     '/api/admin/workspaces/pricing']){
    const result=await read(path,{cookie});
    assert.equal(result.status,200,path+' : '+String(result.json?.code||result.json?.error||'HTTP error'));
  }

  // Real API, real PostgreSQL and real pricing engine, but only an artificial
  // supplier candidate. Do not auto-handoff or assign any market price.
  const ref='KSC-RECETTE-ECO-01';
  const options=await read('/api/admin/workspaces/sourcing/candidates/'+ref+'/category-options',{cookie});
  assert.equal(options.status,200,'economic category options available');
  assert(options.json?.categories?.some(c=>c.key==='phones'),
    'canonical phones category exists');
  const bearer=cookie.slice(cookie.indexOf('=')+1);
  assert(bearer.split('.').length===3,'auth cookie contains canonical JWT');
  const resolved=await read('/api/admin/workspaces/sourcing/candidates/'+ref+'/resolve-category',{
    method:'POST',body:{category_key:'phones'},bearer,
  });
  assert.equal(resolved.status,200,'category fix and economic rescan : '+
    String(resolved.json?.code||resolved.json?.error||'HTTP'));
  const result=resolved.json?.result;
  assert.equal(result?.category?.key,'phones');
  assert(['TEST','WATCH','AVOID','LOSS'].includes(result?.scan?.decision),
    'economic verdict remains separate from category selection');
  assert.equal(result?.scan?.economics?.market_price_decided,false);
  const recalc=Number(result?.scan?.economics?.variable_cost_complete_kmf||0);
  assert(recalc>0,'economic category must produce a positive fully variable cost');
  const safeFloor=Number(result?.scan?.economics?.minimum_safe_price_kmf||0);
  const indicativeTest=Number(result?.scan?.economics?.test_price_kmf||0);
  assert(safeFloor>0,'economic scan must prove the safety floor');
  assert(indicativeTest>0,'economic scan must prove an indicative test price');
  const db=require('../../db');
  const {rows:[persisted]}=await db.query(
    'SELECT product_id,komerce_category,scan_result FROM sourcing_candidates WHERE candidate_ref=$1',[ref]);
  assert.equal(persisted.product_id,null,'no automatic Catalogue promotion');
  assert.equal(persisted.komerce_category,'phones');
  assert(Number(persisted.scan_result?.variable_cost_complete_kmf)>0);
  console.log('RECETTE_ECONOMIC_CHAIN_PASS '+JSON.stringify({
    fixture:ref,category:'phones',decision:result.scan.decision,
    variable_cost_kmf:recalc,safety_floor_kmf:safeFloor,
    indicative_test_price_kmf:indicativeTest,
    health:result.scan.economics.health_status,
    market_price_decided:false,product_handoff:false,
  }));
  for(const path of ['/api/orders','/api/payments/stripe/webhook','/api/auth/register']){
    const denied=await read(path,{method:'POST',body:{},cookie});
    assert.equal(denied.status,403,path+' must be blocked');
    assert.equal(denied.json?.code,'RECETTE_MUTATION_BLOCKED');
  }
  console.log('RECETTE_AUTHENTICATED_API_PASS: health + admin login + Catalogue/Sourcing/Pricing 200 + payment/orders/signup 403, only synthetic category write');
  completed=true;
 }finally{
  await new Promise(resolve=>server.close(resolve));
 }
 return completed;
}
main().then(()=>process.exit(0)).catch(e=>{
 console.error('RECETTE_AUTHENTICATED_API_FAILED:',String(e.message||e).slice(0,350));
 process.exit(1);
});
