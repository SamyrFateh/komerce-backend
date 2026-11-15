/** @komerce-arch
 * @role g8-real-staging-readonly-browser-proof
 * @domain refunds
 * @layer tooling
 * @criticality high
 * @inputs staged backend, owner-approved synthetic E2E admin identity
 * @outputs real Chromium evidence of G8 OFF guards
 * @depends @playwright/test
 * @db-read none
 * @db-write none
 * @doctrine no_business_writes, no_provider_call, fail_closed, staging_only
 * @impact-areas refunds, admin-dashboard
 * @version 2026-11
 */
'use strict';
const fs=require('fs'),path=require('path');
const {chromium}=require('@playwright/test');
const ORIGIN='https://komerce-backend-production.up.railway.app';
const ROOT=path.resolve('test-results/g8-staging-readonly');
const report={kind:'G8_READONLY_NEGATIVE_BROWSER',sha:null,login:null,identity:null,api:null,ui:null,
  blockedWrites:[],errors:[],verdict:'NOT_PROVEN'};
async function main(){
 if(process.env.KOMERCE_ENV!=='staging'||process.env.KOMERCE_TARGET_ENV!=='staging'||
    process.env.GITHUB_ACTOR!==process.env.GITHUB_REPOSITORY_OWNER||
    !process.env.E2E_ADMIN_EMAIL||!process.env.E2E_ADMIN_PASSWORD)
   throw Error('G8_READONLY_TARGET_OR_OWNER_IDENTITY_INVALID');
 fs.mkdirSync(ROOT,{recursive:true});
 const browser=await chromium.launch({headless:true});
 const context=await browser.newContext({baseURL:ORIGIN,viewport:{width:1440,height:900}});
 const page=await context.newPage();
 let pass=false;
 try{
   await page.route('**/*',route=>{
     const q=route.request();
     if(q.method()==='GET'||q.method()==='HEAD'||q.method()==='OPTIONS'||
        (q.method()==='POST'&&new URL(q.url()).pathname==='/api/auth/login'))return route.continue();
     report.blockedWrites.push({method:q.method(),path:new URL(q.url()).pathname});
     return route.abort('blockedbyclient');
   });
   page.on('pageerror',error=>report.errors.push(String(error.message).slice(0,180)));
   const health=await context.request.get(ORIGIN+'/health/version');
   if(!health.ok())throw Error('G8_HEALTH_HTTP_'+health.status());
   const info=await health.json();
   report.sha=String(info.commit||info.sha||'');
   if(!/^[0-9a-f]{40}$/i.test(report.sha))throw Error('G8_STAGING_SHA_UNKNOWN');
   const expected=String(process.env.E2E_EXPECTED_DEPLOY_SHA||'');
   if(!/^[0-9a-f]{40}$/i.test(expected)||report.sha!==expected)
     throw Error('G8_STAGING_SHA_MISMATCH');
   await page.goto(ORIGIN+'/login.html?next='+encodeURIComponent('/g8-remboursements.html'),{waitUntil:'domcontentloaded'});
   await page.locator('#email').fill(process.env.E2E_ADMIN_EMAIL);
   await page.locator('#password').fill(process.env.E2E_ADMIN_PASSWORD);
   const reply=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/auth/login'&&r.request().method()==='POST',{timeout:25000});
   await page.locator('#btn-submit').click();
   const result=await reply;report.login=result.status();
   if(!result.ok())throw Error('G8_LOGIN_NOT_ACCEPTED_HTTP_'+result.status());
   await page.goto(ORIGIN+'/g8-remboursements.html',{waitUntil:'domcontentloaded'});
   const role=await context.request.get(ORIGIN+'/api/auth/me');
   const me=role.ok()?await role.json():{};
   report.identity={http:role.status(),role:(me.user||me).role||null};
   if(report.identity.role!=='admin')throw Error('G8_ADMIN_ROLE_NOT_VERIFIED');
   await page.locator('#g8-env').getByText('Parcours désactivé').waitFor({timeout:20000});
   report.ui={gate:await page.locator('#g8-env').innerText(),
     visibleError:await page.locator('#g8-status').innerText(),
     cases:await page.locator('[data-g8-case]').count()};
   const api=await context.request.get(ORIGIN+'/api/admin/orders/local-refunds');
   const data=await api.json().catch(()=>({}));
   report.api={http:api.status(),code:String(data.code||'').slice(0,100)};
   if(report.api.http!==409||report.api.code!=='LOCAL_REFUND_NOT_CERTIFIED'||
      report.ui.cases!==0||report.blockedWrites.length!==0||report.errors.length!==0)
     throw Error('G8_READONLY_BLOCKING_CONTRACT_FAILED');
   await page.screenshot({path:path.join(ROOT,'g8-off-guard-real-chromium.png'),fullPage:true});
   report.verdict='PASS_READONLY_GUARDS_ONLY';pass=true;
 }finally{
   fs.writeFileSync(path.join(ROOT,'browser-evidence.json'),JSON.stringify(report,null,2)+'\n');
   await browser.close();
 }
 if(!pass)throw Error('G8_READONLY_NOT_PROVEN');
}
main().catch(error=>{console.error('G8_READONLY_FAIL:'+String(error.message).slice(0,200));process.exitCode=2;});
