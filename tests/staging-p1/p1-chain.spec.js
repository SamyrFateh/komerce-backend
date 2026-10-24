/** @komerce-arch-lite @role p1-real-staging-chromium-proof @domain catalog @layer e2e @owner backend-core @impact-areas sourcing,catalog,market,staging-only */
'use strict';
const fs=require('fs'),path=require('path');
const {test,expect}=require('@playwright/test');
const host='https://komerce-backend-production.up.railway.app';
const dir=path.resolve('test-results/staging-p1');
test('one supplier-sourced product from import to customer catalogue',async({page},info)=>{
 const result={viewport:info.project.name,observed:[],issues:[],blockedMutations:[],jsErrors:[]};
 const out=path.join(dir,info.project.name+'.json');
 const save=()=>fs.writeFileSync(out,JSON.stringify(result,null,2)+'\n');
 const see=async(k,url)=>{
   const response=await page.goto(url,{waitUntil:'domcontentloaded'});
   await page.waitForTimeout(800);
   const text=(await page.locator('body').innerText()).trim();
   result.observed.push({stage:k,url:page.url(),http:response?.status(),body_length:text.length});
   await page.screenshot({path:path.join(dir,info.project.name+'-'+k+'.png'),fullPage:true});
   if(response?.status()!==200||text.length<50)result.issues.push('SCREEN_NOT_READABLE:'+k);
   return text;
 };
 try{
   const evidence=JSON.parse(fs.readFileSync(path.join(dir,'lineage.json'),'utf8'));
   result.ref=evidence.product?.product_ref;result.market=evidence.market;result.sha=evidence.git_sha;
   if(evidence.blocker||!evidence.product?.id||!evidence.product?.run_ref)throw Error('P1_LINEAGE_BLOCKED:'+evidence.blocker);
   for(const gate of evidence.gates||[])if(gate.status!=='PROVED')result.issues.push('BACKEND_'+gate.key+':'+gate.finding);
   page.on('pageerror',e=>result.jsErrors.push(e.message.slice(0,220)));
   await page.route('**/*',route=>{
     const req=route.request(),u=new URL(req.url());
     if(u.origin!==host||['GET','HEAD','OPTIONS'].includes(req.method())||
       (req.method()==='POST'&&u.pathname==='/api/auth/login'))return route.continue();
     result.blockedMutations.push(req.method()+' '+u.pathname);
     return route.abort('blockedbyclient');
   });
   if(!process.env.E2E_ADMIN_EMAIL||!process.env.E2E_ADMIN_PASSWORD)throw Error('P1_STAGING_AUTH_MISSING');
   await page.goto('/login.html',{waitUntil:'domcontentloaded'});
   await page.locator('#email').fill(process.env.E2E_ADMIN_EMAIL);
   await page.locator('#password').fill(process.env.E2E_ADMIN_PASSWORD);
   await page.locator('#btn-submit').click();
   await page.waitForURL(u=>u.pathname!=='/login.html',{timeout:18000});
   const ctx=await page.request.get('/api/admin/dashboard/context');
   if(!ctx.ok())throw Error('P1_CONTEXT_'+ctx.status());
   await see('sourcing','/admin/import-runtime?run='+encodeURIComponent(evidence.product.run_ref));
   await see('raffinerie','/admin/workspaces/catalog?view=refinery');
   await see('catalogue','/admin/workspaces/catalog');
   const detail=await see('produit360','/admin/products/'+encodeURIComponent(evidence.product.product_ref));
   if(!detail.includes(evidence.product.product_ref))result.issues.push('PRODUCT_360_DOES_NOT_SHOW_REFERENCE');
   const publicProduct=await page.request.get('/api/products/'+evidence.product.id+'?market='+evidence.market);
   result.observed.push({stage:'public-product-api',http:publicProduct.status()});
   if(!publicProduct.ok())result.issues.push('PUBLIC_PRODUCT_NOT_VISIBLE');
   else{
     const body=await publicProduct.json();
     if(body.id!==evidence.product.id||body.product_ref!==evidence.product.product_ref)
       result.issues.push('PRODUCT_IDENTITY_CHANGED');
     if(!(Number(body.price_kmf)>0)||body.purchasable===false)
       result.issues.push('PUBLIC_PRICE_OR_STOCK_INVALID');
   }
   for(const m of evidence.market_states||[]){
     if(m.code===evidence.market||m.exposure==='ENABLED'&&m.price_status==='LOCAL_ACTIVE'&&m.is_active&&m.lifecycle_status==='ACTIVE')continue;
     const response=await page.request.get('/api/products/'+evidence.product.id+'?market='+m.code);
     result.observed.push({stage:'market-denial',market:m.code,http:response.status()});
     if(response.ok())result.issues.push('CROSS_MARKET_EXPOSURE_LEAK:'+m.code);
   }
   let catalogRequests=0;
   page.on('request',r=>{const u=new URL(r.url());if(u.origin===host&&u.pathname==='/api/products')catalogRequests++;});
   await see('boutique','/boutique/?market='+evidence.market);
   await page.waitForTimeout(1500);
   const cards=await page.locator('#k-grid .k-card,#k-grid .k-promo-card').count();
   result.observed.push({stage:'boutique-products',cards,catalogRequests});
   if(!catalogRequests||!cards)result.issues.push('BOUTIQUE_CATALOG_NOT_HYDRATED');
   const search=page.locator('#k-search-input');
   if(await search.count()){
     await search.fill(evidence.product.name.trim().split(/\s+/).slice(0,2).join(' '));
     await page.waitForTimeout(600);
     const results=await page.locator('#k-search-dropdown').innerText().catch(()=> '');
     result.observed.push({stage:'storefront-search',found:results.includes(evidence.product.name)});
     await page.screenshot({path:path.join(dir,info.project.name+'-search.png'),fullPage:true});
     if(!results.includes(evidence.product.name))result.issues.push('SOURCE_PRODUCT_NOT_FINDABLE');
   }else result.issues.push('SEARCH_NOT_RENDERED');
   if(result.jsErrors.length)result.issues.push('JS_ERROR');
   if(result.blockedMutations.length)result.issues.push('UNEXPECTED_MUTATION');
   save();
   expect(result.issues,'Review '+out).toEqual([]);
 }catch(e){result.issues.push(String(e.message).slice(0,250));save();throw e;}finally{save();}
});
