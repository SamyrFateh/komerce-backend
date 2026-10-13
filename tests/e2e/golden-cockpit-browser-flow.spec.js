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
    if(url.pathname==='/admin/golden-e2e') return route.fulfill({contentType:'text/html',body:html});
    if(url.pathname==='/api/admin/entities/golden-create'&&req.method()==='POST'){
      state.creates.push(req.postDataJSON());
      return route.fulfill({status:201,contentType:'application/json',body:JSON.stringify({reference:'K-GOLDEN-BROWSER',marketCode:state.creates.at(-1).marketCode})});
    }
    if(url.pathname.endsWith('/golden-evidence')) return route.fulfill({contentType:'application/json',body:JSON.stringify({reference:'K-GOLDEN-BROWSER',steps:[
      {key:'CLIENT_ORDER',passed:true,detail:'ordered'},{key:'CLIENT_PAYMENT',passed:true,detail:'paid'},{key:'PURCHASING',passed:true,detail:'PO confirmed'},{key:'SUPPLIER_EXECUTION',passed:true,detail:'matched'},{key:'FULFILLMENT',passed:true,detail:'tracking'},
      {key:'HUB_INBOUND',passed:state.advances>0,detail:state.advances>0?'matched':'pending'},{key:'CUSTOMS',passed:false,detail:'pending'},{key:'RELAY_AVAILABLE',passed:false,detail:'pending'},{key:'CUSTOMER_HANDOFF',passed:false,detail:'pending'},{key:'FINANCIAL_CLOSE',passed:false,detail:'pending'}]})});
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
});
