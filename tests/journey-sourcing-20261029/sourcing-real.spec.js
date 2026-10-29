'use strict';
/**
 * Recette guidée, étape 1 : Sourcing canonique réel — affichage et navigation uniquement.
 * No writing mutations except authentication POST. Exact deployed SHA is asserted.
 */
const { test, expect } = require('@playwright/test');
const fs = require('fs'), path = require('path');
const BASE = 'https://komerce-backend-production.up.railway.app';
const EXPECTED = '69fc8ee64027b66f758e5862bb4d4c0d3fa03581';
const DIR = path.resolve('test-results/journey-sourcing-20261029');
fs.mkdirSync(DIR,{recursive:true});
test('Sourcing réel — les 4 rubriques et les actions de À qualifier',async({page})=>{
 test.setTimeout(180000);
 const report = { screen:'Sourcing',role:'sourcing',sha:null,authenticated:false,route:null,tabs:[],views:[],writesBlocked:[],pageErrors:[],apiErrors:[],outcome:'NOT_RUN' };
 const save=()=>fs.writeFileSync(path.join(DIR,'sourcing-report.json'),JSON.stringify(report,null,2)+'\n');
 page.on('pageerror',err=>report.pageErrors.push(err.message.slice(0,220)));
 page.on('response',r=>{ if(r.url().startsWith(BASE+'/api/')&&r.status()>=400)report.apiErrors.push({route:new URL(r.url()).pathname,status:r.status()}); });
 await page.route('**/*',route=>{
   const request=route.request(),url=new URL(request.url());
   if(url.origin!==BASE)return route.continue();
   if(['GET','HEAD','OPTIONS'].includes(request.method())||(url.pathname==='/api/auth/login'&&request.method()==='POST')) return route.continue();
   report.writesBlocked.push(request.method()+' '+url.pathname);
   return route.abort('blockedbyclient');
 });
 const screen=async(name)=>{
   await page.screenshot({path:path.join(DIR,'sourcing-'+name+'-1440.png'),fullPage:true,timeout:25000});
   await page.screenshot({path:path.join(DIR,'sourcing-'+name+'-first-screen-1440.png'),fullPage:false,timeout:25000});
 };
 try {
  const health=await page.request.get(BASE+'/health/version',{timeout:18000});
  expect(health.ok()).toBe(true);const v=await health.json();report.sha=v.commit||v.sha||null;
  expect(report.sha).toBe(EXPECTED);
  const user=process.env.E2E_SOURCING_EMAIL,pass=process.env.E2E_SOURCING_PASSWORD;
  if(!user||!pass) throw new Error('E2E_SOURCING_CREDENTIALS_MISSING');
  await page.goto(BASE+'/login.html?next='+encodeURIComponent('/admin/workspaces/sourcing'),{waitUntil:'domcontentloaded',timeout:22000});
  await page.locator('#email').fill(user);
  await page.locator('#password').fill(pass);
  const auth=page.waitForResponse(res=>res.url().includes('/api/auth/login')&&res.request().method()==='POST',{timeout:30000});
  await page.locator('#btn-submit').click();
  const response=await auth;expect(response.status()).toBe(200);
  report.authenticated=true;
  await page.goto(BASE+'/admin/workspaces/sourcing',{waitUntil:'domcontentloaded',timeout:22000});
  report.route=new URL(page.url()).pathname+new URL(page.url()).search;
  const tabs=page.locator('.kmc-sourcing-tabs [role="tab"]');
  await expect(tabs).toHaveCount(4,{timeout:30000});
  report.tabs=(await tabs.allTextContents()).map(x=>x.trim());
  const slugs=['a-qualifier','imports-decouvertes','portefeuille','fournisseurs'];
  for(let i=0;i<4;i++){
    await tabs.nth(i).click();
    const tab=await tabs.nth(i).getAttribute('aria-controls');
    const host=page.locator('#'+tab);
    await expect(host).toBeVisible({timeout:17000});
    await page.waitForTimeout(1100);
    const view={
      name:slugs[i],
      tabText:(await tabs.nth(i).innerText()).trim(),
      panelText:(await host.innerText()).slice(0,3400),
      rowCount:await host.locator('tbody tr,[data-candidate-ref]').count(),
      primaryActions:(await host.locator('button,a').allTextContents()).map(x=>x.trim()).filter(Boolean).slice(0,50),
      dataCandidates:await host.locator('[data-candidate-ref]').evaluateAll(nodes=>nodes.slice(0,6).map(n=>({
        ref:n.getAttribute('data-candidate-ref'),
        text:(n.innerText||'').trim().slice(0,650),
        actions:Array.from(n.querySelectorAll('button,a')).map(x=>({text:(x.innerText||'').trim(),action:x.getAttribute('data-workspace-action'),href:x.getAttribute('href')})).slice(0,15)
      }))),
      url:new URL(page.url()).pathname+new URL(page.url()).search,
    };
    report.views.push(view);await screen(slugs[i]);save();
  }
  report.outcome='PASS';
 }catch(e){report.outcome='FAIL';report.failure=String(e.message).slice(0,700);
   try{await page.screenshot({path:path.join(DIR,'sourcing-FAIL-1440.png'),fullPage:true});}catch{}
   throw e;
 }finally{save();}
});
