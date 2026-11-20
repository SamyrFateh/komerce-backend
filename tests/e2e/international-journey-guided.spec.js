/** @test-kind e2e @test-runner playwright @test-requires none */
// Expéditions & Douane : preuve Chromium locale, sans staging ni mutation.
'use strict';
const path=require('node:path');
const {test,expect}=require('@playwright/test');
const ROOT=path.resolve(__dirname,'../../public/dashboards/canonical');

async function mount(page,{role='agent_hub',stage='hub_ready',tab='transport',width=1440}={}){
  await page.setViewportSize({width,height:900});
  await page.goto('about:blank');
  await page.setContent('<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body style="margin:12px"><main id="root"></main></body></html>');
  await page.addStyleTag({path:path.join(ROOT,'css/international-journey-panel.css')});
  await page.addScriptTag({path:path.join(ROOT,'js/international-journey-panel.js')});
  await page.evaluate(({role,stage,tab})=>{
    globalThis.__writes=[];
    const shipment={reference:'EXP-KM-TEST',stage,transport_mode:'sea',
      hub_draft:true,hub_unit_count:2,forwarder_name:'Transitaire test',
      freight_invoice_kmf:null,freight_estimated_kmf:null,estimated_arrival_at:null};
    const ctx={marketCode:'KM',user:{role},journeyTab:tab,journeyRef:shipment.reference,
      fetch:async (url,opts)=>{if(opts.method!=='GET')globalThis.__writes.push(url);throw Error('No external call permitted');},
      reload:async ()=>{const el=document.getElementById('root');el.replaceChildren();
        globalThis.KomerceInternationalJourneyPanel.render(document,el,ctx,[shipment]);}};
    globalThis.__ctx=ctx;
    globalThis.KomerceInternationalJourneyPanel.render(document,document.getElementById('root'),ctx,[shipment]);
  },{role,stage,tab});
}

test('Hub : action suivante ouvre la remise au transitaire sans envoyer un seul POST',async({page})=>{
  await mount(page);
  const next=page.locator('[data-journey-next-action]');
  await expect(next).toContainText('Prochaine preuve : Remis au transitaire');
  const task=page.locator('[data-journey-next-task]');
  await expect(task).toHaveCount(1);
  await task.evaluate(el=>{el.open=false;});
  await page.locator('[data-journey-next-cta="open"]').click();
  await expect(task).toHaveJSProperty('open',true);
  await expect(task.getByLabel('Référence du justificatif / preuve')).toBeVisible();
  expect(await page.evaluate(()=>globalThis.__writes)).toEqual([]);
});

test('Direction de suivi : aucune fausse mutation et orientation directe vers Douane',async({page})=>{
  await mount(page,{role:'market_operator',stage:'hub_ready',width:390});
  await expect(page.locator('[data-journey-next-cta]')).toHaveCount(0);
  await expect(page.locator('.kmc-journey-next-wait')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth))
    .toBeLessThanOrEqual(1);
  expect(await page.evaluate(()=>globalThis.__writes)).toEqual([]);
  await mount(page,{role:'admin',stage:'arrived',tab:'transport'});
  await page.locator('[data-journey-next-cta="switch-tab"]').click();
  await expect(page.locator('.kmc-journey-tab.is-active')).toContainText('Arrivée & douane');
  await expect(page.locator('[data-journey-next-task]')).toHaveCount(1);
  expect(await page.evaluate(()=>globalThis.__writes)).toEqual([]);
});
