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
  const state={creates:[],advances:0,evidenceUnavailable:false};
  await page.route(ORIGIN+'/**',async route=>{
    const req=route.request(), url=new URL(req.url());
    if(url.pathname==='/admin/golden-e2e') return route.fulfill({
      contentType:'text/html',
      headers:{'Content-Security-Policy':"default-src 'self'; script-src 'self'; script-src-attr 'none'; style-src 'self' 'unsafe-inline'; object-src 'none'"},
      body:html
    });
    if(url.pathname==='/js/golden-e2e-cockpit-journey.js'||url.pathname==='/js/golden-e2e-cockpit-upstream.js'||url.pathname==='/js/golden-recipe-scenarios.js'){
      const file=path.join(__dirname,'..','..','public',url.pathname.slice(1));
      return route.fulfill({contentType:'application/javascript',body:fs.readFileSync(file,'utf8')});
    }
    if(url.pathname==='/api/admin/entities/golden-create'&&req.method()==='POST'){
      state.creates.push(req.postDataJSON());
      return route.fulfill({status:201,contentType:'application/json',body:JSON.stringify({reference:'K-GOLDEN-BROWSER',marketCode:state.creates.at(-1).marketCode})});
    }
    if(url.pathname.endsWith('/golden-evidence')&&state.evidenceUnavailable) return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Backend indisponible'})});
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

test.describe('Golden cockpit V4 — parcours guidé et preuves isolées',()=>{
  test('la préparation est le seul écran actif tant qu’aucune commande n’est chargée',async({page})=>{
    await mount(page);
    await expect(page.locator('#wizardSetup')).toBeVisible();
    await expect(page.locator('#wizardStage')).toBeHidden();
    await expect(page.locator('#goldenStats')).toBeHidden();
    await expect(page.locator('#wizardSetupControls #createGolden')).toBeVisible();
    await expect(page.locator('#wizardSetupControls #refForm')).toBeVisible();
    await expect(page.locator('#upstream [data-gate]')).toHaveCount(5);
    await expect(page.locator('#existing-e2e-evidence a')).toHaveCount(4);
    await expect(page.locator('#global')).not.toHaveText(/GOLDEN VERT|certifié/i);
  });

  test('Comores : préparation, guide, visualisation et validation distinctes',async({page})=>{
    const state=await mount(page);
    await page.locator('#marketSelect').selectOption('KM');
    await page.locator('#createGolden').click();
    expect(state.creates).toEqual([{marketCode:'KM'}]);
    await expect(page.locator('#wizardSetup')).toBeHidden();
    await expect(page.locator('#wizardStage')).toBeVisible();
    await expect(page.locator('#orderRef')).toHaveText('K-GOLDEN-BROWSER');
    await expect(page.locator('.wizard-grid')).toHaveAttribute('data-phase','guide');
    await expect(page.locator('#title')).toHaveText('Commande client');
    await expect(page.locator('#openReal')).toBeHidden();
    await page.locator('#wizardNext').click();
    await expect(page.locator('.wizard-grid')).toHaveAttribute('data-phase','view');
    await expect(page.locator('#openReal')).toBeVisible();
    await expect(page.locator('#openReal')).toHaveAttribute('href','/admin/orders/K-GOLDEN-BROWSER');
    await page.locator('#wizardNext').click();
    await expect(page.locator('.wizard-grid')).toHaveAttribute('data-phase','validate');
    await expect(page.locator('#pass')).toBeVisible();
    await expect(page.locator('#fail')).toBeVisible();
    await expect(page.locator('#wizardNext')).toBeDisabled();
    await page.locator('#pass').click();
    await expect(page.locator('#score')).toHaveText('1 / 10');
    await expect(page.locator('#title')).toHaveText('Commande client');
    await expect(page.locator('#wizardNext')).toBeEnabled();
    await page.locator('#wizardNext').click();
    await expect(page.locator('#title')).toHaveText('Paiement client');
    await expect(page.locator('.wizard-grid')).toHaveAttribute('data-phase','guide');
  });

  test('Cameroun : détails repliés par défaut, étapes et actions avancées conservées',async({page})=>{
    const state=await mount(page);
    await page.locator('#marketSelect').selectOption('CM');
    await page.locator('#createGolden').click();
    expect(state.creates).toEqual([{marketCode:'CM'}]);
    await expect(page.locator('#wizardProofDetails')).not.toHaveAttribute('open');
    await expect(page.locator('#wizardTechnical')).not.toHaveAttribute('open');
    await page.locator('#wizardShowSteps').click();
    await expect(page.locator('#rail .stepbtn')).toHaveCount(10);
    await expect(page.locator('#rail')).toBeVisible();
    await page.locator('#rail .stepbtn').nth(5).click();
    await expect(page.locator('#title')).toHaveText('Réception Hub');
    await page.locator('#wizardNext').click();
    await expect(page.locator('#openReal')).toHaveAttribute('href','/admin/hub-live');
    await page.locator('#wizardTechnical summary').click();
    await page.locator('#advance').click();
    expect(state.advances).toBe(1);
    await page.locator('#refresh').click();
    await page.locator('#wizardProofDetails summary').click();
    await expect(page.locator('#backendEvidence')).toContainText(/matched/i);
    await expect(page.locator('#score')).toHaveText('0 / 10');
  });

  test('une anomalie humaine bloque la suite, sans modifier la preuve backend',async({page})=>{
    await mount(page);
    await page.locator('#marketSelect').selectOption('CG');
    await page.locator('#createGolden').click();
    await page.locator('#wizardNext').click();
    await page.locator('#wizardNext').click();
    await page.locator('#fail').click();
    await expect(page.locator('#blocked')).toBeVisible();
    await expect(page.locator('#wizardNext')).toBeDisabled();
    await expect(page.locator('#score')).toHaveText('0 / 10');
    await expect(page.locator('#humanDisclaimer')).toContainText('sans changement de statut backend');
    await page.locator('#pass').click();
    await expect(page.locator('#wizardNext')).toBeEnabled();
  });

  test('les dix écrans métier restent accessibles avec une progression explicite',async({page})=>{
    await mount(page);
    await page.locator('#createGolden').click();
    await page.locator('#wizardShowSteps').click();
    const expected=['/admin/orders/K-GOLDEN-BROWSER','/admin/finance','/admin/workspaces/purchasing','/admin/workspaces/purchasing','/admin/workspaces/purchasing','/admin/hub-live','/admin/workspaces/shipping-customs','/admin/relais-live','/admin/relais-live','/admin/workspaces/accounting'];
    const rail=page.locator('#rail .stepbtn');
    for(let i=0;i<10;i++){
      await rail.nth(i).click();
      await expect(page.locator('#openReal')).toHaveAttribute('href',expected[i]);
      await expect(page.locator('#stepCi')).toHaveAttribute('href',/^https:\/\/github\.com\/SamyrFateh\/komerce-backend\//);
      await page.locator('#wizardNext').click();
      await page.locator('#wizardNext').click();
      await page.locator('#pass').click();
    }
    await expect(page.locator('#score')).toHaveText('10 / 10');
    await expect(page.locator('#verdict')).toContainText('NON CERTIFIÉE');
    await expect(page.locator('#global')).not.toHaveText(/GOLDEN VERT|certifié/i);
  });

  test('les preuves amont restent consultables et non certifiées si l’API est indisponible',async({page})=>{
    await mount(page);
    await page.locator('.detail-group').first().locator('summary').click();
    await expect(page.locator('#upstream [data-gate]')).toHaveCount(5);
    await page.locator('#productId').fill('11111111-1111-4111-8111-111111111111');
    await page.locator('#readUpstream').click();
    await expect(page.locator('#upstream [data-gate="SOURCE_PROVED"]')).toContainText('NON PROUVÉ');
    await expect(page.locator('#upstream .st.PROVED')).toHaveCount(0);
    await expect(page.locator('#certLine')).toContainText('NON CERTIFIÉE');
  });


  test('preuve backend périmée effacée dès qu’une lecture échoue, sans faux vert',async({page})=>{
    const state=await mount(page);
    await page.locator('#createGolden').click();
    await expect(page.locator('#backendEvidence')).toContainText('ordered');
    state.evidenceUnavailable=true;
    await page.locator('#wizardNext').click();
    await page.locator('#wizardNext').click();
    await page.locator('#wizardTechnical summary').click();
    await page.locator('#refresh').click();
    await expect(page.locator('#liveState')).toContainText('Preuves indisponibles');
    await expect(page.locator('#backendEvidence')).toHaveText('—');
    await expect(page.locator('#pass')).toBeDisabled();
    await expect(page.locator('#wizardNext')).toBeDisabled();
    await expect(page.locator('#score')).toHaveText('0 / 10');
    await expect(page.locator('#rail .stepbtn.pass')).toHaveCount(0);
    await expect(page.locator('#global')).not.toHaveText(/GOLDEN VERT|certifié/i);
    state.evidenceUnavailable=false;
    await page.locator('#refresh').click();
    await expect(page.locator('#backendEvidence')).toContainText('ordered');
    await expect(page.locator('#pass')).toBeEnabled();
  });

  test('une réponse tardive ne rétablit pas la preuve après une erreur plus récente',async({page})=>{
    await mount(page);
    await page.locator('#createGolden').click();
    await expect(page.locator('#backendEvidence')).toContainText('ordered');
    await page.locator('#wizardNext').click();
    await page.locator('#wizardTechnical summary').click();
    let release, started;
    const pending=new Promise(resolve=>{release=resolve});
    const received=new Promise(resolve=>{started=resolve});
    let reads=0;
    await page.route(ORIGIN+'/api/admin/entities/orders/**/golden-evidence',async route=>{
      if(++reads===1){
        started();
        await pending;
        await route.fulfill({contentType:'application/json',body:JSON.stringify({steps:[{passed:true,evidence:'obsolete'}]})});
      }else await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Lecture récente refusée'})});
    });
    await page.locator('#refresh').click();
    await received;
    await expect(page.locator('#pass')).toBeDisabled();
    await expect(page.locator('#backendEvidence')).toHaveText('—');
    await page.locator('#refresh').click();
    await expect(page.locator('#liveState')).toContainText('Lecture récente refusée');
    const finished=page.waitForResponse(response=>response.url().endsWith('/golden-evidence')&&response.status()===200);
    release();
    await finished;
    await expect(page.locator('#backendEvidence')).toHaveText('—');
    await expect(page.locator('#pass')).toBeDisabled();
  });

  test('changer de Golden puis reprendre la même référence restaure son constat local',async({page})=>{
    await mount(page);
    await page.locator('#createGolden').click();
    await page.locator('#wizardNext').click();
    await page.locator('#wizardNext').click();
    await page.locator('#pass').click();
    await expect(page.locator('#score')).toHaveText('1 / 10');
    await page.locator('#wizardChange').click();
    await expect(page.locator('#wizardSetup')).toBeVisible();
    await expect(page.locator('#wizardStage')).toBeHidden();
    await page.locator('#refInput').fill('K-GOLDEN-BROWSER');
    await page.locator('#refForm button').click();
    await expect(page.locator('#score')).toHaveText('1 / 10');
    await expect(page.locator('.wizard-grid')).toHaveAttribute('data-phase','guide');
    await page.reload();
    await expect(page.locator('#orderRef')).toHaveText('K-GOLDEN-BROWSER');
    await expect(page.locator('#score')).toHaveText('1 / 10');
    await page.locator('#wizardShowSteps').click();
    await page.locator('#rail .stepbtn').nth(1).click();
    await expect(page.locator('#humanObservation')).toHaveValue('');
    await expect(page.locator('#score')).toHaveText('1 / 10');
  });
  test('recette CJ 20/15/5 reste non certifiée sans session et sans preuve',async({page})=>{
    await mount(page);
    await page.locator('#extendedRecipe summary').click();
    await page.locator('#scenarioTrack').selectOption('cj');
    await page.locator('#scenarioRef').fill('CJ-20-15-5');
    await page.locator('#scenarioSha').fill('c2f3c1d051c637a8d917a3f3fd6dc63c50b404ad');
    await page.locator('#scenarioStart').click();
    await expect(page.locator('#scenarioCount')).toHaveText('Étape 1 / 5');
    await page.locator('#scenarioNext').click();
    await page.locator('#scenarioNext').click();
    await page.locator('#scenarioNote').fill('20 produits dans le scénario');
    await page.locator('#scenarioProof').fill('capture-test-001');
    await expect(page.locator('#scenarioObserved')).toBeDisabled();
    await page.locator('#scenarioBlocked').click();
    await expect(page.locator('#scenarioState')).toContainText('BLOQUÉ');
    await expect(page.locator('#scenarioProgress')).toContainText('0 observation');
    await expect(page.locator('#scenarioNext')).toBeDisabled();
    await page.reload();
    await expect(page.locator('#scenarioState')).toContainText('BLOQUÉ');
  });

  test('lots L1–L10 : preuve, session et constat restent distincts',async({page})=>{
    await mount(page);
    await page.locator('#extendedRecipe summary').click();
    await page.locator('#scenarioTrack').selectOption('l1l10');
    await page.locator('#scenarioMarket').selectOption('CM');
    await page.locator('#scenarioRef').fill('F02');
    await page.locator('#scenarioSha').fill('c2f3c1d');
    await page.locator('#scenarioStart').click();
    await expect(page.locator('#scenarioCount')).toHaveText('Étape 1 / 10');
    await expect(page.locator('#scenarioTitle')).toContainText('L1');
    await expect(page.locator('#scenarioOpen')).toHaveAttribute('href','/admin/pilotage');
    await page.locator('#scenarioNext').click();
    await page.locator('#scenarioNext').click();
    await page.locator('#scenarioNote').fill('Capture et JSON comparés pour CM.');
    await page.locator('#scenarioProof').fill('capture-cm-l1');
    await page.route(ORIGIN+'/api/admin/entities/golden-upstream?market=CM',async route=>route.fulfill({status:200,contentType:'application/json',body:'{}'}));
    await page.locator('#scenarioAuthButton').click();
    await expect(page.locator('#scenarioAuth')).toContainText('autorisé');
    await page.locator('#scenarioObserved').click();
    await expect(page.locator('#scenarioState')).toContainText('OBSERVÉ');
    await expect(page.locator('#scenarioState')).toContainText('NON PROUVÉ');
    await page.locator('#scenarioNext').click();
    await expect(page.locator('#scenarioTitle')).toContainText('L2');
    await page.reload();
    await expect(page.locator('#scenarioProgress')).toContainText('1 observation');
    await expect(page.locator('#scenarioAuth')).toContainText('NON VÉRIFIÉ');
  });

});
