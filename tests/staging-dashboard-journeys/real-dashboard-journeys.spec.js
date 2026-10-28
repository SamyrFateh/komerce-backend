'use strict';
/**
 * Real staging dashboard journey audit. No fixtures, no API mocks, no business writes.
 * A role without a login or a grant is BLOCKED, never PASS. Reports are persisted
 * even when a Playwright assertion fails.
 */
const fs=require('fs'),path=require('path');
const {test,expect}=require('@playwright/test');
const {pages}=require('../staging-canonical/matrix');
const {clickDiscoveredLink}=require('../staging-canonical/link-replay');
const ORIGIN='https://komerce-backend-production.up.railway.app';
const OUTPUT=path.resolve('test-results/real-dashboard-journeys');
fs.mkdirSync(OUTPUT,{recursive:true});
const short=(s,n=180)=>String(s||'').slice(0,n);
const safeUrl=(u)=>{try{const t=new URL(u,ORIGIN);return t.origin===ORIGIN?t.pathname+t.search:null;}catch{return null;}};
const statusError=(txt)=>/MARKET_MEMBERSHIP_REQUIRED|MARKET_CAPABILITY_REQUIRED|Habilitation marché requise|Aucune membership active|Catalogue indisponible|Accès refusé|Access denied|Forbidden/i.test(txt);

test('REAL staging: authenticated role, dashboard navigation and contextual product journeys', async ({page},info)=>{
  test.setTimeout(9*60*1000);
  const project=info.project.name;
  const role=project.replace(/-(desktop|mobile)$/,'');
  const mobile=project.endsWith('mobile');
  const report={role,viewport:mobile?'390x844':'1440x900',scope:'STAGING_REAL_READ_ONLY',
    expectedSha:process.env.E2E_EXPECTED_DEPLOY_SHA||null,observedSha:null,
    identity:'NOT_CHECKED',routes:[],edges:[],contextJourneys:[],blockedWrites:[],
    consoleErrors:[],apiErrors:[],findings:[],startedAt:new Date().toISOString()};
  const name=project+'.json';
  const save=()=>{report.endedAt=new Date().toISOString();fs.writeFileSync(path.join(OUTPUT,name),JSON.stringify(report,null,2)+'\n');};
  const finding=(grade,code,route,detail)=>report.findings.push({grade,code,route,detail:short(detail)});
  const capture=async(label)=>{const file=project+'-'+label.replace(/[^\w-]+/g,'_').slice(0,74)+'.jpg';
    try{await page.screenshot({path:path.join(OUTPUT,file),type:'jpeg',quality:48,fullPage:true,timeout:12000});return file;}
    catch(e){finding('P2','SCREENSHOT_FAILED',page.url(),e.message);return null;}};
  const goto=async(route,label)=>{
    let response=null;
    try{
      response=await page.goto(ORIGIN+route,{waitUntil:'domcontentloaded',timeout:20000});
      await page.waitForTimeout(550);
      const snap=await page.evaluate(()=>{
        const all=[...document.querySelectorAll('a[href]')].filter(a=>{
          const b=a.getBoundingClientRect();return b.width>0&&b.height>0;});
        const buttons=[...document.querySelectorAll('button')].filter(b=>b.getBoundingClientRect().width>0);
        return {h1:(document.querySelector('h1')?.textContent||'').trim().slice(0,130),
          text:document.body.innerText.slice(0,900),size:document.body.innerText.length,
          overflow:document.documentElement.scrollWidth-innerWidth,
          links:all.map(a=>({href:a.getAttribute('href'),text:String(a.textContent||'').slice(0,75)}))
            .filter(a=>a.href).slice(0,45),
          buttons:buttons.map(b=>String(b.innerText||b.getAttribute('aria-label')||'').slice(0,70)).filter(Boolean).slice(0,35)};
      });
      const actual=safeUrl(page.url());
      const blocked=statusError(snap.text);
      const http=response?.status()||0;
      const intendedPath=new URL(ORIGIN+route).pathname;
      const reachedPath=actual?new URL(actual,ORIGIN).pathname:null;
      const wrongDestination=Boolean(reachedPath&&reachedPath!==intendedPath);
      const kind=wrongDestination?'FAIL':http>=400||blocked?'BLOCKED':(http===200&&snap.size>30?'OBSERVED':'FAIL');
      const screenshot=await capture(label);
      report.routes.push({route,actual,http,kind,heading:snap.h1,
        overflow:snap.overflow,bodyLength:snap.size,screenshot,buttons:snap.buttons,links:snap.links});
      if(wrongDestination)finding('P1','WRONG_DASHBOARD_DESTINATION',route,
        'expected='+intendedPath+' actual='+reachedPath+' HTTP='+http+' heading='+snap.h1);
      else if(kind==='FAIL')finding('P1','ROUTE_INVALID',route,'HTTP='+http+' size='+snap.size+' heading='+snap.h1);
      if(kind==='BLOCKED')finding('BLOCKED','ACCESS_OR_RENDER_BLOCK',route,'HTTP='+http+' '+snap.h1+' '+short(snap.text,125));
      if(mobile&&snap.overflow>8)finding('P2','HORIZONTAL_OVERFLOW',route,snap.overflow+'px');
      return {snapshot:snap,kind};
    }catch(error){
      const screenshot=await capture(label+'-exception');
      report.routes.push({route,kind:'FAIL',error:short(error.message),screenshot});
      finding('P1','ROUTE_EXCEPTION',route,error.message);
      return null;
    }finally{save();}
  };
  try{
    // Global write barrier stays active through authentication and all links.
    await page.route('**/*',route=>{
      const req=route.request(),url=new URL(req.url());
      if(url.origin!==ORIGIN)return route.continue();
      if(['GET','HEAD','OPTIONS'].includes(req.method())||
        (req.method()==='POST'&&url.pathname==='/api/auth/login'))return route.continue();
      report.blockedWrites.push({method:req.method(),path:url.pathname});
      return route.abort('blockedbyclient');
    });
    page.on('pageerror',e=>report.consoleErrors.push({at:safeUrl(page.url()),message:short(e.message)}));
    page.on('response',r=>{if(r.url().startsWith(ORIGIN+'/api/')&&r.status()>=500)
      report.apiErrors.push({at:safeUrl(page.url()),path:safeUrl(r.url()),status:r.status()});});
    const version=await page.request.get(ORIGIN+'/health/version',{timeout:15000});
    const versionData=version.ok()?await version.json().catch(()=>({})):{};
    report.observedSha=versionData.commit||versionData.sha||null;
    if(!version.ok()||!report.observedSha)finding('P0','DEPLOY_SHA_UNVERIFIED','/health/version',version.status());
    if(report.expectedSha&&!String(report.observedSha||'').startsWith(report.expectedSha.slice(0,8)))
      finding('P0','DEPLOY_SHA_DRIFT','/health/version',report.observedSha+' != '+report.expectedSha);
    const prefix='E2E_'+role.toUpperCase()+'_';
    const email=process.env[prefix+'EMAIL'], password=process.env[prefix+'PASSWORD'];
    if(!email||!password){report.identity='BLOCKED_MISSING_SECRET';finding('BLOCKED','IDENTITY_NOT_CONFIGURED',role,prefix+'EMAIL or PASSWORD absent');save();return;}
    await page.goto(ORIGIN+'/login.html?next='+encodeURIComponent(pages[role]?.[0]||'/admin'),{waitUntil:'domcontentloaded'});
    await page.locator('#email').fill(email);
    await page.locator('#password').fill(password);
    const loginWait=page.waitForResponse(r=>r.url().startsWith(ORIGIN+'/api/auth/login')&&r.request().method()==='POST',{timeout:20000}).catch(()=>null);
    await page.locator('#btn-submit').click();
    const auth=await loginWait;
    if(!auth||!auth.ok()){report.identity='BLOCKED_AUTH_'+(auth?.status()||'NO_RESPONSE');finding('BLOCKED','LOGIN_REJECTED',role,report.identity);await capture('login-rejected');save();return;}
    await page.waitForURL(u=>u.pathname!=='/login.html',{timeout:15000}).catch(()=>{});
    if(new URL(page.url()).pathname==='/login.html'){report.identity='BLOCKED_REDIRECT';finding('BLOCKED','LOGIN_REDIRECT_FAILED',role,'Login 2xx, redirect not completed');save();return;}
    report.identity='AUTHENTICATED';
    // Measure role/session context; don't infer permissions from a successful login.
    const profileResponse=await page.request.get(ORIGIN+'/api/auth/me').catch(()=>null);
    const profileData=profileResponse?.ok()?await profileResponse.json().catch(()=>({})):{};
    const adminContextResponse=await page.request.get(ORIGIN+'/api/admin/dashboard/context').catch(()=>null);
    report.identityAuthority={actualRole:profileData.role||null,
      profileStatus:profileResponse?.status()||null,
      dashboardContextStatus:adminContextResponse?.status()||null};
    const checkPaths=[...new Set(pages[role]||[])];
    if(role==='admin')checkPaths.push('/admin/workspaces/catalog?view=refinery','/dashboards/canonical/market-catalog.html?product_ref=KPR-000092');
    if(role==='market_operator')checkPaths.push('/dashboards/canonical/market-catalog.html?product_ref=KPR-000092');
    let count=0;
    for(const route of checkPaths){
      const obs=await goto(route,'route-'+(++count));
      if(!obs||obs.kind!=='OBSERVED')continue;
      const candidates=obs.snapshot.links
        .filter(a=>a.href && !/logout|déconnexion|remove|delete|danger|supprimer/i.test(a.text+' '+a.href))
        .filter(a=>{const url=safeUrl(a.href);return url&&(url.startsWith('/admin/')||url.startsWith('/dashboards/canonical/'));})
        .slice(0,role==='admin'?2:1);
      for(const link of candidates){
        try{
          const clicked=await clickDiscoveredLink(page,{href:link.href,sourcePath:new URL(ORIGIN+route).pathname,
            pathname:u=>{try{return new URL(u).pathname}catch{return null}},reappearTimeout:3000,clickTimeout:4000});
          report.edges.push({from:route,target:safeUrl(link.href),label:link.text,kind:clicked.kind,
            landed:safeUrl(page.url())});
          if(clicked.kind==='CLICK_FAILED_ON_VISIBLE_LINK')finding('P1','CLICK_FAILURE',route,link.text);
        }catch(e){finding('P2','CLICK_EXCEPTION',route,e.message);}
        await page.goto(ORIGIN+route,{waitUntil:'domcontentloaded',timeout:16000}).catch(()=>{});
      }
      save();
    }
    // Concrete cross-dashboard continuity: global product to market decision.
    if(role==='admin'){
      await page.goto(ORIGIN+'/admin/workspaces/catalog',{waitUntil:'domcontentloaded'});
      await page.waitForTimeout(1100);
      const candidates=page.locator('a[href*="market-catalog.html"][href*="product_ref="]');
      const count=await candidates.count();
      if(count){
        const href=await candidates.first().getAttribute('href');
        await candidates.first().click({timeout:7000});
        const landed=safeUrl(page.url());
        const ref=new URL(href,ORIGIN).searchParams.get('product_ref');
        // Context cards are loaded asynchronously after navigation.
        // A snapshot of the initial spinner is NOT proof of a lost product.
        const focused=page.locator('[data-market-handoff="choose"],[data-market-handoff="selected"]');
        await focused.first().waitFor({state:'visible',timeout:13000}).catch(()=>{});
        const cardText=await focused.first().innerText().catch(()=>'');
        const actualRef=await focused.first().locator('h2').first().innerText().catch(()=>'');
        const retained=Boolean(landed?.includes('product_ref='+ref)&&
          cardText.includes(ref)&&actualRef.includes(ref));
        report.contextJourneys.push({journey:'CATALOG_GLOBAL_TO_MARKET',ref,landed,
          status:retained?'OBSERVED':'FAIL',actualRef,
          screenshot:await capture('catalog-to-market-settled')});
        if(!retained)finding('P0','LOST_PRODUCT_CONTEXT_AFTER_SETTLE','Catalogue→Marchés',
          'ref='+ref+' heading='+short(actualRef)+' landed='+landed);
      }else{
        report.contextJourneys.push({journey:'CATALOG_GLOBAL_TO_MARKET',status:'NOT_PROVEN',reason:'No actionable link in live catalog'});
      }
      // Editorial modal: test open/close only, never save.
      await page.goto(ORIGIN+'/admin/workspaces/catalog?view=refinery',{waitUntil:'domcontentloaded'});
      await page.waitForTimeout(1100);
      const trigger=page.getByRole('button',{name:/corriger la fiche FR/i}).first();
      if(await trigger.count()){
        try{
          await trigger.click({timeout:6500});
          const dialog=page.locator('.kmc-catalog-fr-editor');
          await dialog.waitFor({state:'visible',timeout:8000});
          const ref=await dialog.locator('h2').allTextContents().catch(()=>[]);
          report.contextJourneys.push({journey:'REFINERY_FR_EDITOR',status:'OBSERVED',ref,
            screenshot:await capture('refinery-editor')});
        }catch(e){finding('P1','REFINERY_EDITOR_FAILED','Raffinerie',e.message);}
      }else report.contextJourneys.push({journey:'REFINERY_FR_EDITOR',status:'NOT_PROVEN',reason:'No correction action in real queue'});
    }
    for(const err of report.consoleErrors)finding('P1','JS_EXCEPTION',err.at,err.message);
    for(const err of report.apiErrors)finding('P1','API_5XX',err.path,err.status);
    const endVersion=await page.request.get(ORIGIN+'/health/version').then(r=>r.json()).catch(()=>({}));
    report.finalSha=endVersion.commit||endVersion.sha||null;
    if(report.finalSha!==report.observedSha)finding('P0','SHA_CHANGED_DURING_AUDIT','/health/version',report.observedSha+' → '+report.finalSha);
  }catch(e){finding('P0','AUDIT_HARNESS_EXCEPTION',role,e.message);}
  finally{save();}
  const defects=report.findings.filter(f=>/^P[012]$/.test(f.grade));
  expect(defects,'Real staging defects; see artifact '+name).toEqual([]);
});
