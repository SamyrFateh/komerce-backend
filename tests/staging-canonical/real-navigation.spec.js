/**
 * @komerce-arch-lite
 * @role live-staging-chromium-navigation-audit
 * @domain dashboard
 * @layer e2e
 * @owner backend-core
 * @purpose Parcourir les vrais écrans via Chromium, capter les anomalies et le contexte marchés sans écritures métier.
 * @impact-areas dashboard, market, staging-only
 */
'use strict';
const fs=require('fs'),path=require('path');
const {test,expect}=require('@playwright/test');
const {markets,pages,dimensions,processes}=require('./matrix');
const {expectedPath}=require('./navigation-audit-policy');
const ORIGIN=process.env.E2E_STAGING_BASE_URL||'https://komerce-backend-production.up.railway.app';
const ROOT=path.resolve('test-results/staging-chromium/evidence');
const pathname=u=>{try{const x=new URL(u,ORIGIN);return x.origin===ORIGIN?x.pathname:null;}catch{return null;}};
const internal=u=>{const p=pathname(u);return p&&(p.startsWith('/admin')||p.startsWith('/dashboards/canonical/'))&&!/\.(css|js|svg|png|pdf|jpeg|jpg)$/.test(p)?p:null;};
const short=x=>String(x||'').slice(0,170);
test('real staging: full navigation, market context and browser errors',async({page},info)=>{
 fs.mkdirSync(ROOT,{recursive:true});
 const role=info.project.name.replace(/-(mobile|desktop)$/,'');
 const mobile=info.project.name.endsWith('-mobile');
 const result={target:ORIGIN,role,viewport:mobile?'390x844':'1440x900',version:null,
  markets,dimensions,processes,context:null,routes:[],edges:[],marketViews:[],
  blockedWrites:[],apiErrors:[],jsErrors:[],canonicalRedirects:[],findings:[]};
 const fail=(severity,code,detail)=>result.findings.push({severity,code,detail:short(detail)});
 const file=path.join(ROOT,info.project.name+'.json');
 const save=()=>fs.writeFileSync(file,JSON.stringify(result,null,2));
 try{
   await page.route('**/*',route=>{
     const r=route.request(),url=new URL(r.url());
     if(url.origin!==ORIGIN)return route.continue();
     if(['GET','HEAD','OPTIONS'].includes(r.method())||
       (r.method()==='POST'&&url.pathname==='/api/auth/login'))return route.continue();
     result.blockedWrites.push({method:r.method(),path:url.pathname});
     return route.abort('blockedbyclient');
   });
   page.on('pageerror',e=>result.jsErrors.push({at:pathname(page.url()),message:short(e.message)}));
   page.on('response',r=>{
     const p=pathname(r.url());
     if(p&&p.startsWith('/api/')&&r.status()>=400){
       result.apiErrors.push({at:pathname(page.url()),api:p,status:r.status()});
     }
   });
   const version=await page.request.get('/health/version',{timeout:20000});
   const body=version.ok()?await version.json().catch(()=>({})):{};
   result.version=body.commit||body.sha||null;
   if(!version.ok()||!result.version||result.version==='local')fail('P0','VERSION_UNVERIFIED',version.status());
   const expected=process.env.E2E_EXPECTED_DEPLOY_SHA;
   if(expected&&(!result.version||!result.version.startsWith(expected.slice(0,8))))
     fail('P0','DEPLOY_SHA_MISMATCH','actual='+short(result.version)+' expected='+expected.slice(0,12));
   const prefix='E2E_'+role.toUpperCase()+'_';
   const email=process.env[prefix+'EMAIL'],password=process.env[prefix+'PASSWORD'];
   if(!email||!password){
     fail('P0','MISSING_STAGING_TEST_IDENTITY',role);
     save();throw Error('Identity for '+role+' missing: never green on skipped E2E');
   }
   await page.goto('/login.html?next='+encodeURIComponent(pages[role][0]),{waitUntil:'domcontentloaded'});
   await page.locator('#email').fill(email);
   await page.locator('#password').fill(password);
   // Observe the authentication HTTP status, never response credentials or the password.
   // Distinguish rejected credentials from a broken login form/redirect.
   const loginResponsePromise=page.waitForResponse(
     response=>pathname(response.url())==='/api/auth/login' && response.request().method()==='POST',
     {timeout:20000}
   ).catch(()=>null);
   await page.locator('#btn-submit').click();
   const loginResponse=await loginResponsePromise;
   result.loginHttpStatus=loginResponse?loginResponse.status():null;
   if(!loginResponse){
     fail('P0','LOGIN_REQUEST_NOT_OBSERVED',role);
     save();throw Error('Login request missing '+role);
   }
   if(!loginResponse.ok()){
     const errorBody=await loginResponse.json().catch(()=>({}));
     result.loginErrorCode=typeof errorBody.code==='string'?short(errorBody.code):null;
     fail('P0','LOGIN_HTTP_REJECTED',role+' HTTP '+loginResponse.status()+(result.loginErrorCode?' '+result.loginErrorCode:''));
     save();throw Error('Live login rejected '+role+' HTTP '+loginResponse.status());
   }
   try{await page.waitForURL(u=>u.pathname!=='/login.html',{timeout:15000});}
   catch{fail('P0','LOGIN_REDIRECT_NOT_COMPLETED',role);}
   if(pathname(page.url())==='/login.html'){save();throw Error('Live login redirection failed '+role);}
   const ctxResp=await page.request.get('/api/admin/dashboard/context');
   result.contextStatus=ctxResp.status();
   const ctx=ctxResp.ok()?await ctxResp.json().catch(()=>({})):{};
   result.context={role:ctx.actor?.role||null,mode:ctx.access?.mode||null,
     allowedMarkets:ctx.access?.allowedMarkets||[]};
   if(!ctxResp.ok())fail('P1','CONTEXT_API',ctxResp.status());
   if(ctx.actor?.role&&ctx.actor.role!==role)fail('P0','ROLE_MISMATCH',ctx.actor.role+' != '+role);
   if(role==='market_operator'&&!result.context.allowedMarkets.length)
     fail('P0','MARKET_MEMBERSHIP_MISSING','empty markets from server');

   // Declared destinations PLUS links discovered from the real rendered DOM.
   const queue=[...pages[role]],seen=new Set(),limit=110;
   let edgeClicks=0;
   while(queue.length&&seen.size<limit){
     const route=queue.shift();
     if(seen.has(route))continue;
     seen.add(route);
     try{
       const response=await page.goto(ORIGIN+route,{waitUntil:'domcontentloaded',timeout:20000});
       await page.waitForTimeout(380);
       const data=await page.evaluate(()=>{
         const links=[...document.querySelectorAll('a[href]')].filter(a=>{
           const b=a.getBoundingClientRect();return b.width>0&&b.height>0&&getComputedStyle(a).visibility!=='hidden';
         }).map(a=>({href:a.getAttribute('href'),text:(a.textContent||a.getAttribute('aria-label')||'').trim().slice(0,80)}));
         return {surface:document.body.dataset.kmcSurface||null,title:document.title,
           header:document.querySelector('h1')?.textContent?.trim().slice(0,100)||null,
           overflow:document.documentElement.scrollWidth-innerWidth,
           contentLength:document.body.innerText.trim().length,
           n1:document.querySelectorAll('.kmc-admin-primary-link').length,
           n2:document.querySelectorAll('.kmc-admin-secondary-link').length,
           n3:document.querySelectorAll('[role=tab],.kmc-local-tab').length,links};
       });
       const actual=pathname(page.url());
       const capture=info.project.name+'-'+String(seen.size).padStart(3,'0')+'.jpg';
       try{await page.screenshot({path:path.join(ROOT,capture),type:'jpeg',quality:60,fullPage:true,timeout:9000});}
       catch(e){fail('P2','SCREENSHOT_FAILED',route+': '+e.message);}
       result.routes.push({expected:route,actual,http:response?.status(),capture,
         surface:data.surface,header:data.header,title:data.title,overflow:data.overflow,
         n1:data.n1,n2:data.n2,n3:data.n3,links:data.links.length});
       if(response?.status()!==200)fail('P1','PAGE_HTTP',route+' '+response?.status());
       if(actual!==route){
         const expected=expectedPath(route,ORIGIN);
         if(actual===expected)result.canonicalRedirects.push({source:route,destination:actual,kind:'canonical_alias'});
         else fail('P1','WRONG_ROUTE',route+' => '+actual);
       }
       if(data.contentLength<25)fail('P1','EMPTY_SCREEN',route);
       if(data.surface==='pilotage'&&!['/admin','/admin/pilotage'].includes(route))
         fail('P1','UNEXPECTED_PILOTAGE',route);
       if(mobile&&data.overflow>8)fail('P2','HORIZONTAL_OVERFLOW',route+' '+data.overflow+'px');
       for(const link of data.links){
         const dest=internal(link.href);
         if(!dest)continue;
         result.edges.push({source:route,destination:dest,label:link.text,kind:'discovered'});
         if(!seen.has(dest)&&!queue.includes(dest))queue.push(dest);
         if(edgeClicks>=170||dest===route)continue;
         edgeClicks++;
         try{
           await page.locator('a[href='+JSON.stringify(link.href)+']').first().click({timeout:5000});
           await page.waitForTimeout(160);
           const got=pathname(page.url());
           result.edges.push({source:route,destination:got,expected:dest,kind:'clicked'});
           if(got!==dest){
             const expected=expectedPath(link.href,ORIGIN);
             if(got===expected)result.canonicalRedirects.push({source:route,destination:got,via:dest,kind:'clicked_alias'});
             else fail('P2','CLICK_WRONG_DESTINATION',route+' -> '+dest+' != '+got);
           }
         }catch(e){fail('P2','CLICK_UNAVAILABLE',route+' -> '+dest+': '+short(e.message));}
         await page.goto(ORIGIN+route,{waitUntil:'domcontentloaded'});
         await page.waitForTimeout(130);
       }
     }catch(e){fail('P1','ROUTE_EXCEPTION',route+': '+short(e.message));result.routes.push({expected:route,error:short(e.message)});}
     save();
   }
   if(queue.length)fail('P1','UNVISITED_ROUTES','pending='+queue.length);
   if(!result.edges.some(e=>e.kind==='clicked'))fail('P1','NO_REAL_NAVIGATION_CLICKS',role);

   // Per-country overview is a read-only observation, not proof of price/checkout mutations.
   if(['admin','market_operator'].includes(role)){
     for(const market of markets){
       for(const surface of ['/admin/pilotage','/admin/commerce','/admin/orders','/admin/operations','/admin/finance']){
         const route=surface+'?market='+market+'&period=30';
         try{
           const r=await page.goto(ORIGIN+route,{waitUntil:'domcontentloaded'});
           await page.waitForTimeout(420);
           const readable=(await page.locator('body').innerText()).trim().length>40;
           result.marketViews.push({market,surface,status:r?.status(),actual:pathname(page.url()),readable});
           if(r?.status()!==200||!readable||pathname(page.url())!==surface)
             fail('P1','MARKET_OVERVIEW',market+' '+surface);
         }catch(e){fail('P1','MARKET_OVERVIEW_EXCEPTION',market+' '+surface+': '+short(e.message));}
       }
     }
   }
   if(role==='market_operator'){
     // Server guard: disallowed market must NEVER return full dashboard data.
     const unauthorized=markets.filter(m=>!result.context.allowedMarkets.includes(m));
     for(const market of unauthorized){
       const r=await page.request.get('/api/admin/dashboard/unified/market/'+market);
       result.marketViews.push({market,surface:'API unauthorized',status:r.status()});
       if(r.ok())fail('P0','CROSS_MARKET_DATA_LEAK','market='+market+' GET /unified/market/'+market);
     }
   }
   for(const e of result.apiErrors.filter(x=>x.status>=500))fail('P1','API_5XX',e.api+' '+e.status);
   for(const e of result.jsErrors)fail('P1','JS_EXCEPTION',e.at+': '+e.message);
   for(const e of result.blockedWrites)fail('P2','READ_ONLY_GUARD_TRIGGERED',e.method+' '+e.path);
   save();
   expect(result.findings,'NO GO. Read evidence '+info.project.name+'.json').toEqual([]);
 }finally{save();}
});
