'use strict';
/** @komerce-arch-lite
 * @role g8-staging-flags-preflight-chromium
 * @domain refunds
 * @layer e2e
 * @owner backend-core
 * @purpose Verify G8 is ON on the real staging backend BEFORE any synthetic DB writes
 * @impact-areas staging, refunds
 */
const {chromium}=require('@playwright/test'),db=require('../../db');
const {confirmTarget}=require('./target-guard');
const ORIGIN='https://komerce-backend-production.up.railway.app';
async function main(){
 if(process.env.KOMERCE_ENV!=='staging'||process.env.KOMERCE_TARGET_ENV!=='staging'||
   process.env.STAGING_BASE_URL!==ORIGIN||
   process.env.G8_STAGING_SYNTHETIC_APPROVED!=='1'||
   process.env.GITHUB_ACTOR!==process.env.GITHUB_REPOSITORY_OWNER||
   !process.env.E2E_ADMIN_EMAIL||!process.env.E2E_ADMIN_PASSWORD)
   throw Error('G8_STAGING_FLAG_CHECK_UNAUTHORIZED');
 const target=await confirmTarget({db});
 if(target.confirmed!==true)throw Error('G8_STAGING_DB_IDENTITY_NOT_CONFIRMED');
 const browser=await chromium.launch({headless:true});
 try {
  const context=await browser.newContext({baseURL:ORIGIN});
  const page=await context.newPage();
  await page.route('**/*',route=>{
    const req=route.request(),url=new URL(req.url());
    if(url.origin!==ORIGIN)return route.abort('blockedbyclient');
    if(['GET','HEAD','OPTIONS'].includes(req.method())||
      req.method()==='POST'&&url.pathname==='/api/auth/login')return route.continue();
    return route.abort('blockedbyclient');
  });
  await page.goto('/login.html?next='+encodeURIComponent('/g8-remboursements.html'));
  await page.locator('#email').fill(process.env.E2E_ADMIN_EMAIL);
  await page.locator('#password').fill(process.env.E2E_ADMIN_PASSWORD);
  const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/auth/login'&&r.request().method()==='POST');
  await page.locator('#btn-submit').click();
  const login=await response;
  if(login.status()!==200)throw Error('G8_STAGING_FIXTURE_ADMIN_LOGIN_NOT_200');
  const me=await page.request.get('/api/auth/me');
  if(!me.ok())throw Error('G8_STAGING_AUTH_ME_FAILED');
  const user=await me.json();if((user.user||user).role!=='admin')
    throw Error('G8_STAGING_ADMIN_ROLE_NOT_CONFIRMED');
  const api=await page.request.get('/api/admin/orders/local-refunds');
  if(api.status()!==200)throw Error('G8_STAGING_FLAGS_NOT_ON_HTTP_'+api.status());
  console.log(JSON.stringify({verdict:'G8_REAL_STAGING_FLAGS_ON_PRE_WRITE',
   backend:ORIGIN,dbIdentity:true,adminRole:true,routeStatus:200,writes:0}));
 }finally{await browser.close();}
}
main().catch(e=>{console.error('G8_STAGING_FLAGS_PREFLIGHT_FAIL:'+e.message);process.exitCode=2})
 .finally(()=>db.pool?.end?.());
