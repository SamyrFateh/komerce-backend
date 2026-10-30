'use strict';
// Isolated Chromium acceptance of Catalogue global -> explicit market selection.
// Mocks API data; no staging, money or mutations.
const assert=require('node:assert/strict');
const {chromium}=require('@playwright/test');
const path=require('node:path');
const fs=require('node:fs');
const root=path.resolve(__dirname,'../..');
const output=path.join(root,'test-results','market-handoff-v4');
fs.mkdirSync(output,{recursive:true});
const P='KPR-000092';
const HTML='<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body class="kmc-shell-v4"><main id="market-catalog-root"></main></body></html>';
async function run(page,width,selected=false,emptyQueue=false,denied=false){
  await page.setViewportSize({width,height:900});
  const qs=selected?'?product_ref='+P+'&market=KM':'?product_ref='+P;
  await page.route('https://komerce.test/**',route=>route.fulfill({status:200,contentType:'text/html',body:HTML}));
  await page.goto('https://komerce.test/dashboards/canonical/market-catalog.html'+qs);
  await page.addStyleTag({content:'html,body{margin:0;width:100%;}*{box-sizing:border-box}#market-catalog-root{padding:18px;max-width:100%;}a,button{cursor:pointer}'});
  await page.addStyleTag({path:path.join(root,'public/dashboards/canonical/css/market-handoff-v4.css')});
  await page.addStyleTag({path:path.join(root,'public/dashboards/canonical/css/market-catalog-essential.css')});
  await page.addScriptTag({path:path.join(root,'public/dashboards/canonical/js/admin-context.js')});
  await page.addScriptTag({path:path.join(root,'public/dashboards/canonical/js/market-prompt.js')});
  await page.addScriptTag({path:path.join(root,'public/dashboards/canonical/js/market-ready-to-sell.js')});
  await page.addScriptTag({path:path.join(root,'public/dashboards/canonical/js/market-product-register.js')});
  await page.evaluate(({P,emptyQueue,denied})=>{
    window.__calls=[];
    window.__writes=[];
    window.__published=false;
    window.__priceActive=false;
    window.fetch=async (url,options={})=>{
      window.__calls.push(url);
      const method=options.method||'GET';
      if(method!=='GET')window.__writes.push({url,method,body:options.body});
      if(url.endsWith('/activate')&&method==='POST'){
        window.__published=true;window.__priceActive=true;
      }
      if(url.includes('/catalog/exposure/')&&method==='PUT')
        window.__published=options.body?.commercial_exposure==='ENABLED';
      const body=url.includes('/activation-preview')?{
        activation:{allowed:true},economics:{
          variable_cost_complete_kmf:800,cdr_complete_kmf:1000,
          estimated_margin_pct:25,strategy_risk:'contributive',
        },
      }:url.includes('/commercial-prices')?{
        market:{code:'KM',currency:'KMF'},products:emptyQueue?[]:[{
          product_ref:P,local_price:1500,
          decision_status:window.__priceActive?'LOCAL_ACTIVE':'DRAFT_PENDING_GATE',
        }],
      }:url==='/api/auth/me'?{id:'admin',role:'admin'}:
        url==='/api/market-delegation/catalog/authorized-markets'?{market_codes:denied?[]:['CG','CM','KM']}:
        url==='/api/admin/dashboard/context'?{
          actor:{id:'admin',role:'admin'},
          access:{mode:'global',allowedMarkets:['CG','CM','KM'],defaultMarket:null,capabilities:[]},
        }:{
          market:{name:'Comores',currency:'KMF'},
          exposure:emptyQueue?[]:[{
            product_id:'test-p',product_ref:P,product_name:'Produit approuvé',
            category:'Tech',subcategory:'Téléphones',sku:'TEST-SKU',
            commercial_exposure:window.__published?'ENABLED':'DISABLED',
            decision_recorded:window.__published,
            is_available:true,needs_review:false,
          }],
          actor_capabilities:['catalog.read','pricing.read','pricing.decide','pricing.activate','catalog.expose'],
          ready_to_sell:{summary:{ready:0,review:0,blocked:0},items:[]},
        };
      return {ok:true,status:200,json:async()=>body};
    };
    window.KomerceCanonicalNavigation={mount(){}};
    window.KomerceMarketCatalogDecision={
      decisionItems:()=>[],priorityRows:()=>[],metricItems:()=>[],
      exposureStatus:()=>({label:'—'}),qualityStatus:()=>({label:'—'}),
    };
    window.KomerceDecisionUI={};
    window.KomerceCanonicalUI={MetricStrip:{render(host){host.textContent='KPI test';}}};
  },{P,emptyQueue,denied});
  await page.addScriptTag({path:path.join(root,'public/dashboards/canonical/js/market-catalog.js')});
  if(denied){
    const card=page.locator('[data-market-handoff="choose"]');
    await card.waitFor();
    assert.equal(await card.locator('[data-handoff-market]').count(),0);
    assert.equal(await card.locator('[data-market-inaccessible]').count(),3);
    assert((await page.locator('#market-catalog-root').innerText()).includes('Aucune habilitation Catalogue pays active'));
    if(selected){
      assert((await page.locator('#market-catalog-root').innerText()).includes('Habilitation marché requise'));
    }
    const calls=await page.evaluate(()=>window.__calls);
    assert.equal(calls.filter(url=>url.includes('/markets/KM/catalog/exposure')).length,0);
  }else if(!selected){
    const card=page.locator('[data-market-handoff="choose"]');
    await card.waitFor();
    assert((await card.innerText()).includes(P));
    const links=await card.locator('[data-handoff-market]').evaluateAll(nodes=>nodes.map(n=>({m:n.dataset.handoffMarket,href:n.href})));
    assert.deepEqual(links.map(x=>x.m),['CG','CM','KM']);
    assert(links.every(x=>x.href.includes('product_ref='+P)));
    assert.equal((await page.evaluate(()=>window.__calls)).filter(x=>String(x).includes('/markets/')).length,0);
    assert((await card.innerText()).includes('Aucun marché n’est choisi automatiquement'));
  }else{
    const card=page.locator('[data-market-handoff="selected"]');
    await card.waitFor();
    assert((await card.innerText()).includes(P+' · KM'));
    const calls=await page.evaluate(()=>window.__calls);
    assert(calls.some(x=>x.includes('/markets/KM/catalog/exposure')));
    assert(!calls.some(x=>x.includes('/markets/CG/')||x.includes('/markets/CM/')));
    if(!emptyQueue){
      await page.locator('[data-market-product-ref="'+P+'"]').waitFor();
      const row=page.locator('[data-market-product-ref="'+P+'"]');
      assert((await card.innerText()).includes('Son prix et sa publication se décident'));
      assert.equal(await row.locator('[role="switch"]').count(),1);
      assert.equal(await row.locator('.kmc-market-price-input').inputValue(),'1500');
      assert.equal(await row.locator('[role="switch"]').isChecked(),false);
      if(width===1440){
        // Price save is not publication. Verify actual network mutation order.
        await row.getByRole('button',{name:'Enregistrer le prix'}).click();
        await page.waitForFunction(()=>window.__writes.some(x=>x.method==='POST'
          &&x.url.endsWith('/local-price')));
        const beforePublication=await page.evaluate(()=>window.__writes);
        assert.equal(beforePublication.filter(x=>x.url.endsWith('/activate')).length,0);
        assert.equal(await page.locator('[data-market-product-ref="'+P+'"] [role="switch"]').isChecked(),false);
        const activeRow=page.locator('[data-market-product-ref="'+P+'"]');
        await activeRow.locator('[role="switch"]').check();
        await page.waitForFunction(()=>window.__writes.some(x=>x.url.endsWith('/activate')));
        await page.locator('[data-market-product-ref="'+P+'"] [role="switch"]:checked').waitFor();
        const afterPublication=await page.evaluate(()=>window.__writes);
        assert(afterPublication.some(x=>x.url.endsWith('/activate')));
        assert.equal(afterPublication.filter(x=>x.url.endsWith('/reset')).length,0);
        await page.screenshot({path:path.join(output,'prix-local-et-publication-on-1440.png'),fullPage:true});
        await page.locator('[data-market-product-ref="'+P+'"] [role="switch"]').uncheck();
        await page.waitForFunction(()=>window.__writes.some(x=>x.method==='PUT'
          &&x.body?.commercial_exposure==='DISABLED'));
        await page.locator('[data-market-product-ref="'+P+'"] [role="switch"]:not(:checked)').waitFor();
        const finalState=await page.evaluate(()=>({
          published:window.__published,activePrice:window.__priceActive,
        }));
        assert.deepEqual(finalState,{published:false,activePrice:true});
      }
    }else{
      assert((await card.innerText()).includes('n’est pas actuellement dans la liste'));
      assert((await card.innerText()).includes('sans déduire un refus'));
    }
  }
  const dims=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));
  assert(dims.scroll<=dims.width+2,'page overflow '+JSON.stringify(dims));
  await page.screenshot({path:path.join(output,(selected?'selected':'choose')+'-'+width+(emptyQueue?'-empty':'')+(denied?'-access-denied':'')+'.png'),fullPage:true});
  return {width,selected,emptyQueue,denied,overflow:false};
}
async function main(){
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try{
  const page=await browser.newPage();
  const results=[];
  for(const width of [1440,390]){
    results.push(await run(page,width,false));
    results.push(await run(page,width,true,false));
    results.push(await run(page,width,true,true));
    results.push(await run(page,width,false,false,true));
    results.push(await run(page,width,true,false,true));
  }
  console.log(JSON.stringify({verdict:'PASS',suite:'market-handoff-v4',results}));
 }finally{await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1});
