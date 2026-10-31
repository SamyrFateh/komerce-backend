'use strict';

/** @test-kind e2e @test-runner playwright @test-requires none
 * Catalogue marché — vrai rendu Chromium desktop du code de la PR, API simulée.
 * Jamais de staging ni d'écriture distante dans ce test.
 */
const path = require('path');
const {test, expect} = require('@playwright/test');

const DIR = path.join(__dirname, '..', '..', 'public', 'dashboards', 'canonical');
const CURRENCY = 'KMF';
const product = (id, active = false) => ({
  product_id:id, product_ref:id, product_name:active?'Casque déjà publié':'Chargeur à tarifer',
  category:'Électronique', image_url:null,
  catalog_state:'published', decision_recorded:true,
  local_price_active:active, exposure_enabled:active,
  decision_state:{key:'READY',tone:'positive'},can_approve:true,
  proposed_price:{amount:25000,source:active?'LOCAL_ACTIVE':'MARKET_TARGET',currency:CURRENCY},
  corridor:{low:23000,target:25000,high:28000,status:'READY',sample_count:5},
  landed_relay_cost_local:14800,variable_cost_local:16000,
  contribution_at_proposed_local:9000,
});

async function mount(page) {
  await page.route('http://komerce.test/market', route =>
    route.fulfill({contentType:'text/html',body:'<!doctype html><html><body><main id="market-catalog-root" data-workspace-kind="market-catalog"></main></body></html>'}));
  await page.goto('http://komerce.test/market');
  await page.addStyleTag({path:path.join(DIR,'css','market-catalog-pricing-list.css')});
  await page.addScriptTag({path:path.join(DIR,'js','market-ready-to-sell.js')});
  await page.addScriptTag({path:path.join(DIR,'js','market-catalog-pricing-list.js')});
  await page.evaluate(() => {
    const rows=[
      {product_id:'p1',product_ref:'KPR-1',product_name:'Chargeur à tarifer',
        category:'Électronique',catalog_state:'published',decision_recorded:true,
        local_price_active:false,exposure_enabled:false,
        decision_state:{key:'READY',tone:'positive'},can_approve:true,
        proposed_price:{amount:25000,source:'MARKET_TARGET',currency:'KMF'},
        corridor:{low:23000,target:25000,high:28000,status:'READY',sample_count:5},
        landed_relay_cost_local:14800,variable_cost_local:16000,contribution_at_proposed_local:9000
      },
      {product_id:'p2',product_ref:'KPR-2',product_name:'Casque déjà publié',
        category:'Audio',catalog_state:'published',decision_recorded:true,
        local_price_active:true,exposure_enabled:true,
        decision_state:{key:'READY',tone:'positive'},can_approve:true,
        proposed_price:{amount:25000,source:'LOCAL_ACTIVE',currency:'KMF'},
        corridor:{low:23000,target:25000,high:28000,status:'READY',sample_count:5},
        landed_relay_cost_local:14800,variable_cost_local:16000,contribution_at_proposed_local:9000
      },
    ];
    window.__catalogCalls=[];
    window.__catalogReloads=0;
    const request=async (url,options={}) => {
      window.__catalogCalls.push({url,options});
      if(url.endsWith('/price-preview')) {
        const amount=Number(options.body.amount);
        const low=amount<23000,high=amount>28000,invalid=amount<=16000;
        return {
          amount,can_proceed:!invalid,below_variable:invalid,requires_market_gate:amount<17600,
          requires_acknowledgement:low || (url.includes('KPR-2') && amount<17500),
          contribution_local:amount-16000,
          warnings:[...(low?['BELOW_OBSERVED_MARKET']:[]),...(high?['ABOVE_OBSERVED_MARKET']:[])]
        };
      }
      return {ok:true};
    };
    window.KomerceMarketCatalogPricingList.render({
      root:document.getElementById('market-catalog-root'),
      payload:{market:{code:'KM',currency:'KMF'},actor_capabilities:['pricing.read','pricing.decide','pricing.activate','catalog.expose'],
        ready_to_sell:{market:{code:'KM',currency:'KMF'},pagination:{offset:0,limit:100,total:2},items:rows}},
      marketCode:'KM',request,feedback:()=>{},reload:async()=>{window.__catalogReloads++;}
    });
  });
}

test.describe('Catalogue pays — Chromium desktop 1440', () => {
  test.use({viewport:{width:1440,height:900}});

  test('une liste pleine largeur expose les décisions commerciales, sans dette N3',async({page})=>{
    await mount(page);
    const surface=page.locator('[data-market-price-catalog]');
    await expect(surface).toBeVisible();
    await expect(surface.locator('tbody tr')).toHaveCount(2);
    for(const header of ['Produit','Rendu relais','Coût variable','Repères marché','Notre prix','Contribution','Publication'])
      await expect(surface.locator('thead')).toContainText(header);
    await expect(surface).not.toContainText('Charges fixes par article');
    const dimensions=await page.evaluate(()=>({
      width:window.innerWidth, scroll:document.documentElement.scrollWidth,
      table:document.querySelector('.kmc-price-list-scroll').clientWidth,
    }));
    expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.width);
    expect(dimensions.table).toBeGreaterThan(900);
    await test.info().attach('market-catalog-desktop-1440',{body:await page.screenshot({fullPage:true}),contentType:'image/png'});
  });

  test('anti-faute : 2500 refusé, 32000 au-dessus du marché autorisé',async({page})=>{
    await mount(page);
    const tr=page.locator('tr[data-product-ref="KPR-1"]');
    await tr.locator('input').fill('2500');
    await expect(tr).toContainText('mise en vente refusée');
    await expect(tr.getByRole('button',{name:'Mettre en vente'})).toBeDisabled();
    await tr.locator('input').fill('32000');
    await expect(tr).toContainText('Au-dessus du repère haut');
    await expect(tr.getByRole('button',{name:'Mettre en vente'})).toBeEnabled();
    await tr.getByRole('button',{name:'Mettre en vente'}).click();
    await expect.poll(()=>page.evaluate(()=>window.__catalogReloads)).toBe(1);
    const calls=await page.evaluate(()=>window.__catalogCalls.map(c=>c.url));
    expect(calls.some(u=>u.endsWith('/local-price'))).toBe(true);
    expect(calls.some(u=>u.endsWith('/activate'))).toBe(true);
  });

  test('prix publié : le changement passe par le writer atomique',async({page})=>{
    await mount(page);
    const tr=page.locator('tr[data-product-ref="KPR-2"]');
    await tr.locator('input').fill('30000');
    await expect(tr).toContainText('Au-dessus du repère haut');
    await tr.getByRole('button',{name:'Appliquer le prix'}).click();
    await expect.poll(()=>page.evaluate(()=>window.__catalogReloads)).toBe(1);
    const calls=await page.evaluate(()=>window.__catalogCalls);
    const change=calls.find(c=>c.url.endsWith('/change-active'));
    expect(change).toBeTruthy();
    expect(change.options.body).toEqual({amount:30000,expected_amount:25000,acknowledged_risk:false});
    expect(calls.some(c=>c.url.endsWith('/local-price')&&c.options.method==='POST')).toBe(false);
  });
});
