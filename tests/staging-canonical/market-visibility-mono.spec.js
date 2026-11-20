/**
 * @komerce-arch-lite
 * @role chromium-staging-market-visibility-single-market-proof
 * @domain dashboard
 * @layer e2e
 * @owner backend-core
 * @purpose Re-certify Responsable Marché isolation with one account per market.
 * @impact-areas dashboard, market-authorization, staging-only
 * @test-kind e2e @test-runner playwright @test-requires staging
 */
'use strict';

const fs=require('fs'),path=require('path');
const {Client}=require('pg');
const {test,expect}=require('@playwright/test');
const BASE='https://komerce-backend-production.up.railway.app';
const OUT=path.resolve('test-results/staging-chromium/evidence');
const MARKETS=['KM','CM','CG'];
const CODES=['KM','CM','CG','DJ','YT'];
const ORIGIN=new URL(process.env.E2E_STAGING_BASE_URL||BASE).origin;
const MENU=[
 'control-tower','action-center','flow-commerce','flow-orders','entity-clients',
 'workspace-pricing','workspace-catalog','flow-operations','workspace-shipping',
 'workspace-purchasing','flow-finance','workspace-accounting','live-import-runtime',
 'live-hub','live-relais','markets-home','market-autonomy','market-catalog','unsold',
 'admin-users','admin-providers','settings','help-docs'
];
const MUTATION_LABEL=/\b(enregistrer|valider|annuler|créer|confirmer|recevoir|rattacher|payer|expédier|modifier|supprimer|encaisser|remettre|abandonner)\b/i;
const apiPath=url=>{try{return new URL(url).pathname;}catch{return '';}};
const account=(market)=>({
 email:process.env[`E2E_MARKET_OPERATOR_${market}_EMAIL`],
 password:process.env[`E2E_MARKET_OPERATOR_${market}_PASSWORD`],
});

function marketOrderRefs(){
 const pairs=String(process.env.E2E_MKT_READ_ORDER_REFS||'').split(',').map(x=>x.trim()).filter(Boolean);
 const refs=Object.fromEntries(pairs.map(x=>{const i=x.indexOf(':');return i<1?['','']:[x.slice(0,i).toUpperCase(),x.slice(i+1).trim()]}));
 if(pairs.length!==MARKETS.length||Object.keys(refs).sort().join(',')!==MARKETS.slice().sort().join(',')||
   Object.values(refs).some(x=>!x)||new Set(Object.values(refs)).size!==MARKETS.length)
   throw new Error('MKT_READ_ORDER_REFS_REQUIRED_KM_CM_CG');
 return refs;
}

async function readOrderOracle(references,{activeHubMarket=null}={}){
 const connectionString=process.env.E2E_READONLY_ORACLE_DATABASE_URL;
 if(!connectionString)throw new Error('MKT_READ_READONLY_ORACLE_URL_MISSING');
 const expectedPin=String(process.env.E2E_ORACLE_EXPECTED_DB_PIN||'');
 let actualPin='';
 try{const u=new URL(connectionString);actualPin=`${u.hostname}:${u.port||'5432'}${u.pathname}`;}catch(_){throw new Error('MKT_READ_READONLY_ORACLE_URL_INVALID');}
 if(!expectedPin||actualPin!==expectedPin)throw new Error('MKT_READ_READONLY_ORACLE_TARGET_PIN_MISMATCH');
 const client=new Client({connectionString,connectionTimeoutMillis:15000,query_timeout:20000});
 await client.connect();
 try{
   await client.query('BEGIN');
   await client.query('SET TRANSACTION READ ONLY');
   const {rows}=activeHubMarket ? await client.query(`
     SELECT DISTINCT o.reference, m.code AS market,
       o.total_kmf::text AS total_kmf, o.total_eur::text AS total_eur
     FROM orders o
     JOIN markets m ON m.id=o.market_id
     JOIN order_items oi ON oi.order_id=o.id AND oi.fulfillment_source='IMPORT'
     WHERE m.code=$1 AND o.status NOT IN ('pending','cancelled','refunded','collected')
     ORDER BY o.reference`,[activeHubMarket]) : await client.query(`
     SELECT o.id::text AS order_id,o.reference,o.status AS status,m.code AS market,
       COALESCE(u.phone,r.phone) AS customer_phone,
       o.total_kmf::text AS total_kmf,o.total_eur::text AS total_eur,
       COALESCE(po.ids,'{}'::text[]) AS purchase_order_ids
     FROM orders o
     JOIN markets m ON m.id=o.market_id
     LEFT JOIN users u ON u.id=o.user_id
     LEFT JOIN recipients r ON r.id=o.recipient_id
     LEFT JOIN LATERAL (
       SELECT array_agg(DISTINCT pl.purchase_order_id::text ORDER BY pl.purchase_order_id::text)
         FILTER (WHERE pl.purchase_order_id IS NOT NULL) AS ids
       FROM order_items oi
       JOIN purchase_lines pl ON pl.order_item_id=oi.id
       WHERE oi.order_id=o.id
     ) po ON TRUE
     WHERE o.reference=ANY($1::text[])
     ORDER BY o.reference`,[references]);
   await client.query('ROLLBACK');
   return rows;
 }catch(error){try{await client.query('ROLLBACK');}catch(_){}throw error;}
 finally{await client.end();}
}

async function fetchJSON(page,url){
 if(page.url()==='about:blank'){
   const r=await page.request.get(new URL(url,ORIGIN).toString(),{timeout:20000});
   return {status:r.status(),body:await r.json().catch(()=>({}))};
 }
 return page.evaluate(async endpoint=>{
   const response=await fetch(endpoint,{method:'GET',credentials:'same-origin',redirect:'manual',
     headers:{Accept:'application/json'},signal:AbortSignal.timeout(20000)});
   return {status:response.status,body:await response.json().catch(()=>({}))};
 },url);
}

for(const market of MARKETS){
 test(`MKT-READ mono-marché ${market}: navigation, Hub et refus inter-marchés`,async({browser},info)=>{
   test.skip(info.project.name!=='market_operator-desktop','Strict market visibility uses the market operator Chromium project');
   const refs=marketOrderRefs();
   const expectedSha=String(process.env.E2E_EXPECTED_DEPLOY_SHA||'');
   const proof={market,result:'NOT_PROVEN',role:'market_operator',secret_names:[
     `E2E_MARKET_OPERATOR_${market}_EMAIL`,`E2E_MARKET_OPERATOR_${market}_PASSWORD`
   ],version:null,finalVersion:null,loginStatus:null,allowedMarkets:[],hubMarkets:[],
     hubOrderCount:null,oracle:{order_refs:[],markets:[],purchase_order_counts:[],customer_targets_present:0},
     navigation:{items:[],visited:[]},consultations:[],order360:[],foreign_order_denials:[],
     foreign_po_denials:[],foreign_client_denials:[],visible_mutation_controls:[],
     foreignDataLeaks:[],foreignMarketLeaks:[],blockedWrites:[],jsErrors:[],readOnlyOracle:true,
     apiResponseAuditComplete:false,apiResponseAuditReplayed:0};
   const save=()=>{fs.mkdirSync(OUT,{recursive:true});fs.writeFileSync(path.join(OUT,`market-visibility-${market}.json`),JSON.stringify(proof,null,2)+'\n');};
   const user=account(market);
   const ownRef=refs[market];
   const foreignRefs=MARKETS.filter(x=>x!==market).map(x=>refs[x]);
   let context;
   try{
     expect(new URL(process.env.E2E_STAGING_BASE_URL||BASE).origin).toBe(BASE);
     expect(expectedSha).toMatch(/^[a-f0-9]{40}$/);
     expect(Boolean(user.email&&user.password)).toBe(true);
     const allRefs=MARKETS.map(x=>refs[x]);
     const oracleRows=await readOrderOracle(allRefs);
     expect(oracleRows.map(x=>x.reference).sort()).toEqual(allRefs.slice().sort());
     expect(oracleRows.map(x=>x.market).sort()).toEqual(MARKETS.slice().sort());
     expect(oracleRows.every(x=>x.status==='collected'),'M01 witness orders must have completed client pickup').toBe(true);
     const oracle=Object.fromEntries(oracleRows.map(row=>[row.reference,row]));
     proof.oracle.order_refs=allRefs.slice().sort();
     proof.oracle.markets=oracleRows.map(row=>row.market).sort();
     proof.oracle.purchase_order_counts=oracleRows.map(row=>({market:row.market,count:row.purchase_order_ids.length}));
     proof.oracle.customer_targets_present=oracleRows.filter(row=>row.customer_phone).length;
     const foreignOrderRows=foreignRefs.map(ref=>oracle[ref]);
     const foreignPos=foreignOrderRows.flatMap(row=>row.purchase_order_ids.map(id=>({id,market:row.market})));
     const forbiddenMarkers=[...foreignRefs,...foreignPos.map(x=>x.id),...foreignOrderRows.map(x=>x.customer_phone)];
     expect(foreignPos.length,'Oracle PG must identify at least one foreign-market PO').toBeGreaterThan(0);
     expect(foreignOrderRows.every(row=>row.customer_phone),'Oracle PG must identify each foreign customer target').toBe(true);

     context=await browser.newContext({baseURL:process.env.E2E_STAGING_BASE_URL||BASE,viewport:{width:1440,height:900}});
     const page=await context.newPage();
     const responseAudits=[],unreadableJsonUrls=new Set(),auditErrors=[];
     const auditJsonBody=(url,body)=>{
       for(const marker of forbiddenMarkers)if(marker&&body.includes(marker)){
         proof.foreignDataLeaks.push({path:apiPath(url),kind:
           foreignRefs.includes(marker)?'order':foreignPos.some(x=>x.id===marker)?'purchase_order':'client'});
       }
       let payload;
       try{payload=JSON.parse(body);}catch(_){throw new Error('MKT_READ_JSON_AUDIT_INVALID_RESPONSE');}
       const inspect=value=>{
         if(Array.isArray(value)){for(const item of value)inspect(item);return;}
         if(!value||typeof value!=='object')return;
         for(const [key,item] of Object.entries(value)){
           if(['market','market_code','marketCode'].includes(key)&&CODES.includes(String(item).toUpperCase())&&String(item).toUpperCase()!==market){
             proof.foreignMarketLeaks.push({path:apiPath(url),market:String(item).toUpperCase()});
           }
           inspect(item);
         }
       };
       inspect(payload);
     };
     const onResponse=response=>{
       const request=response.request(),url=response.url();
       if(request.method()!=='GET'||new URL(url).origin!==BASE||!apiPath(url).startsWith('/api/'))return;
       // Handle all promise rejections synchronously: navigation may evict
       // Network.getResponseBody before Playwright can read it.
       const task=(async()=>{
         if(!String(response.headers()['content-type']||'').includes('json'))return;
         let body;
         try{body=await response.text();}
         catch(error){
           if(/No resource with given identifier found/.test(String(error?.message||error))){
             unreadableJsonUrls.add(url);
             return;
           }
           throw error;
         }
         auditJsonBody(url,body);
       })().catch(error=>{
         auditErrors.push({path:apiPath(url),code:'MKT_READ_API_RESPONSE_AUDIT_ERROR',
           message:String(error?.message||error).slice(0,120)});
       });
       responseAudits.push(task);
     };
     page.on('response',onResponse);
     await page.route('**/*',route=>{
       const request=route.request(),url=new URL(request.url());
       if(url.origin!==BASE)return route.continue();
       if(['GET','HEAD','OPTIONS'].includes(request.method())||
          (request.method()==='POST'&&url.pathname==='/api/auth/login'))return route.continue();
       proof.blockedWrites.push(request.method()+' '+url.pathname);
       return route.abort('blockedbyclient');
     });
     page.on('pageerror',error=>proof.jsErrors.push(String(error.message).slice(0,180)));

     const start=await fetchJSON(page,'/health/version');
     expect(start.status).toBe(200);
     proof.version=start.body.commit||start.body.sha;
     expect(proof.version).toBe(expectedSha);
     await page.goto('/login.html?next='+encodeURIComponent('/admin/hub'),{waitUntil:'domcontentloaded'});
     await page.locator('#email').fill(user.email);
     await page.locator('#password').fill(user.password);
     const loginResponse=page.waitForResponse(r=>apiPath(r.url())==='/api/auth/login'&&r.request().method()==='POST',{timeout:20000});
     await page.locator('#btn-submit').click();
     const login=await loginResponse;proof.loginStatus=login.status();
     expect(login.status(),'Login HTTP 429/5xx is never PASS').toBe(200);
     await page.waitForURL(url=>url.pathname!=='/login.html',{timeout:18000});
     const ctx=await fetchJSON(page,'/api/admin/dashboard/context');
     expect(ctx.status).toBe(200);
     expect(ctx.body.actor?.role).toBe('market_operator');
     expect(ctx.body.access?.mode).toBe('market');
     proof.allowedMarkets=(ctx.body.access?.allowedMarkets||[]).slice().sort();
     expect(proof.allowedMarkets).toEqual([market]);

     const board=await fetchJSON(page,'/api/hub/board');
     expect(board.status).toBe(200);
     expect(board.body.scope).toBe('HUB_GLOBAL');
     expect(board.body.audience).toBe('MARKET_SCOPED');
     expect(Array.isArray(board.body.markets)).toBe(true);
     expect(Array.isArray(board.body.orders)).toBe(true);
     proof.hubMarkets=board.body.markets.slice().sort();
     proof.hubOrderCount=board.body.orders.length;
     expect(proof.hubMarkets).toEqual([market]);
     expect(board.body.orders.every(row=>row.market===market)).toBe(true);
     const boardRefs=board.body.orders.map(row=>row.reference);
     // The Hub board is an ACTIVE IMPORT dossier: completed M01 orders
     // are historical witnesses for Order 360, never expected in this queue.
     // Verify the entire active projection against the independent PG oracle,
     // including the legitimate zero-active-order case for one market.
     const activeOracle=await readOrderOracle([],{activeHubMarket:market});
     const activeRefs=activeOracle.map(row=>row.reference).sort();
     expect(boardRefs.slice().sort(),'Hub board must match all active IMPORT orders for its one market').toEqual(activeRefs);
     expect(activeOracle.every(row=>row.market===market)).toBe(true);
     const boardOracle=await readOrderOracle(boardRefs);
     expect(boardOracle.length).toBe(boardRefs.length);
     expect(boardOracle.every(row=>row.market===market)).toBe(true);
     expect(boardRefs,'Collected M01 order must not reappear as active Hub work').not.toContain(ownRef);
     // Count and amount aggregates are independently recalculated from the exact
     // PG rows represented in the Hub projection; no other market may contribute.
     proof.oracle.hub={count:boardOracle.length,market_codes:boardOracle.length?[...new Set(boardOracle.map(row=>row.market))].sort():[market],
       active_match:true,active_refs:activeRefs,board_refs:boardRefs.slice().sort(),
       total_kmf:boardOracle.reduce((sum,row)=>sum+Number(row.total_kmf||0),0),
       total_eur:boardOracle.reduce((sum,row)=>sum+Number(row.total_eur||0),0)};
     expect(proof.oracle.hub.count).toBe(board.body.orders.length);
     expect(proof.oracle.hub.market_codes).toEqual([market]);

     await page.goto('/admin/hub',{waitUntil:'domcontentloaded'});
     await expect(page.locator('.kmc-hub-app-title h1')).toHaveText('Hub · Mes marchés',{timeout:20000});
     const menu=await page.locator('.kmc-admin-primary-link[data-dashboard]').evaluateAll(nodes=>nodes.map(node=>({
       id:node.getAttribute('data-dashboard'),href:node.getAttribute('href')
     })));
     proof.navigation.items=menu.map(item=>item.id);
     expect(proof.navigation.items).toEqual(MENU);
     expect(new Set(menu.map(item=>item.href)).size,'23 menu rubriques must resolve to the 18 canonical market destinations').toBe(18);
     for(const item of menu)expect(String(item.href||'').startsWith('/')).toBe(true);
     const forbiddenCentral=['/admin/workspaces/catalog','/admin/workspaces/purchasing','/admin/import-runtime',
       '/admin/relais-live','/admin/users','/admin/providers','/admin/settings'];
     for(const item of menu)expect(forbiddenCentral).not.toContain(item.href);
     for(const href of [...new Set(menu.map(item=>item.href))]){
       const probe=await fetchJSON(page,href);
       const navigation=await page.goto(href,{waitUntil:'domcontentloaded'});
       const status=navigation?.status()||probe.status;
       proof.navigation.visited.push({href,http:status,path:new URL(page.url()).pathname});
       expect(status,'Menu destination must be HTTP 200: '+href).toBe(200);
       expect(new URL(page.url()).pathname).not.toBe('/login.html');
       const controls=await page.locator('button,[role="button"],form').evaluateAll(nodes=>nodes
         .filter(node=>{const s=getComputedStyle(node),r=node.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0;})
         .map(node=>({tag:node.tagName,label:(node.innerText||node.getAttribute('aria-label')||'').trim().slice(0,100),
           action:Boolean(node.getAttribute('data-action')||node.getAttribute('data-write'))})));
       for(const control of controls)if(control.action||MUTATION_LABEL.test(control.label))proof.visible_mutation_controls.push({href,...control});
     }
     expect(proof.visible_mutation_controls,'No mutation control may be visible').toEqual([]);
     await page.goto('/admin/hub',{waitUntil:'domcontentloaded'});
     await expect(page.locator('[data-hub-global-order]')).toHaveCount(board.body.orders.length,{timeout:20000});

     const consultations=[
       {cap:'client.read',suffix:'/client-cases/disputes',key:'disputes'},
       {cap:'catalog.read',suffix:'/local-offer/services',key:'services'},
       {cap:'catalog.read',suffix:'/local-offer/physical-offers',key:'physical_offers'},
       {cap:'network.read',suffix:'/network/providers',key:'providers'},
     ];
     const caps=ctx.body.access?.delegatedCapabilities?.[market]||[];
     for(const item of consultations){
       if(!caps.includes(item.cap))continue;
       const res=await fetchJSON(page,'/api/market-delegation/markets/'+market+item.suffix);
       proof.consultations.push({capability:item.cap,path:item.suffix,http:res.status,market:res.body.market?.code,
         collection:Array.isArray(res.body[item.key])});
       expect(res.status).toBe(200);
       expect(res.body.market?.code).toBe(market);
       expect(Array.isArray(res.body[item.key])).toBe(true);
     }
     expect(proof.consultations.length,'At least one real delegated consultation is required').toBeGreaterThan(0);

     const own=await fetchJSON(page,'/api/admin/entities/orders/'+encodeURIComponent(ownRef));
     expect(own.status).toBe(200);
     expect(own.body.order?.market?.code).toBe(market);
     expect(own.body.purchasing?.read_only).toBe(true);
     expect(Array.isArray(own.body.purchasing?.purchase_orders)).toBe(true);
     expect(own.body.purchasing.purchase_orders.every(po=>!('supplier_order_id'in po)&&!('procurement_hub_ref'in po))).toBe(true);
     proof.order360.push({market,status:own.status,readOnly:own.body.purchasing.read_only,poCount:own.body.purchasing.purchase_orders.length});

     for(const ref of foreignRefs){
       const denied=await fetchJSON(page,'/api/admin/entities/orders/'+encodeURIComponent(ref));
       const bodyText=JSON.stringify(denied.body);
       proof.foreign_order_denials.push({status:denied.status});
       expect([403,404,409]).toContain(denied.status);
       expect(bodyText).not.toContain(ref);
       expect(bodyText).not.toContain(oracle[ref].customer_phone);
       for(const poId of oracle[ref].purchase_order_ids){
         const po=await fetchJSON(page,'/api/purchasing/po/'+encodeURIComponent(poId));
         proof.foreign_po_denials.push({status:po.status});
         expect([403,404,409]).toContain(po.status);
         expect(JSON.stringify(po.body)).not.toContain(poId);
         expect(JSON.stringify(po.body)).not.toContain(ref);
       }
       const client=await fetchJSON(page,'/api/market-delegation/markets/'+oracle[ref].market+'/clients/'+encodeURIComponent(oracle[ref].customer_phone));
       proof.foreign_client_denials.push({status:client.status});
       expect([403,404,409]).toContain(client.status);
       expect(JSON.stringify(client.body)).not.toContain(oracle[ref].customer_phone);
       expect(JSON.stringify(client.body)).not.toContain(ref);
     }
     const final=await fetchJSON(page,'/health/version');
     page.off('response',onResponse);
     await Promise.all(responseAudits);
     expect(auditErrors,'Every API JSON response must be auditable').toEqual([]);
     // Re-fetch each evicted JSON body with an authenticated same-origin GET.
     // A missing, non-JSON or server-error replay remains a hard FAIL.
     const replayUrls=[...unreadableJsonUrls];
     if(replayUrls.length){
       const replays=await page.evaluate(async urls=>Promise.all(urls.map(async url=>{
         const response=await fetch(url,{method:'GET',credentials:'same-origin',redirect:'manual',
           headers:{Accept:'application/json'},signal:AbortSignal.timeout(20000)});
         return {url,status:response.status,contentType:response.headers.get('content-type')||'',
           body:await response.text()};
       })),replayUrls);
       expect(replays.length).toBe(replayUrls.length);
       for(const replay of replays){
         expect(replay.status,'Replayed GET must return HTTP').toBeGreaterThanOrEqual(200);
         expect(replay.status,'Replayed GET cannot be a server error').toBeLessThan(500);
         expect(replay.contentType,'Replayed GET must be JSON').toContain('json');
         auditJsonBody(replay.url,replay.body);
       }
       proof.apiResponseAuditReplayed=replays.length;
     }
     proof.apiResponseAuditComplete=true;
     expect(proof.foreignDataLeaks,'No fetched API projection may contain foreign order, PO or client data').toEqual([]);
     expect(proof.foreignMarketLeaks,'No fetched API projection may expose another market').toEqual([]);
     expect(final.status).toBe(200);
     proof.finalVersion=final.body.commit||final.body.sha;
     expect(proof.finalVersion).toBe(expectedSha);
     expect(proof.jsErrors).toEqual([]);
     expect(proof.blockedWrites).toEqual([]);
     proof.result='PASS';
   }catch(error){
     proof.result='FAIL';
     proof.error=String(error?.message||error).split(/Call log:|\n\s*- →/)[0]
       .replace(/eyJ[A-Za-z0-9._-]+/g,'[REDACTED]').slice(0,240);
     throw error;
   }finally{
     if(context)await context.close();
     save();
   }
 });
}
