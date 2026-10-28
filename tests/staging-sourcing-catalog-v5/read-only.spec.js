'use strict';
// Real staging read-only acceptance for the UI branch. No fixture, no writes.
const fs=require('node:fs'),path=require('node:path');
const {test,expect}=require('@playwright/test');
const BASE='https://komerce-backend-production.up.railway.app';
const HEAD='3b3f6efb0717da4851f9768371ad4ff2c8e9f390';
const OUT=path.resolve('test-results/sourcing-catalog-staging');
fs.mkdirSync(OUT,{recursive:true});
test('real staging admin/sourcing UX, read-only',async({page},info)=>{
 test.setTimeout(3*60*1000);
 const role=process.env.E2E_ROLE||'admin';
 const prefix='E2E_'+role.toUpperCase()+'_';
 const email=process.env[prefix+'EMAIL'],password=process.env[prefix+'PASSWORD'];
 const width=info.project.name.endsWith('mobile')?390:1440;
 const result={role,width,expected:HEAD,paths:[],actionWrites:[],status:'STARTED'};
 const save=()=>fs.writeFileSync(path.join(OUT,role+'-'+width+'.json'),JSON.stringify(result,null,2)+'\n');
 const screenshot=async(label)=>page.screenshot({path:path.join(OUT,role+'-'+width+'-'+label+'.png'),fullPage:true,timeout:15000});
 page.on('pageerror',err=>{result.pageErrors=(result.pageErrors||[]).concat(String(err.message).slice(0,250));});
 await page.route('**/*',route=>{
  const req=route.request(),uri=new URL(req.url());
  if(uri.origin!==BASE||['GET','HEAD','OPTIONS'].includes(req.method()))return route.continue();
  if(req.method()==='POST'&&uri.pathname==='/api/auth/login')return route.continue();
  result.actionWrites.push({method:req.method(),path:uri.pathname});return route.abort('blockedbyclient');
 });
 try {
  if(!email||!password)throw new Error('BLOCKED: missing '+prefix+' credentials');
  const response=await page.request.get(BASE+'/health/version');
  expect(response.ok()).toBe(true);
  const health=await response.json();
  result.sha=health.commit;
  expect(health.commit,'staging SHA drift').toBe(HEAD);
  const start=role==='sourcing'?'/admin/workspaces/sourcing':'/admin/workspaces/catalog';
  await page.goto(BASE+'/login.html?next='+encodeURIComponent(start),{waitUntil:'domcontentloaded'});
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  const login=page.waitForResponse(r=>r.url().startsWith(BASE+'/api/auth/login')&&r.request().method()==='POST');
  await page.locator('#btn-submit').click();
  expect((await login).ok()).toBe(true);
  const profile=await page.request.get(BASE+'/api/auth/me');
  expect(profile.ok()).toBe(true);
  const who=await profile.json();
  result.actualRole=who.role;
  expect(who.role).toBe(role);
  const visit=async(url,label)=>{
   const response=await page.goto(BASE+url,{waitUntil:'domcontentloaded'});
   expect(response.status()).toBe(200);
   expect(new URL(page.url()).pathname).toBe(url.split('?')[0]);
   result.paths.push({requested:url,landed:new URL(page.url()).pathname});
  };
  if(role==='sourcing'){
   await visit('/admin/workspaces/sourcing','sourcing-initial');
   await expect(page.getByRole('tab',{name:/À qualifier/})).toBeVisible({timeout:25000});
   await screenshot('sourcing-initial');
   const tabs=page.getByRole('tab');
   expect(await tabs.count()).toBe(4);
   await tabs.nth(1).click();
   await expect(page.locator('#kmc-sourcing-panel-imports')).toBeVisible();
   await screenshot('sourcing-imports');
   await tabs.nth(0).click();
   const candidates=page.locator('tr[data-candidate-ref]');
   result.realCandidateCount=await candidates.count();
   if(result.realCandidateCount){
     const first=candidates.first();
     expect(await first.locator('td:last-child > [data-workspace-action]').count()).toBe(1);
     const more=first.locator('.kmc-sourcing-row-more summary');
     if(await more.count()){await more.click();await screenshot('sourcing-quick-actions');}
   }
  }else{
   await visit('/admin/workspaces/catalog','catalog-global');
   await expect(page.locator('.kmc-catalog-tabs')).toBeVisible({timeout:25000});
   await screenshot('catalog-global');
   await expect(page.getByText('Registre produits')).toBeVisible();
   const product=page.locator('tr[data-product-ref]').first();
   const ref=await product.getAttribute('data-product-ref').catch(()=>null);
   result.focusProductRef=ref;
   if(ref){
     await visit('/admin/workspaces/catalog?product_ref='+encodeURIComponent(ref),'catalog-focused');
     await expect(page.locator('[data-focused-product-result="visible"]')).toBeVisible({timeout:25000});
     await screenshot('catalog-focused');
   }
   await visit('/admin/workspaces/catalog?view=refinery','refinery');
   await expect(page.getByText('Préparation et validation')).toBeVisible({timeout:25000});
   await screenshot('refinery');
  }
  expect(result.actionWrites,'no business mutation').toEqual([]);
  result.status='PASS';
 }catch(err){result.status='FAIL';result.error=String(err.message).slice(0,450);await screenshot('failed').catch(()=>{});throw err;}
 finally{save();}
});
