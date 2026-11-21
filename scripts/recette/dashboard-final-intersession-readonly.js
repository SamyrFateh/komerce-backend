'use strict';
/**
 * @komerce-arch-lite
 * @role staging-dashboard-final-intersession-probe
 * @domain dashboard
 * @layer e2e
 * @owner backend-core
 * @purpose Real Chromium x 2 + READ ONLY PG NOTIFY transaction; no business writes.
 * @impact-areas dashboard, hub, permissions, staging-only
 */
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('@playwright/test');
const {Client}=require('pg');
const assert=require('node:assert/strict');

const BASE='https://komerce-backend-production.up.railway.app';
const OUT=path.resolve('test-results/dashboard-final/dashboard-intersession-proof.json');
const CHANNEL='komerce_dashboard_refresh';
const TARGET_ROLES=[
  ['admin','E2E_ADMIN_'],
  ['hub_director','E2E_HUB_DIRECTOR_'],
  ['market_KM','E2E_MARKET_OPERATOR_KM_'],
  ['market_CM','E2E_MARKET_OPERATOR_CM_'],
  ['market_CG','E2E_MARKET_OPERATOR_CG_'],
  ['relay','E2E_AGENT_RELAIS_'],
];
const proof={status:'NOT_PROVEN',target:'staging',read_only_business:true,
  sha:null,sha_pinned:false,roles:{},director:{},notifications:{},
  events:[],http_429:0,blocked_browser_writes:0,oracle:{pg_read_only:true},
  samples_ms:[],browser_errors:0,reason:null};
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function save(){
 // The independent PG oracle uses PO ids in memory only; never publish them.
 for(const detail of Object.values(proof.director))if(detail&&typeof detail==='object')delete detail.poIds;
 fs.mkdirSync(path.dirname(OUT),{recursive:true});
 fs.writeFileSync(OUT,JSON.stringify(proof,null,2)+'\n');
}
function pinDatabase(url,pin){
 if(!url||!pin)throw Error('STAGING_DB_OR_PIN_MISSING');
 const parsed=new URL(url);
 const observed=parsed.hostname+':'+(parsed.port||'5432')+parsed.pathname;
 if(pin!==observed)throw Error('STAGING_DB_PIN_MISMATCH');
}
async function version(request){
 const r=await request.get(BASE+'/health/version',{timeout:15000});
 assert.equal(r.status(),200,'STAGING_VERSION_HTTP');
 const data=await r.json();
 return String(data.commit||data.sha||'');
}
async function login(browser,role,prefix){
 const email=process.env[prefix+'EMAIL'],password=process.env[prefix+'PASSWORD'];
 if(!email||!password)throw Error('MISSING_SECRET_FOR_'+role);
 const context=await browser.newContext({baseURL:BASE,viewport:{width:1440,height:900}});
 const page=await context.newPage();
 const stats={role,apiReads:0,sseReqs:0,api429:0,blocked:0,errors:0};
 await context.addInitScript(()=>{
   const Native=window.EventSource;
   window.__freshProof={events:0,opens:0,lastAt:null};
   window.EventSource=class extends Native{
     constructor(url,opts){
       super(url,opts);
       if(String(url).includes('/api/admin/dashboard/events')){
         window.__freshProof.opens++;
         this.addEventListener('refresh',()=>{
           window.__freshProof.events++;
           window.__freshProof.lastAt=Date.now();
         });
       }
     }
   };
 });
 page.on('pageerror',()=>{stats.errors++;proof.browser_errors++;});
 page.on('response',res=>{
   const url=new URL(res.url());
   if(url.origin!==BASE)return;
   if(res.status()===429){stats.api429++;proof.http_429++;}
   if(url.pathname==='/api/hub/director-todo'&&res.request().method()==='GET'&&res.status()===200)
     stats.apiReads++;
 });
 await page.route('**/*',route=>{
   const req=route.request(),url=new URL(req.url());
   if(url.origin!==BASE||['GET','HEAD','OPTIONS'].includes(req.method())||
     (req.method()==='POST'&&url.pathname==='/api/auth/login'))return route.continue();
   stats.blocked++;proof.blocked_browser_writes++;
   return route.abort('blockedbyclient');
 });
 await page.goto('/login.html?next='+encodeURIComponent('/admin/hub?branch=direction'),{waitUntil:'domcontentloaded'});
 await page.locator('#email').fill(email);
 await page.locator('#password').fill(password);
 const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/auth/login'&&r.request().method()==='POST',{timeout:25000});
 await page.locator('#btn-submit').click();
 assert.equal((await response).status(),200,'LOGIN_FAILED_'+role);
 await page.waitForURL(u=>u.pathname!=='/login.html',{timeout:20000});
 const me=await page.request.get('/api/auth/me');
 assert.equal(me.status(),200,'AUTH_ME_'+role);
 const meData=await me.json();
 const expected=role.startsWith('market')?'market_operator':
   role==='relay'?'agent_relais':role==='admin'?'admin':'agent_hub';
 assert.equal(meData.role,expected,'ROLE_MISMATCH_'+role);
 proof.roles[role]={login:true,role:expected};
 return {context,page,stats};
}
async function readDirector(who){
 await who.page.goto('/admin/hub?branch=direction',{waitUntil:'domcontentloaded'});
 await who.page.locator('[data-hub-director-group]').first().waitFor({timeout:30000});
 const groups=await who.page.locator('[data-hub-director-group]').evaluateAll(nodes=>
   Object.fromEntries(nodes.map(node=>[node.getAttribute('data-hub-director-group'),
     Number(node.querySelector('.hlc-director-group-count')?.textContent||0)])));
 assert.deepEqual(Object.keys(groups).sort(),['arbitrage','commitment','execution','payment']);
 const api=await who.page.request.get('/api/hub/director-todo');
 assert.equal(api.status(),200,'HUB_DIRECTOR_API_HTTP');
 const body=await api.json();
 assert.equal(body.scope,'ALL_MARKETS','DIRECTOR_SCOPE');
 assert.ok(Array.isArray(body.tasks),'DIRECTOR_TASKS_NOT_ARRAY');
 assert.equal(Object.values(groups).reduce((a,b)=>a+b,0),body.tasks.length,'DIRECTOR_KANBAN_COUNT_MISMATCH');
 return {groups,taskCount:body.tasks.length,poIds:[...new Set(body.tasks.map(t=>t.subject?.po_id).filter(x=>/^[a-f0-9-]{36}$/i.test(String(x))))].slice(0,12)};
}
async function pgProof(client,admin,hub){
 // READ ONLY makes business changes impossible. Only a NOTIFY hint is emitted.
 const snap=async who=>who.page.evaluate(()=>({events:window.__freshProof.events,
   lastAt:window.__freshProof.lastAt,opens:window.__freshProof.opens}));
 const a0=await snap(admin),h0=await snap(hub);
 await client.query('BEGIN READ ONLY');
 await client.query('SELECT pg_notify($1,$2)',[CHANNEL,'changed']);
 await client.query('ROLLBACK');
 await sleep(1200);
 const ar=await snap(admin),hr=await snap(hub);
 assert.equal(ar.events,a0.events,'ROLLBACK_LEAK_ADMIN');
 assert.equal(hr.events,h0.events,'ROLLBACK_LEAK_HUB');
 proof.notifications.rollback_suppressed=true;
 for(let i=0;i<3;i++){
   const a=await snap(admin),h=await snap(hub);
   const aReads=admin.stats.apiReads,hReads=hub.stats.apiReads;
   await client.query('BEGIN READ ONLY');
   await client.query('SELECT pg_notify($1,$2)',[CHANNEL,'changed']);
   await client.query('COMMIT');
   const committed=Date.now();
   await Promise.all([
     admin.page.waitForFunction(prev=>window.__freshProof.events>prev,a.events,{timeout:20000}),
     hub.page.waitForFunction(prev=>window.__freshProof.events>prev,h.events,{timeout:20000}),
   ]);
   const aa=await snap(admin),hh=await snap(hub);
   const latency=Math.max(aa.lastAt-committed,hh.lastAt-committed);
   assert.ok(latency>=0&&latency<15000,'NOTIFY_LATENCY_UNBOUNDED');
   proof.samples_ms.push(latency);
   await Promise.all([
     admin.page.waitForFunction(prev=>window.__freshProof.events>=prev,a.events+1,{timeout:5000}),
     hub.page.waitForFunction(prev=>window.__freshProof.events>=prev,h.events+1,{timeout:5000}),
   ]);
   // UI revalidation has 2s debounce and does not modify business state.
   const deadline=Date.now()+12000;
   while(Date.now()<deadline && (admin.stats.apiReads<=aReads||hub.stats.apiReads<=hReads))await sleep(150);
   assert.ok(admin.stats.apiReads>aReads,'ADMIN_CANONICAL_REFETCH_MISSING');
   assert.ok(hub.stats.apiReads>hReads,'HUB_CANONICAL_REFETCH_MISSING');
   proof.events.push({hint:i+1,admin_refetched:true,hub_refetched:true,
     latency_ms:latency});
   await sleep(2200);
 }
 proof.notifications.commit_fanout=true;
 proof.notifications.samples=proof.samples_ms.length;
 proof.notifications.p95_ms=proof.samples_ms.slice().sort((a,b)=>a-b)[Math.ceil(proof.samples_ms.length*.95)-1];
}
async function main(){
 if(process.env.E2E_STAGING_BASE_URL!==BASE)throw Error('UNTRUSTED_STAGING_ORIGIN');
 const expected=process.env.E2E_EXPECTED_DEPLOY_SHA;
 if(!/^[a-f0-9]{40}$/i.test(String(expected||'')))throw Error('EXPECTED_SHA_MISSING');
 pinDatabase(process.env.E2E_READONLY_ORACLE_DATABASE_URL,process.env.E2E_ORACLE_EXPECTED_DB_PIN);
 const browser=await chromium.launch({headless:true});
 const sessions=[];
 let pg=null;
 try{
   const request=await browser.newContext();
   const observed=await version(request.request);
   assert.equal(observed,expected,'DEPLOY_SHA_MISMATCH');
   proof.sha=observed;
   proof.sha_pinned=true;
   await request.close();
   for(const [role,prefix] of TARGET_ROLES){
     const one=await login(browser,role,prefix);
     sessions.push(one);
     if(role.startsWith('market')||role==='relay'){
       const bad=await one.page.request.get('/api/admin/dashboard/events',{timeout:10000});
       assert.equal(bad.status(),403,'SSE_MUST_DENY_'+role);
       proof.roles[role].sse_forbidden=true;
       if(role.startsWith('market')){
         const code=role.slice(-2);
         const ctx=await one.page.request.get('/api/admin/dashboard/context');
         assert.equal(ctx.status(),200);
         const data=await ctx.json();
         assert.deepEqual((data.access?.allowedMarkets||[]).slice().sort(),[code],'MARKET_SCOPE_'+code);
         proof.roles[role].scope_proven=true;
       }
     }
   }
   const admin=sessions[0],hub=sessions[1];
   proof.director.admin=await readDirector(admin);
   proof.director.hub=await readDirector(hub);
   assert.deepEqual(proof.director.admin.groups,proof.director.hub.groups,'TWO_SESSION_DIVERGENCE');
   await Promise.all([admin.page.waitForFunction(()=>window.__freshProof.events>0,{timeout:20000}),
     hub.page.waitForFunction(()=>window.__freshProof.events>0,{timeout:20000})]);
   pg=new Client({connectionString:process.env.E2E_READONLY_ORACLE_DATABASE_URL,
     connectionTimeoutMillis:15000,query_timeout:20000});
   await pg.connect();
   await pg.query('BEGIN READ ONLY');
   const ids=proof.director.admin.poIds;
   const result=await pg.query('SELECT id::text AS id FROM purchase_orders WHERE id=ANY($1::uuid[])',[ids]);
   await pg.query('ROLLBACK');
   assert.equal(result.rows.length,ids.length,'PO_READ_MODEL_PG_MISMATCH');
   proof.oracle.matched_po_ids=result.rows.length;
   await pgProof(pg,admin,hub);
   const before=admin.stats.apiReads;
   await admin.context.setOffline(true);await sleep(800);
   await admin.context.setOffline(false);
   await admin.page.evaluate(()=>window.dispatchEvent(new Event('online')));
   const deadline=Date.now()+12000;
   while(Date.now()<deadline&&admin.stats.apiReads<=before)await sleep(150);
   assert.ok(admin.stats.apiReads>before,'RECONNECT_GET_MISSING');
   proof.notifications.browser_reconnect_refetched=true;
   assert.equal(proof.http_429,0,'DASHBOARD_HTTP_429');
   assert.equal(proof.blocked_browser_writes,0,'DASHBOARD_UNEXPECTED_WRITES');
   assert.equal(proof.browser_errors,0,'DASHBOARD_BROWSER_ERROR');
   const end=await version(admin.page.request);
   assert.equal(end,expected,'STAGING_SHA_CHANGED_DURING_PROOF');
   proof.status='PASS_SYNTHETIC_NOTIFY_READONLY';
 }finally{
   if(pg){try{await pg.query('ROLLBACK');}catch(_){}await pg.end();}
   await Promise.all(sessions.map(s=>s.context.close()));
   await browser.close();
 }
}
main().catch(error=>{
 proof.status='BLOCKED_OR_FAIL';
 proof.reason=String(error?.message||error).slice(0,240);
 process.exitCode=1;
}).finally(()=>{
 save();
 console.log('[dashboard-final-readonly] '+JSON.stringify({status:proof.status,sha:proof.sha,
   roles:Object.keys(proof.roles),notifications:proof.notifications,
   p95_ms:proof.notifications.p95_ms||null,reason:proof.reason}));
});
