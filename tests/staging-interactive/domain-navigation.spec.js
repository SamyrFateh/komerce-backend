/**
 * @komerce-arch-lite
 * @role local-interactive-staging-domain-browser-proof
 * @domain dashboard
 * @layer e2e
 * @owner backend-core
 * @purpose Per-domain/role/page real Chromium evidence on Railway staging, read-only.
 * @impact-areas dashboard, staging-only
 */
'use strict';
const {test,expect}=require('@playwright/test');
const {interactiveRoutes}=require('./domain-catalog');
const {expectedPath}=require('../staging-canonical/navigation-audit-policy');
const {markets}=require('../staging-canonical/matrix');

const ORIGIN='https://komerce-backend-production.up.railway.app';
const role=process.env.E2E_INTERACTIVE_ROLE||'admin';
const domain=process.env.E2E_INTERACTIVE_DOMAIN||'all';
const screens=interactiveRoutes(role,domain);

function actualPath(url){
  try {
    const parsed=new URL(url,ORIGIN);
    return parsed.origin===ORIGIN?parsed.pathname:null;
  }catch(_){return null;}
}
function versionSha(payload){return String(payload?.commit||payload?.sha||'');}
function secret(roleName,suffix) {
  return process.env['E2E_'+roleName.toUpperCase()+'_'+suffix];
}

if(screens.length===0) {
  throw Error('NO_AUTHORIZED_SCREENS_FOR_ROLE_AND_DOMAIN: '+role+'/'+domain);
}

for(const {domain:area,route:targetRoute} of screens){
  test.describe('['+area+']',()=>{
    test('Écran réel '+targetRoute,async({page},testInfo)=>{
      const evidence={domain:area,role,viewport:testInfo.project.name,
        route:targetRoute,expectedVersion:process.env.E2E_EXPECTED_DEPLOY_SHA||null,
        observedVersion:null,observedVersionAtEnd:null,contextStatus:null,
        allowedMarkets:[],http:null,actual:null,blockedWrites:[],jsErrors:[],api5xx:[],
        outcome:'NOT_PROVEN'};

      page.on('pageerror',err=>evidence.jsErrors.push(String(err.message).slice(0,150)));
      page.on('response',res=>{
        if(res.status()>=500&&actualPath(res.url())?.startsWith('/api/')){
          evidence.api5xx.push({path:actualPath(res.url()),status:res.status()});
        }
      });

      try{
        await test.step('Vérifier version réelle du staging',async()=>{
          expect(process.env.E2E_STAGING_BASE_URL).toBe(ORIGIN);
          expect(process.env.E2E_EXPECTED_DEPLOY_SHA).toMatch(/^[0-9a-f]{40}$/);
          const res=await page.request.get('/health/version');
          expect(res.status()).toBe(200);
          const sha=versionSha(await res.json());
          evidence.observedVersion=sha;
          expect(sha).toBe(evidence.expectedVersion);
        });

        await test.step('Se connecter avec le seul compte E2E du rôle',async()=>{
          const email=secret(role,'EMAIL'),password=secret(role,'PASSWORD');
          expect(Boolean(email&&password),'Identifiants E2E manquants localement').toBe(true);
          // API login obtains the session cookie in this isolated browser
          // context. We never type a password into a recorded browser trace.
          const login=await page.request.post('/api/auth/login',{
            data:{email,password},timeout:20000
          });
          evidence.loginStatus=login.status();
          expect(login.status(),'Connexion HTTP du rôle '+role).toBe(200);
          const me=await page.request.get('/api/auth/me');
          expect(me.status()).toBe(200);
          const account=await me.json();
          expect(account.role).toBe(role);
        });

        // Strictly read-only from here, including human clicks while UI
        // inspector is open. No mutations, checkout or external POST.
        await page.route('**/*',async r=>{
          const req=r.request();
          if(['GET','HEAD','OPTIONS'].includes(req.method()))return r.continue();
          evidence.blockedWrites.push({
            method:req.method(),path:actualPath(req.url())||'[external]'
          });
          return r.abort('blockedbyclient');
        });

        await test.step('Prouver le contexte marché sans créer de droits',async()=>{
          const res=await page.request.get('/api/admin/dashboard/context');
          evidence.contextStatus=res.status();
          if(role==='sourcing'){
            expect(res.status(),'Sourcing ne reçoit pas le contexte dashboard').toBe(403);
            evidence.context='EXPECTED_DENIAL_SEPARATE_SOURCING_AUTHORITY';
          }else{
            expect(res.status(),'Le contexte dashboard doit être accessible au rôle').toBe(200);
            const ctx=await res.json();
            expect(ctx.actor?.role).toBe(role);
            evidence.allowedMarkets=ctx.access?.allowedMarkets||[];
            expect(evidence.allowedMarkets.length).toBeGreaterThan(0);
          }
        });

        await test.step('Afficher le vrai écran et vérifier la navigation',async()=>{
          const response=await page.goto(ORIGIN+targetRoute,{
            waitUntil:'domcontentloaded',timeout:20000
          });
          evidence.http=response?.status()||null;
          expect(evidence.http,'HTTP écran').toBe(200);
          await expect(page.locator('body')).toBeVisible({timeout:12000});
          await expect.poll(async()=>page.locator('body').innerText().then(t=>t.trim().length),
            {timeout:12000,message:'Écran vide ou jamais chargé'}).toBeGreaterThan(35);
          evidence.actual=actualPath(page.url());
          expect(evidence.actual,'Destination attendue / alias déclaré')
            .toBe(expectedPath(targetRoute,ORIGIN));
          expect(evidence.actual).not.toBe('/');
          expect(evidence.actual).not.toBe('/login.html');
        });

        await test.step('Vérifier refus inter-marchés pour un opérateur',async()=>{
          if(role!=='market_operator'||area!=='marches')return;
          for(const market of markets.filter(m=>!evidence.allowedMarkets.includes(m))){
            const res=await page.request.get('/api/admin/dashboard/unified/market/'+market);
            evidence.crossMarketDenials=evidence.crossMarketDenials||[];
            evidence.crossMarketDenials.push({market,status:res.status()});
            expect(res.ok(),'Le marché '+market+' ne doit jamais livrer ses données').toBe(false);
          }
        });

        if(process.env.E2E_INTERACTIVE_PAUSE==='1'){
          await test.step('Pause manuelle — inspecter et cliquer sans écriture serveur',async()=>{
            await page.pause(); // Playwright Inspector: Resume to complete the proof.
          });
        }

        await test.step('Vérifier version finale et absence d’écriture',async()=>{
          const end=await page.request.get('/health/version');
          expect(end.status()).toBe(200);
          evidence.observedVersionAtEnd=versionSha(await end.json());
          expect(evidence.observedVersionAtEnd,'Un déploiement a changé durant le test')
            .toBe(evidence.observedVersion);
          expect(evidence.blockedWrites,'Mutation UI bloquée: action hors lecture seule')
            .toEqual([]);
          expect(evidence.jsErrors,'Erreurs JavaScript').toEqual([]);
          expect(evidence.api5xx,'Échecs API serveur 5xx').toEqual([]);
          evidence.outcome='SCREEN_OBSERVED_READ_ONLY';
        });
      }finally{
        // Evidence stays on the developer's workstation. A screenshot may
        // contain real staging data; do not publish it in Git or PR comments.
        await testInfo.attach('preuve-navigation.json',{
          body:Buffer.from(JSON.stringify(evidence,null,2)),
          contentType:'application/json'
        });
        if(evidence.actual){
          const screenshot=await page.screenshot({fullPage:true,timeout:9000}).catch(()=>null);
          if(screenshot)await testInfo.attach('capture-ecran.png',{
            body:screenshot,contentType:'image/png'
          });
        }
      }
    });
  });
}
