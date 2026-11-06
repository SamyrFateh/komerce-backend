/**
 * @komerce-arch-lite
 * @role hub-v1-staging-chromium-encrypted-video-recording
 * @domain dashboard
 * @layer e2e
 * @owner backend-core
 * @purpose Enregistrer la lecture réelle Chromium post-transactionnelle sur une fixture E2E, sans filmer la connexion ni publier des sessions en clair.
 * @impact-areas dashboard, hub, relay, staging-only, authorization
 */
'use strict';
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const {test,expect}=require('@playwright/test');
const {encryptFile}=require('../../scripts/recette/chromium-video-crypto');
const BASE='https://komerce-backend-production.up.railway.app';
const ROOT=path.resolve('test-results/hub-v1-chromium-recording');
const PRIVATE=path.join(ROOT,'private');
const OUTPUT=path.join(ROOT,'encrypted');
const RUN8=String(process.env.E2E_PROOF_RUN8||'').toUpperCase();
const ROLES={
 admin:['/admin/hub-live?view=queue&tab=to_prepare&sim=1','/admin/relais-live?view=orders&list=all&sim=1'],
 agent_hub:['/admin/hub?branch=operational','/admin/hub-live?view=execute&sim=1'],
 agent_relais:['/admin/relais-live?view=orders&list=all&sim=1','/admin/action-center'],
};
const REFS=['KOM-101','KOM-102','KOM-103','LOCAL'].map(x=>`E2E-HUB-V1-${RUN8}-${x}`);
test.use({video:'off',trace:'off',screenshot:'off'});

test('Hub V1 staging video, genuine read-only UI actions, post-login encryption',async({browser,request},info)=>{
 test.skip(process.env.E2E_CHROMIUM_SPEC_FILTER!=='hub-v1-recording-readonly','Recording is an explicit opt-in workflow only');
 const role=info.project.name.replace(/-desktop$/,'');
 test.skip(!ROLES[role],'Only Admin/Hub/Relais role chapters are recorded');
 expect(new URL(process.env.E2E_STAGING_BASE_URL||BASE).origin).toBe(BASE);
 expect(RUN8).toMatch(/^[A-F0-9]{8}$/);
 const expected=String(process.env.E2E_EXPECTED_DEPLOY_SHA||'');
 expect(expected).toMatch(/^[a-f0-9]{40}$/i);
 const start=await request.get(BASE+'/health/version');
 expect(start.status()).toBe(200);
 const sha=String((await start.json()).commit||'');
 expect(sha).toBe(expected);
 fs.mkdirSync(PRIVATE,{recursive:true});fs.mkdirSync(OUTPUT,{recursive:true});
 const evidence={schema:'komerce-chromium-recording/1',kind:'READONLY_UI_VIDEO',
   transactional_13_steps:'NOT_PROVEN_BY_THIS_VIDEO',sha,run8:RUN8,role,viewport:'1440x900',
   refs:REFS,route_reads:[],clicks:[],blocked_writes:0,blocked_external:0,browser_errors:0,
   found_fixture_refs:[],video_encrypted:false,trace_encrypted:false,status:'HOLD'};
 const archive=()=>fs.writeFileSync(path.join(OUTPUT,role+'-timeline.json'),JSON.stringify(evidence,null,2)+'\n');
 const prefix='E2E_'+role.toUpperCase()+'_';
 const email=process.env[prefix+'EMAIL'],password=process.env[prefix+'PASSWORD'];
 expect(email&&password).toBeTruthy();
 // Never record login: the unfilmed context is destroyed after transferring
 // only its in-memory session state to the filmed context.
 const auth=await browser.newContext({baseURL:BASE,viewport:{width:1440,height:900}});
 await auth.route('**/*',route=>{
  const req=route.request(),url=new URL(req.url());
  if(url.origin===BASE && (['GET','HEAD','OPTIONS'].includes(req.method()) ||
   (req.method()==='POST'&&url.pathname==='/api/auth/login')))return route.continue();
  return route.abort('blockedbyclient');
 });
 let state;
 try{
  const loginPage=await auth.newPage();
  await loginPage.goto('/login.html?next='+encodeURIComponent(ROLES[role][0]),{waitUntil:'domcontentloaded'});
  await loginPage.locator('#email').fill(email);
  await loginPage.locator('#password').fill(password);
  const login=loginPage.waitForResponse(r=>new URL(r.url()).pathname==='/api/auth/login'&&r.request().method()==='POST');
  await loginPage.locator('#btn-submit').click();
  expect((await login).status()).toBe(200);
  await loginPage.waitForURL(u=>u.pathname!=='/login.html',{timeout:18000});
  state=await auth.storageState();
 }finally{await auth.close();}
 const ctx=await browser.newContext({baseURL:BASE,viewport:{width:1440,height:900},
   storageState:state,recordVideo:{dir:PRIVATE,size:{width:1440,height:900}}});
 // The state is never written to disk, logged, archived or copied to evidence.
 state=null;
 const page=await ctx.newPage();
 const video=page.video();
 const traceFile=path.join(PRIVATE,role+'.zip');
 const names=[];
 try{
  await ctx.route('**/*',route=>{
   const req=route.request(),url=new URL(req.url());
   if(url.origin!==BASE){evidence.blocked_external++;return route.abort('blockedbyclient');}
   if(['GET','HEAD','OPTIONS'].includes(req.method()))return route.continue();
   evidence.blocked_writes++;
   return route.abort('blockedbyclient');
  });
  page.on('pageerror',()=>evidence.browser_errors++);
  await ctx.tracing.start({screenshots:true,snapshots:true,sources:false});
  for(const route of ROLES[role]){
    const response=await page.goto(route,{waitUntil:'domcontentloaded'});
    await page.waitForLoadState('networkidle',{timeout:8000}).catch(()=>{});
    await page.waitForTimeout(650);
    const body=await page.locator('body').innerText();
    const found=REFS.filter(ref=>body.includes(ref));
    names.push(...found);
    evidence.route_reads.push({path:new URL(page.url()).pathname,http:response?.status()||null,
      fixture_refs:found,body_sha256:crypto.createHash('sha256').update(body).digest('hex')});
    // Click a genuine visible navigation link; never synthesize an event or
    // invoke a state-changing API to pad the recording.
    const link=page.locator('a[href="/admin/action-center"],a[href="/admin/hub-live"],a[href="/admin/relais-live"]').filter({visible:true}).first();
    if(await link.count()){
      const href=await link.getAttribute('href');
      await link.click({timeout:12000});
      evidence.clicks.push({href,actual:new URL(page.url()).pathname,kind:'REAL_UI_CLICK'});
    }
  }
  if(role==='admin'){
   for(const ref of REFS){
    const response=await page.goto('/admin/orders/'+encodeURIComponent(ref),{waitUntil:'domcontentloaded'});
    await page.waitForTimeout(700);
    const text=await page.locator('body').innerText();
    evidence.route_reads.push({path:'/admin/orders/E2E-HUB-V1-'+RUN8+'-*',http:response?.status()||null,
      fixture_refs:text.includes(ref)?[ref]:[],kind:'ORDER_360_READBACK'});
    if(text.includes(ref))names.push(ref);
   }
  }
  evidence.found_fixture_refs=[...new Set(names)];
  const finish=await request.get(BASE+'/health/version');
  evidence.sha_stable=finish.status()===200&&String((await finish.json()).commit||'')===expected;
  evidence.status=(evidence.sha_stable&&evidence.blocked_writes===0&&evidence.browser_errors===0&&
    evidence.clicks.length>0&&evidence.found_fixture_refs.length>0)?'PASS_READONLY_RECORDING':'HOLD_NOT_PROVEN';
 }catch(error){evidence.status='FAIL';evidence.error_code='RECORDING_FAILED';throw error;}
 finally{
  try{await ctx.tracing.stop({path:traceFile});}finally{await ctx.close();}
  const videoFile=await video.path();
  // Only ENCRYPTED assets go to Actions artifacts. Raw trace and WebM are
  // removed immediately after AES-256-GCM envelope creation.
  encryptFile(videoFile,path.join(OUTPUT,role+'.webm.enc'));
  evidence.video_encrypted=true;
  encryptFile(traceFile,path.join(OUTPUT,role+'.trace.zip.enc'));
  evidence.trace_encrypted=true;
  archive();
 }
 expect(evidence.status).toBe('PASS_READONLY_RECORDING');
});
