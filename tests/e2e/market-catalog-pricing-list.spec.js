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
  landed_relay_cost_local:14800,business_variable_cost_local:1200,variable_cost_local:16000,minimum_safe_price_local:17600,
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
        landed_relay_cost_local:14800,business_variable_cost_local:1200,variable_cost_local:16000,minimum_safe_price_local:17600,contribution_at_proposed_local:9000,
        cost_allocation_trace: {
          status: 'ESTIMATED_NOT_RECONCILED', authority: 'SERVER_PRICING_ENGINE', currency:'KMF',
          hypotheses:{articles_per_order:2.5,articles_per_parcel:4,articles_per_shipment:200,confidence:'low'},
          lines:[
            {family:'N1',key:'product_purchase',label:'Achat fournisseur',unit_cost_kmf:12000,components:[],non_itemized_kmf:12000,allocation_discrepancy:false},
            {family:'N1',key:'freight',label:'Fret / transit',unit_cost_kmf:2000,components:[{label:'Fret au poids',level:'article',basis:'weight',engaged_kmf:2000,divisor:1,allocated_kmf:2000,confidence:'high'}],non_itemized_kmf:0,allocation_discrepancy:false},
            {family:'N1',key:'packaging',label:'Emballage',unit_cost_kmf:500,components:[{label:'Emballage carton',level:'parcel',basis:'quantity',engaged_kmf:2000,divisor:4,allocated_kmf:500,confidence:'low'}],non_itemized_kmf:0,allocation_discrepancy:false},
            {family:'N1',key:'port_transitary',label:'Port / transitaire',unit_cost_kmf:300,components:[{label:'Transitaire forfait',level:'shipment',basis:'quantity',engaged_kmf:60000,divisor:200,allocated_kmf:300,confidence:'low'}],non_itemized_kmf:0,allocation_discrepancy:false},
            {family:'N2',key:'payment',label:'Paiement / collecte',unit_cost_kmf:800,components:[{label:'Collecte',level:'order',basis:'quantity',engaged_kmf:2000,divisor:2.5,allocated_kmf:800,confidence:'low'}],non_itemized_kmf:0,allocation_discrepancy:false},
            {family:'N2',key:'risk_provision',label:'Provision de risque',unit_cost_kmf:400,components:[],non_itemized_kmf:400,allocation_discrepancy:false},
          ],
        }
      },
      {product_id:'p2',product_ref:'KPR-2',product_name:'Casque déjà publié',
        category:'Audio',catalog_state:'published',decision_recorded:true,
        local_price_active:true,exposure_enabled:true,
        decision_state:{key:'READY',tone:'positive'},can_approve:true,
        proposed_price:{amount:25000,source:'LOCAL_ACTIVE',currency:'KMF'},
        corridor:{low:23000,target:25000,high:28000,status:'READY',sample_count:5},
        landed_relay_cost_local:14800,business_variable_cost_local:1200,variable_cost_local:16000,minimum_safe_price_local:17600,contribution_at_proposed_local:9000,
        cost_allocation_trace: {
          status: 'ESTIMATED_NOT_RECONCILED', authority: 'SERVER_PRICING_ENGINE', currency:'KMF',
          hypotheses:{articles_per_order:2.5,articles_per_parcel:4,articles_per_shipment:200,confidence:'low'},
          lines:[
            {family:'N1',key:'product_purchase',label:'Achat fournisseur',unit_cost_kmf:12000,components:[],non_itemized_kmf:12000,allocation_discrepancy:false},
            {family:'N1',key:'freight',label:'Fret / transit',unit_cost_kmf:2000,components:[{label:'Fret au poids',level:'article',basis:'weight',engaged_kmf:2000,divisor:1,allocated_kmf:2000,confidence:'high'}],non_itemized_kmf:0,allocation_discrepancy:false},
            {family:'N1',key:'packaging',label:'Emballage',unit_cost_kmf:500,components:[{label:'Emballage carton',level:'parcel',basis:'quantity',engaged_kmf:2000,divisor:4,allocated_kmf:500,confidence:'low'}],non_itemized_kmf:0,allocation_discrepancy:false},
            {family:'N1',key:'port_transitary',label:'Port / transitaire',unit_cost_kmf:300,components:[{label:'Transitaire forfait',level:'shipment',basis:'quantity',engaged_kmf:60000,divisor:200,allocated_kmf:300,confidence:'low'}],non_itemized_kmf:0,allocation_discrepancy:false},
            {family:'N2',key:'payment',label:'Paiement / collecte',unit_cost_kmf:800,components:[{label:'Collecte',level:'order',basis:'quantity',engaged_kmf:2000,divisor:2.5,allocated_kmf:800,confidence:'low'}],non_itemized_kmf:0,allocation_discrepancy:false},
            {family:'N2',key:'risk_provision',label:'Provision de risque',unit_cost_kmf:400,components:[],non_itemized_kmf:400,allocation_discrepancy:false},
          ],
        }
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
    const row = surface.locator('tr[data-product-ref="KPR-1"]');
    await expect(row.locator('.kmc-price-landed')).toContainText('14 800 KMF');
    await expect(row.locator('.kmc-price-variable')).toContainText('16 000 KMF');
    await expect(row.locator('.kmc-price-n2')).toHaveText('N2 · Business : 1 200 KMF');
    await expect(row.locator('[data-safety-floor]')).toHaveText('Plancher moteur : 17 600 KMF');
    await expect(row.locator('.kmc-price-contribution')).toContainText('9 000 KMF');
    await row.getByRole('button', { name: 'Voir les quotes-parts N1 / N2' }).click();
    const dialog = row.locator('dialog.kmc-price-detail-box');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('N1 + N2 · Coût variable complet');
    await expect(dialog).toContainText('Les charges fixes N3 sont exclues');
    await expect(dialog).toContainText('2,5 articles / commande');
    await expect(dialog).toContainText('4 articles / colis');
    await expect(dialog).toContainText('200 articles / expédition');
    await expect(dialog).toContainText('confiance : Faible');
    await expect(dialog).toContainText('Transitaire forfait');
    await expect(dialog).toContainText('60 000 KMF');
    await expect(dialog).toContainText('300 KMF');
    await expect(dialog).toContainText('Expédition ÷ 200 articles');
    await expect(dialog).toContainText('Colis ÷ 4 articles');
    await expect(dialog).toContainText('Commande ÷ 2,5 articles');
    await expect(dialog).toContainText('Part non détaillée par le moteur');
    await expect(dialog).toContainText('Fret au poids');
    await expect(dialog).toContainText('Poids du produit');
    await expect(dialog.getByRole('button', { name: 'Fermer la ventilation des coûts' })).toBeVisible();
    expect(await page.evaluate(() => window.__catalogCalls)).toHaveLength(0);
    await dialog.getByRole('button', { name: 'Fermer la ventilation des coûts' }).click();
    await expect(dialog).toBeHidden();
    await row.getByRole('button', { name: 'Voir les quotes-parts N1 / N2' }).click();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

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
    await expect(tr.locator('.kmc-price-action-button')).toBeDisabled();
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
