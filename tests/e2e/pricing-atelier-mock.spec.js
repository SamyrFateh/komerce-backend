/**
 * @e2e   pricing-atelier-mock.spec.js
 * @feature dashboard (espace « Atelier des prix », /admin/workspaces/pricing, marché Comores)
 * @brief Contrat V7/V6 validé : navigation exclusive, données absentes honnêtes,
 *        périmètre marché, budget explicite et absence de débordement desktop.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

const CANONICAL = path.join(__dirname, '..', '..', 'public', 'dashboards', 'canonical');
const FX = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'pricing-atelier-km.json'), 'utf8'));
const ORIGIN = 'https://komerce.test';


const emptyModel = { scope:'MARKET', central:true, centers:[], families:[], posts:[], resources:[] };
const budget = { native:'1200.00', currency:'EUR', revision:2 };
const center = { id:'c1',label:'Logistique locale',is_active:true,responsible_label:'Responsable local' };
const model = { ...emptyModel, centers:[center], families:[{id:'f1',center_id:'c1',label:'Locaux'}],
  posts:[{id:'p1',center_id:'c1',family_id:'f1',label:'Loyer relais',economic_nature:'FIXED',allocation_perimeter:'DIRECT',
    allocation_basis:'Mois',budget,commitments:[],acceptsStructureActual:true}] };
const nav = page => page.getByRole('navigation',{name:'Atelier économique',exact:true});
async function mount(page,{autoMarket=false,populated=false,posts=[],reads=[],costStatus=200,wrongScope=false}={}) {
  await page.route(`${ORIGIN}/**`,async route=>{
    const url=new URL(route.request().url());
    const json=(body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
    if(url.pathname==='/admin/workspaces/pricing')return route.fulfill({contentType:'text/html',path:path.join(CANONICAL,'index.html')});
    if(url.pathname.startsWith('/dashboards/canonical/')){
      const file=path.join(CANONICAL,url.pathname.replace('/dashboards/canonical/',''));
      return fs.existsSync(file)?route.fulfill({path:file}):route.fulfill({status:404,body:''});
    }
    if(route.request().method()==='POST'){posts.push({path:url.pathname,body:route.request().postDataJSON()});return json({ok:true});}
    if(url.pathname==='/api/auth/me')return json(autoMarket?{...FX.auth_me,role:'market_operator'}:FX.auth_me);
    if(url.pathname==='/api/admin/dashboard/context')return json(autoMarket?{...FX.context,actor:{...FX.context.actor,role:'market_operator'},access:{...FX.context.access,mode:'market',allowedMarkets:['KM'],defaultMarket:'KM',capabilities:['finance.read','pricing.read'],delegatedCapabilities:{KM:['finance.read','pricing.read','dashboard.market.read']}}}:FX.context);
    if(url.pathname==='/api/admin/workspaces/pricing')return json(FX.global);
    if(url.pathname==='/api/admin/workspaces/pricing/market/KM')return json(FX.market);
    if(url.pathname.endsWith('/cost-centers')){
      reads.push(url.pathname);
      return json({... (populated?model:emptyModel), central:!autoMarket, costCapabilities:{},periodStart:url.searchParams.get('periodStart'),marketCode:wrongScope?'CM':url.pathname.includes('/market/KM/')?'KM':null},costStatus);
    }
    return route.fulfill({status:404,body:''});
  });
  await page.goto(`${ORIGIN}/admin/workspaces/pricing${autoMarket?'':'?market=KM'}`);
  await expect(page.locator('.kmc-v7v6-session')).toBeVisible();
  if(costStatus===200&&!wrongScope)await expect(nav(page)).toBeVisible();
}
for(const viewport of [{width:1536,height:1024},{width:1280,height:800}]){
  test.describe(`Atelier économique V7/V6 — desktop ${viewport.width}`,()=>{
    test.use({viewport});
    test('titre, quatre KPI honnêtes, aucun texte parasite',async({page})=>{
      await mount(page);
      await expect(page.getByRole('heading',{name:'Atelier économique',exact:true})).toBeVisible();
      const kpis=page.locator('[data-v7-centers] .kmc-v7-kpis');
      await expect(kpis.locator('.kmc-v7-metric > span')).toHaveText(['Budget enregistré (EUR)','Engagements ouverts (EUR)','Charges constatées','Disponible']);
      await expect(kpis.locator('.kmc-v7-metric > strong')).toHaveText(['Non disponible','À rapprocher','À rapprocher','Non calculable']);
      expect(await page.locator('[data-v7-centers]').innerText()).not.toMatch(/\bnull\b|\bundefined\b|\\n/);
    });
    test('délégation mono-marché : lecture KM automatique sans écriture',async({page})=>{
      const reads=[],posts=[];await mount(page,{autoMarket:true,reads,posts,populated:true});
      await expect(page.locator('[data-v7-centers]')).toContainText('Marché KM');
      expect(reads).toEqual(['/api/admin/workspaces/pricing/market/KM/cost-centers']);
      await page.getByRole('button',{name:'Consulter',exact:true}).click();
      await page.getByRole('button',{name:'Loyer relais',exact:true}).click();
      await expect(page.getByRole('button',{name:'Valider le budget'})).toHaveCount(0);
      expect(posts).toHaveLength(0);
    });
    test('indisponibilité serveur : aucun ancien cockpit ni valeur fictive',async({page})=>{
      await mount(page,{costStatus:503});
      await expect(page.getByText('Données économiques indisponibles pour cette période.')).toBeVisible();
      await expect(nav(page)).toHaveCount(0);
      await expect(page.locator('[data-atelier-nav], [data-v7-centers]')).toHaveCount(0);
    });
    test('périmètre incohérent refusé : aucune donnée du mauvais marché',async({page})=>{
      await mount(page,{wrongScope:true,populated:true});
      await expect(page.getByText('Données économiques indisponibles pour cette période.')).toBeVisible();
      await expect(page.locator('.kmc-v7-center-card')).toHaveCount(0);
    });
    test('budget du poste : valeur conservée, refus montant invalide, validation explicite',async({page})=>{
      const posts=[];await mount(page,{populated:true,posts});
      await page.getByRole('button',{name:'Consulter',exact:true}).click();
      await page.getByRole('button',{name:'Loyer relais',exact:true}).click();
      const form=page.locator('.kmc-v7-budget-form').filter({has:page.getByRole('button',{name:'Valider le budget'})});
      const amount=form.locator('[name=amountNative]');
      await expect(amount).toHaveValue('1200');
      await form.locator('[name=reason]').fill('Recette budget');
      await amount.fill('-1');
      await form.getByRole('button',{name:'Valider le budget'}).click();
      await expect(form).toContainText('Montant, devise ou motif invalide.');
      expect(posts).toHaveLength(0);
      await amount.fill('1300');
      await form.getByRole('button',{name:'Valider le budget'}).click();
      await expect.poll(()=>posts.length).toBe(1);
      expect(posts[0]).toMatchObject({path:'/api/admin/workspaces/pricing/market/KM/cost-centers/posts/p1/budget-revisions',body:{amountNative:'1300',currency:'EUR',expectedRevision:2,reason:'Recette budget'}});
      expect(posts[0].body.requestKey).toBeTruthy();
    });
    test('navigation exclusive sans anciennes familles ni doublon',async({page})=>{
      await mount(page,{populated:true});
      await expect(nav(page).getByRole('button')).toHaveText(['Centres de coûts','Activité','Rentabilité']);
      await nav(page).getByRole('button',{name:'Activité',exact:true}).click();
      await expect(page.locator('.kmc-v6-activity')).toBeVisible();
      await expect(page.locator('[data-v7-centers]')).toHaveCount(0);
      await nav(page).getByRole('button',{name:'Rentabilité',exact:true}).click();
      await expect(page.locator('.kmc-v6-profitability')).toBeVisible();
      await expect(page.locator('.kmc-v6-activity, [data-atelier-nav], .kmc-economic-family-grid')).toHaveCount(0);
    });
    test('centre et retour sans ancien portefeuille ni débordement desktop',async({page})=>{
      await mount(page,{populated:true});
      await expect(page.locator('.kmc-v7-center-card')).toHaveCount(1);
      await page.getByRole('button',{name:'Consulter',exact:true}).click();
      await expect(page.locator('[data-v7-centers]')).toContainText('Responsable local');
      await page.getByRole('button',{name:'Tous les centres',exact:true}).click();
      await expect(page.locator('.kmc-v7-center-card')).toHaveCount(1);
      await expect(page.locator('[data-cockpit-portfolio], [data-atelier-nav]')).toHaveCount(0);
      const widths=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,inner:window.innerWidth}));
      expect(widths.scroll).toBeLessThanOrEqual(widths.inner);
    });
  });
}
