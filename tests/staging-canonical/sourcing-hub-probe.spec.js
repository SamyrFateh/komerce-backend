/**
 * @komerce-arch-lite
 * @role staging-chromium-sourcing-hub-navigation-diagnostic
 * @domain dashboard
 * @layer e2e
 * @owner backend-core
 * @purpose Isoler le vrai clic Sourcing vers Hub, les redirects et les refus HTTP sans modifier les autorisations.
 * @impact-areas dashboard, staging-only, authorization
 */
'use strict';
const fs=require('fs'),path=require('path');
const {test,expect}=require('@playwright/test');
const ORIGIN='https://komerce-backend-production.up.railway.app';
const OUT=path.resolve('test-results/staging-chromium/live-proof/sourcing-hub-probe.json');
const allowedPaths=new Set(['/','/admin/hub','/admin/import-runtime','/login.html','/api/auth/me','/api/admin/dashboard/context','/health/version']);
const pathname=u=>{try{const v=new URL(u,ORIGIN);return v.origin===ORIGIN?v.pathname:null;}catch{return null;}};
const short=s=>String(s||'').slice(0,120);
test('Sourcing → Hub vrai clic, refus de contexte distinct et navigation traçable',async({page},info)=>{
  test.skip(info.project.name!=='sourcing-desktop','Diagnostic exclusivement pour sourcing, pas une certification globale');
  expect(process.env.E2E_STAGING_BASE_URL).toBe(ORIGIN);
  const sha=String(process.env.E2E_EXPECTED_DEPLOY_SHA||'');
  expect(sha).toMatch(/^[0-9a-f]{40}$/);
  const proof={kind:'SOURCING_HUB_REAL_CLICK_DIAG',role:'sourcing',status:'NOT_PROVEN',
    pinned_sha:sha,observed_sha:null,after_sha:null,
    login_http:null,role_from_me:null,context_http:null,before_me_http:null,after_me_http:null,
    before_click:null,after_click:null,direct_url:null,events:[],blocked_writes:[],errors:[]};
  const event=(kind,details={})=>proof.events.push({kind,...details});
  const save=()=>{
    fs.mkdirSync(path.dirname(OUT),{recursive:true});
    fs.writeFileSync(OUT,JSON.stringify(proof,null,2)+'\n');
  };
  const version=await page.request.get('/health/version');
  expect(version.ok()).toBeTruthy();
  const obj=await version.json();
  proof.observed_sha=String(obj.commit||obj.sha||'');
  try{
    expect(proof.observed_sha).toBe(sha);
    await page.route('**/*',route=>{
      const r=route.request(),u=new URL(r.url());
      if(u.origin!==ORIGIN)return route.continue();
      if(['GET','HEAD','OPTIONS'].includes(r.method())||
         (r.method()==='POST'&&u.pathname==='/api/auth/login'))return route.continue();
      proof.blocked_writes.push({method:r.method(),path:u.pathname});
      return route.abort('blockedbyclient');
    });
    page.on('framenavigated',frame=>{
      if(frame===page.mainFrame()){const p=pathname(frame.url());if(p)event('FRAME_NAVIGATED',{path:p});}
    });
    page.on('request',request=>{
      const p=pathname(request.url());
      if(p&&allowedPaths.has(p))event('REQUEST',{method:request.method(),path:p,
        redirect_from:pathname(request.redirectedFrom()?.url())});
    });
    page.on('response',response=>{
      const p=pathname(response.url());
      if(p&&allowedPaths.has(p))event('RESPONSE',{path:p,status:response.status(),
        resource_type:response.request().resourceType()});
    });
    page.on('requestfailed',request=>{
      const p=pathname(request.url());
      if(p&&allowedPaths.has(p))event('REQUEST_FAILED',{path:p,error:short(request.failure()?.errorText)});
    });
    page.on('pageerror',error=>proof.errors.push({kind:'PAGEERROR',message:short(error.message)}));
    const email=process.env.E2E_SOURCING_EMAIL,password=process.env.E2E_SOURCING_PASSWORD;
    expect(email&&password).toBeTruthy();
    await page.goto('/login.html?next='+encodeURIComponent('/admin/import-runtime'),{waitUntil:'domcontentloaded'});
    await page.locator('#email').fill(email);
    await page.locator('#password').fill(password);
    const loginPromise=page.waitForResponse(r=>pathname(r.url())==='/api/auth/login'&&r.request().method()==='POST');
    await page.locator('#btn-submit').click();
    proof.login_http=(await loginPromise).status();
    expect(proof.login_http).toBe(200);
    await page.goto('/admin/import-runtime',{waitUntil:'domcontentloaded'});
    await page.locator('a[href="/admin/hub"]').first().waitFor({state:'visible',timeout:15000});
    const me=await page.request.get('/api/auth/me');
    proof.before_me_http=me.status();
    if(me.ok()){const actor=await me.json();proof.role_from_me=String(actor.role||'');}
    const context=await page.request.get('/api/admin/dashboard/context');
    proof.context_http=context.status();
    proof.before_click=pathname(page.url());
    expect(proof.before_click).toBe('/admin/import-runtime');
    expect(proof.before_me_http).toBe(200);
    expect(proof.role_from_me).toBe('sourcing');
    expect(proof.context_http).toBe(403);
    // Le véritable href reste l'autorité d'UI ; pas de page.goto pour remplacer un clic défectueux.
    await page.locator('a[href="/admin/hub"]').first().click();
    await page.waitForURL(url=>pathname(String(url))==='/admin/hub',{timeout:12000}).catch(()=>{});
    proof.after_click=pathname(page.url());
    // Même si le clic échoue, distinguer un problème de lien d'une route Hub directe inaccessible.
    if(proof.after_click!=='/admin/hub'){
      const afterMe=await page.request.get('/api/auth/me');
      proof.after_me_http=afterMe.status();
      const direct=await page.goto('/admin/hub',{waitUntil:'domcontentloaded'});
      await page.waitForTimeout(900);
      proof.direct_url={http:direct?.status(),path:pathname(page.url())};
    }
    const end=await page.request.get('/health/version');
    proof.after_sha=end.ok()?String((await end.json()).commit||(await end.json()).sha||''):null;
    proof.status=proof.after_click==='/admin/hub'&&proof.after_sha===sha&&proof.blocked_writes.length===0&&proof.errors.length===0?'PASS':'FAIL';
    expect(proof.after_sha,'Le code serveur a changé pendant le diagnostic').toBe(sha);
    expect(proof.blocked_writes,'Aucune écriture métier permise').toEqual([]);
    expect(proof.errors,'Aucune erreur JavaScript permise').toEqual([]);
    expect(proof.after_click,'Le vrai clic Sourcing doit arriver sur /admin/hub, pas sur /').toBe('/admin/hub');
  }finally{save();}
});
