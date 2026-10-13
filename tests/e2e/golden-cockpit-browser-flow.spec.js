/**
 * @e2e golden-cockpit-browser-flow.spec.js
 * @feature Golden visual acceptance cockpit
 * @brief Browser contract for market selection, Golden creation, evidence refresh and human verdict isolation.
 */
'use strict';
const fs=require('fs');
const path=require('path');
const {test,expect}=require('@playwright/test');
const ORIGIN='http://komerce.test';
const html=fs.readFileSync(path.join(__dirname,'..','..','public','golden-e2e-cockpit.html'),'utf8');

async function mount(page){
  const state={creates:[],advances:0};
  await page.route(ORIGIN+'/**',async route=>{
    const req=route.request(), url=new URL(req.url());
    if(url.pathname==='/admin/golden-e2e') return route.fulfill({
      contentType:'text/html',
      headers:{'Content-Security-Policy':"default-src 'self'; script-src 'self'; script-src-attr 'none'; object-src 'none'"},
      body:html
    });
    if(url.pathname==='/js/golden-e2e-cockpit-journey.js'||url.pathname==='/js/golden-e2e-cockpit-upstream.js'){
      const file=path.join(__dirname,'..','..','public',url.pathname.slice(1));
      return route.fulfill({contentType:'application/javascript',body:fs.readFileSync(file,'utf8')});
    }
    if(url.pathname==='/api/admin/entities/golden-create'&&req.method()==='POST'){
      state.creates.push(req.postDataJSON());
      return route.fulfill({status:201,contentType:'application/json',body:JSON.stringify({reference:'K-GOLDEN-BROWSER',marketCode:state.creates.at(-1).marketCode})});
    }
    if(url.pathname.endsWith('/golden-evidence')) return route.fulfill({contentType:'application/json',body:JSON.stringify({reference:'K-GOLDEN-BROWSER',steps:[
      {key:'CLIENT_ORDER',passed:true,evidence:'ordered'},{key:'CLIENT_PAYMENT',passed:true,evidence:'paid'},{key:'PURCHASING',passed:true,evidence:'PO confirmed'},{key:'SUPPLIER_EXECUTION',passed:true,evidence:'matched'},{key:'FULFILLMENT',passed:true,evidence:'tracking'},
      {key:'HUB_INBOUND',passed:state.advances>0,evidence:state.advances>0?'matched':'pending'},{key:'CUSTOMS',passed:false,evidence:'pending'},{key:'RELAY_AVAILABLE',passed:false,evidence:'pending'},{key:'CUSTOMER_HANDOFF',passed:false,evidence:'pending'},{key:'FINANCIAL_CLOSE',passed:false,evidence:'pending'}]})});
    if(url.pathname.endsWith('/golden-advance')&&req.method()==='POST'){
      state.advances++;
      return route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true})});
    }
    return route.fulfill({status:404,body:'{}'});
  });
  await page.goto(ORIGIN+'/admin/golden-e2e');
  return state;
}

test.describe('Golden cockpit — recette visuelle',()=>{

  test('recette FULL : les dix étapes gardent leurs preuves contextuelles distinctes du verdict humain',async({page})=>{
    await mount(page);
    const expectedPaths=['/admin/operations','/admin/finance','/admin/workspaces/purchasing','/admin/workspaces/purchasing','/admin/workspaces/purchasing','/admin/hub-live','/admin/workspaces/shipping-customs','/admin/relais-live','/admin/relais-live','/admin/workspaces/accounting'];
    await expect(page.locator('#existing-e2e-evidence')).toBeVisible();
    await expect(page.locator('#rail .stepbtn')).toHaveCount(10);
    await expect(page.locator('#title')).toHaveText('Commande client');
    await expect(page.locator('#upstream [data-gate]')).toHaveCount(5);
    await expect(page.locator('#existing-e2e-evidence a')).toHaveCount(4);
    await expect(page.locator('#score')).toHaveText('0 / 10');
    const rail=page.locator('#rail .stepbtn');
    for(let i=0;i<10;i++){
      await rail.nth(i).click();
      await expect(page.locator('#openReal')).toHaveAttribute('href',expectedPaths[i]);
      await expect(page.locator('#stepCi')).toHaveAttribute('href',/^https:\/\/github\.com\/SamyrFateh\/komerce-backend\//);
      await expect(page.locator('#stepCiScope')).not.toBeEmpty();
    }
    await rail.nth(0).click();
    await expect(rail.nth(0)).not.toHaveClass(/pass/);
    await expect(rail.nth(0)).toHaveAttribute('title',/humain : non vérifié/);
    await expect(rail.nth(0)).toHaveAttribute('title',/backend : non prouvé/);
    await page.locator('#pass').click();
    await expect(page.locator('#score')).toHaveText('0 / 10');
    await expect(page.locator('#liveState')).toContainText('Renseigne la référence');
    await page.locator('#createGolden').click();
    await expect(rail.nth(0)).not.toHaveClass(/pass/);
    await expect(rail.nth(0)).toContainText('· 1');
    await expect(rail.nth(0)).toHaveAttribute('title',/backend : preuve disponible/);
    await page.locator('#pass').click();
    await expect(rail.nth(0)).toHaveClass(/pass/);
    await expect(page.locator('#score')).toHaveText('1 / 10');
  });

  test('CM : crée la Golden, charge les preuves et avance sans valider humainement',async({page})=>{
    const state=await mount(page);
    await page.locator('#marketSelect').selectOption('CM');
    await page.locator('#createGolden').click();
    await expect(page.locator('#orderRef')).toHaveText('K-GOLDEN-BROWSER');
    expect(state.creates).toEqual([{marketCode:'CM'}]);
    await expect(page.locator('#backendEvidence')).not.toHaveText('—');
    await page.locator('#rail .stepbtn').nth(5).click();
    await page.locator('#advance').click();
    await expect(page.locator('#backendEvidence')).toContainText(/matched/i);
    await expect(page.locator('#score')).toHaveText('0 / 10');
  });

  test('verdict humain reste séparé de la preuve backend',async({page})=>{
    await mount(page);
    await page.locator('#marketSelect').selectOption('CG');
    await page.locator('#createGolden').click();
    await page.locator('#pass').click();
    await expect(page.locator('#score')).toHaveText('1 / 10');
    await page.locator('#fail').click();
    await expect(page.locator('#blocked')).toBeVisible();
  });

  test('chaque étape pointe vers la vraie surface métier',async({page})=>{
    await mount(page);
    const expected=['/admin/operations','/admin/finance','/admin/workspaces/purchasing','/admin/workspaces/purchasing','/admin/workspaces/purchasing','/admin/hub-live','/admin/workspaces/shipping-customs','/admin/relais-live','/admin/relais-live','/admin/workspaces/accounting'];
    const buttons=page.locator('#rail .stepbtn');
    await expect(buttons).toHaveCount(10);
    for(let i=0;i<expected.length;i++){
      await buttons.nth(i).click();
      await expect(page.locator('#openReal')).toHaveAttribute('href',expected[i]);
    }
  });

  test('le conducteur change la prochaine action selon preuve et verdict humain',async({page})=>{
    await mount(page);
    await expect(page.locator('#nextAction')).toContainText('Crée ou charge');
    await page.locator('#createGolden').click();
    await expect(page.locator('#nextAction')).toContainText('Preuve backend acquise');
    await page.locator('#pass').click();
    await expect(page.locator('#nextAction')).toContainText('Preuve backend acquise');
    await page.locator('#rail .stepbtn').nth(5).click();
    await expect(page.locator('#nextAction')).toContainText('Déclenche');
    await page.locator('#fail').click();
    await expect(page.locator('#nextAction')).toContainText('Anomalie déclarée');
    await page.locator('#rail .stepbtn').nth(9).click();
    await expect(page.locator('#nextAction')).toContainText('observation uniquement');
  });

  // Niveau L3 : API simulée dans le navigateur — ces cas prouvent le contrat d'affichage, jamais un fait staging.
  test('dix validations humaines sans preuves backend ne donnent jamais une Golden verte',async({page})=>{
    await mount(page);
    await page.locator('#createGolden').click();
    for(let i=0;i<10;i++) await page.locator('#pass').click();
    await expect(page.locator('#score')).toHaveText('10 / 10');
    await expect(page.locator('#verdict')).toContainText('NON CERTIFIÉE');
    await expect(page.locator('#global')).not.toHaveText(/GOLDEN VERT|certifié/i);
    await expect(page.locator('body')).not.toContainText('GOLDEN VERT');
    await expect(page.locator('#certLine')).toContainText('NON CERTIFIÉE');
  });

  test('portes amont : API indisponible → NON PROUVÉ, jamais PASS',async({page})=>{
    await mount(page);
    await expect(page.locator('#upstream [data-gate]')).toHaveCount(5);
    await expect(page.locator('#upstream [data-gate="CUSTOMER_ORDER_PROVED"]')).toContainText('NON PROUVÉ');
    await expect(page.locator('#global')).toHaveText('NON DÉMARRÉ');
    await page.locator('#productId').fill('11111111-1111-4111-8111-111111111111');
    await page.locator('#readUpstream').click();
    await expect(page.locator('#upstream [data-gate="SOURCE_PROVED"]')).toContainText('NON PROUVÉ');
    await expect(page.locator('#upstream .st.PROVED')).toHaveCount(0);
    await expect(page.locator('#global')).toHaveText('PREUVE MANQUANTE');
  });

  test('portes amont : preuves canoniques → PRÊT POUR RECETTE avec liens réels, certification toujours refusée',async({page})=>{
    await mount(page);
    const gate=(key,label,link)=>({key,label,link,expected:'attendu',status:'PROVED',finding:'ok',evidence:{candidate_ref:key==='SOURCE_PROVED'?'KSC-1':null},next_action:'contrôle humain',human_checks:['à lire à l’écran']});
    await page.route('http://komerce.test/api/admin/entities/golden-upstream**',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({
      stage:'PRÊT POUR RECETTE',certification:'NON CERTIFIÉE',ids:{product_id:'p1',market_code:'KM'},
      gates:[gate('SOURCE_PROVED','Sourcing','/admin/workspaces/sourcing'),gate('REFINERY_PROVED','Raffinerie','/admin/workspaces/catalog'),gate('CATALOG_RELEASE_PROVED','Catalogue','/admin/workspaces/catalog'),gate('STOREFRONT_PROVED','Boutique','https://staging.example/boutique/'),gate('CUSTOMER_ORDER_PROVED','Commande → achat','/admin/workspaces/purchasing')],
      dossier:{sha256:'ab'.repeat(32),complete:false,incomplete_reasons:['Origine du checkout non prouvée par cette projection']}})}));
    await page.locator('#productId').fill('11111111-1111-4111-8111-111111111111');
    await page.locator('#readUpstream').click();
    await expect(page.locator('#global')).toHaveText('PRÊT POUR RECETTE');
    await expect(page.locator('#upstream [data-gate="SOURCE_PROVED"] a')).toHaveAttribute('href','/admin/workspaces/sourcing');
    await expect(page.locator('#upstream [data-gate="SOURCE_PROVED"]')).toContainText('candidate_ref=KSC-1');
    await expect(page.locator('#certLine')).toContainText('NON CERTIFIÉE');
    // Dossier exportable : lien de téléchargement, jamais présenté comme complet quand l'origine du checkout n'est pas prouvée.
    await expect(page.locator('#upstream [data-gate="CUSTOMER_ORDER_PROVED"] a')).toHaveAttribute('href','/admin/workspaces/purchasing');
    await expect(page.locator('#exportDossier')).toHaveAttribute('href',/golden-upstream\?.*download=1/);
    await expect(page.locator('#exportDossier')).toHaveAttribute('title',/INCOMPLET.*sha256 abab/);
  });
});
