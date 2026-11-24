'use strict';
// Public real Chromium read-only visual check. No real inquiry or external contact.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');
const data = require('../../docs/ops/local-offer-options.5245.json');
const base = process.env.STAGING_BASE_URL;
async function main() {
  assert.equal(process.env.KOMERCE_ENV,'staging');
  const health = await fetch(base+'/health').then(r=>r.json());
  assert.ok(health.target);
  const browser = await chromium.launch({headless:true});
  fs.mkdirSync('test-results/local-offers-5245',{recursive:true});
  try {
    for (const [market,d] of Object.entries(data.markets)) {
      const rail = await fetch(base+'/api/boutique/suggestions?surface=local&market='+market).then(r=>r.json());
      assert.ok(rail.cards.some(c=>c.cta_action_ref===d.offer_id));
      for (const wrong of ['KM','CM','CG'].filter(x=>x!==market)) {
        const response = await fetch(base+'/api/providers-services/physical-offers/'+d.offer_id+'?market='+wrong);
        assert.equal(response.status,404);
        const other = await fetch(base+'/api/boutique/suggestions?surface=local&market='+wrong).then(r=>r.json());
        assert.ok(!other.cards.some(c=>c.cta_action_ref===d.offer_id));
      }
      const ctx=await browser.newContext({viewport:{width:1440,height:1000}});
      try {
        const page=await ctx.newPage();
        await page.goto(base+'/'+market,{waitUntil:'domcontentloaded'});
        const card=page.locator('article[data-discovery-ref="'+d.offer_id+'"]:visible').first();
        await card.waitFor({state:'visible',timeout:45000});
        await card.scrollIntoViewIfNeeded();
        await card.click();
        const detail=page.locator('#k-modal-discovery-detail');
        await detail.waitFor({state:'visible'});
        const img=detail.locator('img');
        await img.waitFor({state:'visible'});
        await page.waitForFunction(()=>{const i=document.querySelector('#k-modal-discovery-detail img');return i&&i.complete&&i.naturalWidth>0;});
        await detail.locator('button[data-discovery-select-action="request"]').click();
        const select=detail.locator('[data-discovery-action-form="request"] select[data-discovery-option]');
        await select.waitFor({state:'visible'});
        const keys=await select.locator('option').evaluateAll(els=>els.map(e=>e.value).filter(Boolean));
        assert.deepEqual(keys,d.options.map(o=>o.key));
        await select.selectOption(d.options[0].key);
        assert.equal(await select.inputValue(),d.options[0].key);
        await page.screenshot({path:'test-results/local-offers-5245/'+market+'.png'});
        console.log(JSON.stringify({market,options:keys.length,visual:true,selection:true,cross_market_refused:true}));
      } finally {await ctx.close();}
    }
  } finally {await browser.close();}
  console.log('DEMO_CHROMIUM_READONLY_PASS; no inquiry submitted');
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
