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
  async function read(path,{method='GET',body,cookie}={}){
   const response=await fetch(origin+path,{
     method,headers:{...(body?{'content-type':'application/json'}:{}),
       ...(cookie?{cookie}:{})},
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
  for(const path of ['/api/orders','/api/payments/stripe/webhook','/api/auth/register']){
    const denied=await read(path,{method:'POST',body:{},cookie});
    assert.equal(denied.status,403,path+' must be blocked');
    assert.equal(denied.json?.code,'RECETTE_MUTATION_BLOCKED');
  }
  console.log('RECETTE_AUTHENTICATED_API_PASS: health + admin login + Catalogue/Sourcing/Pricing 200 + payment/orders/signup 403, 0 business writes');
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
