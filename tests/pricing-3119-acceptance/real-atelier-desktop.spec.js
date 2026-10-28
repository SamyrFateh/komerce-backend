'use strict';
/** PR #3119: true deployed desktop UX on authenticated real staging. STRICT read-only. */
const {test,expect}=require('@playwright/test');
const fs=require('node:fs'),path=require('node:path');
const BASE='https://komerce-backend-production.up.railway.app';
const TARGET_SHA='69fc8ee64027b66f758e5862bb4d4c0d3fa03581';
const OUT=path.resolve('test-results/pricing-3119-desktop-real');fs.mkdirSync(OUT,{recursive:true});
const role=process.env.E2E_ROLE||'admin', prefix='E2E_'+role.toUpperCase()+'_';
test('real KM Atelier: C1/C2/C3/C5, product context, no pricing writes',async({page})=>{
 test.setTimeout(210000);
 const report={role,viewport:'1440x900',expectedSha:TARGET_SHA,observedSha:null,
   auth:'NOT_CHECKED',screens:[],errors:[],forbiddenWrites:[],navigation:[],C4:'BLOCKED_READ_ONLY',status:'STARTED'};
 const save=()=>fs.writeFileSync(path.join(OUT,role+'.json'),JSON.stringify(report,null,2)+'\n');
 const screenshot=async(name)=>{const file=role+'-'+name+'.png';await page.screenshot({path:path.join(OUT,file),fullPage:true,timeout:18000});return file;};
 const mark=async(code,data={})=>{report.screens.push({code,url:new URL(page.url()).pathname+new URL(page.url()).search,
    screenshot:await screenshot(code),...data});save();};
 page.on('pageerror',err=>report.errors.push(String(err.message).slice(0,170)));
 page.on('response',res=>{if(res.url().startsWith(BASE+'/api/')&&res.status()>=500)
   report.errors.push('API_5XX '+new URL(res.url()).pathname+' '+res.status());});
 // Prevent all non-idempotent backend actions including save, activation and observations.
 await page.route('**/*',route=>{
   const req=route.request(),url=new URL(req.url());
   if(url.origin!==BASE)return route.continue();
   if(['GET','HEAD','OPTIONS'].includes(req.method())||
      (req.method()==='POST'&&url.pathname==='/api/auth/login'))return route.continue();
   report.forbiddenWrites.push(req.method()+' '+url.pathname);
   return route.abort('blockedbyclient');
 });
 try{
   const email=process.env[prefix+'EMAIL'],password=process.env[prefix+'PASSWORD'];
   if(!email||!password)throw new Error('MISSING_E2E_CREDENTIALS '+prefix);
   const health=await page.request.get(BASE+'/health/version');
   expect(health.ok()).toBe(true);
   const version=await health.json();report.observedSha=version.commit||version.sha||null;
   expect(report.observedSha,'wrong deployed SHA').toBe(TARGET_SHA);
   await page.goto(BASE+'/login.html?next='+encodeURIComponent('/admin/workspaces/pricing?market=KM'),
     {waitUntil:'domcontentloaded',timeout:17000});
   await page.locator('#email').fill(email);await page.locator('#password').fill(password);
   const authWait=page.waitForResponse(res=>res.url().startsWith(BASE+'/api/auth/login')&&res.request().method()==='POST',{timeout:20000});
   await page.locator('#btn-submit').click();
   const auth=await authWait;report.auth='HTTP '+auth.status();expect(auth.ok()).toBe(true);
   const profile=await page.request.get(BASE+'/api/auth/me');expect(profile.ok()).toBe(true);
   report.actualRole=(await profile.json()).role;expect(report.actualRole).toBe(role);
   await page.goto(BASE+'/admin/workspaces/pricing?market=KM',{waitUntil:'domcontentloaded',timeout:22000});
   await expect(page.locator('[data-atelier-nav]')).toBeVisible({timeout:30000});
   const tabs=page.locator('[data-atelier-nav] [role="tab"]');
   await expect(tabs).toHaveCount(3);
   expect((await tabs.allTextContents()).map(x=>x.trim().replace(/\s*\d+$/,'').trim()))
      .toEqual(['Vue économique','Produits à décider','Modèle de coûts']);
   await expect(page.locator('[data-atelier-policy]')).toBeVisible({timeout:25000});
   const policyText=await page.locator('[data-atelier-policy]').innerText();
   report.policyNonDecisional=policyText.includes('Non décisionnelle');
   if(report.policyNonDecisional)expect(policyText).not.toMatch(/Ratio de couverture\s+0(?:\.0+)?/);
   await mark('C1-economique',{policyExcerpt:policyText.slice(0,330)});
   await tabs.nth(1).click();
   await expect(page.locator('[data-atelier-queue]')).toBeVisible({timeout:18000});
   await expect(page.locator('[data-atelier-products]')).toBeVisible();
   await page.waitForTimeout(1600);
   const rows=page.locator('[data-atelier-queue] [data-product-ref]');
   const count=await rows.count();report.queueRows=count;
   await mark('C2-file',{rows:count,body:(await page.locator('[data-atelier-queue]').innerText()).slice(0,500)});
   const link=page.locator('[data-atelier-queue] [data-atelier-open]').first();
   if(await link.count()){
     const ref=await link.getAttribute('data-atelier-open');
     await link.click();
     await expect(page.locator('[data-atelier-dossier]')).toBeVisible({timeout:23000});
     const displayed=await page.locator('[data-atelier-dossier]').getAttribute('data-atelier-dossier');
     expect(displayed).toBe(ref);
     expect(new URL(page.url()).searchParams.get('product_ref')).toBe(ref);
     await mark('C3-dossier',{productRef:ref,
       corridorShown:await page.locator('[data-atelier-corridor]').count()>0,
       observationsShown:await page.locator('[data-atelier-observations]').count()>0,
       draftFormPresent:await page.locator('[data-atelier-draft-form]').count()>0});
     const back=page.locator('[data-atelier-back]').first();
     await back.click();
     await expect(page.locator('[data-atelier-queue]')).toBeVisible();
     report.navigation.push({from:'C3',to:'C2',ref,refInURL:new URL(page.url()).searchParams.get('product_ref')});
   }else{
     report.navigation.push({from:'C2',to:'C3',result:'BLOCKED_NO_SERVER_ROWS'});
   }
   await tabs.nth(2).click();
   await expect(page.locator('.kmc-cockpit-costs')).toBeVisible({timeout:12000});
   await mark('C5-modele-couts');
   report.status='PASS';
 }catch(e){report.status='FAIL';report.reason=String(e.message).slice(0,650);
   try{report.failedScreenshot=await screenshot('FAIL');}catch{}throw e;
 }finally{save();}
});
