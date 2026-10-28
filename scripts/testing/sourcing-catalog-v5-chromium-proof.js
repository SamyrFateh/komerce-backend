'use strict';
// DOM/Chromium certification of the exact Sourcing/Catalogue V5 components.
// Strictly isolated fixtures; no staging mutations, prices or publication.
const {chromium}=require('@playwright/test');
const assert=require('node:assert/strict');
const path=require('node:path'), fs=require('node:fs');
const root=path.resolve(__dirname,'../..'), output=path.join(root,'test-results/sourcing-catalog-v5');
fs.mkdirSync(output,{recursive:true});
const payload={
  summary:{candidates_total:3,candidates_scanned:1,candidates_promoted:1,imports:1,sourcing_suppliers:1},
  candidates:[
    {candidate_ref:'KSC-NEW',supplier_name:'CJ',product_name:'Protection de téléphone',state:'raw_imported',
      purchase_price:20,currency:'AED',estimated_weight_kg:0.2},
    {candidate_ref:'KSC-SCANNED',supplier_name:'AliExpress',product_name:'Câble USB',state:'scanned',
      scan_at:'2026-10-28T10:00:00Z',scan_result:{sourcing_decision:'TEST'},
      purchase_price:7,currency:'AED'},
    {candidate_ref:'KSC-HANDOFF',product_ref:'KPR-0092',supplier_name:'CJ',
      product_name:'Produit transféré',state:'imported_to_catalog'},
  ],
  imports:[{import_ref:'IMP1',supplier_name:'CJ',source_type:'manual',status:'complete',total_items:1}],
  portfolio:{products:[{product_ref:'KPR-0092',name:'Produit remis',sourcing_rail:'A',cost_price_kmf:300}]},
  suppliers:[{partner_ref:'P-CJ',name:'CJ',country_code:'AE',is_active:true}],
  sources:[],connectors:{},
};
const catalog={
  scope:{mode:'global_catalog_registry'},
  categories:[{key:'tech',label:'Tech',is_active:true,subcategories:[{key:'phones',label:'Téléphones',is_active:true}]}],
  products:[{product_ref:'P-FINALIZED',name:'Produit validé',supplier_name:'CJ',
    lifecycle_status:'active',is_active:true,work_status:'catalog_approved',
    issues:[],boutique_category_key:'tech',boutique_subcategory_key:'phones',
    boutique_category_label:'Tech',boutique_subcategory_label:'Téléphones'}],
  registry_page:{total:1,limit:50,offset:0,has_previous:false,has_next:false},
  commercial_products:[],approval:[],summary:{},curation:{},
};
const html='<html lang="fr"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body class="kmc-shell-v4"><main id="canonical-admin-root"></main></body></html>';
async function mount(page,kind,search){
 await page.setContent(html);
 await page.addStyleTag({content:'*,*:before,*:after{box-sizing:border-box}body,html{margin:0;max-width:100%;}main{min-width:0;width:100%;max-width:100%;padding:12px}'});
 for(const file of ['operations-workspace.css','catalog-workspace-wide-v1.css','sourcing-finish-v5.css'])
  await page.addStyleTag({path:path.join(root,'public/dashboards/canonical/css',file)});
 await page.addScriptTag({path:path.join(root,'public/dashboards/canonical/js',kind+'-workspace.js')});
 return page.evaluate(async ({kind,search,payload})=>{
   const doc=document;
   const Section={create({title,description}){
     const element=doc.createElement('section');element.className='kmc-section';
     const head=doc.createElement('header');
     head.appendChild(Object.assign(doc.createElement('h2'),{textContent:title}));
     if(description)head.appendChild(Object.assign(doc.createElement('p'),{textContent:description}));
     element.appendChild(head);
     const slot=doc.createElement('div');slot.className='kmc-section-body';element.appendChild(slot);
     return {element,slot};
   }};
   const ui={Section,MetricStrip:{render(slot,config){
     const list=doc.createElement('div');list.className='kmc-test-metrics';
     list.textContent=(config.items||[]).map(x=>x.label+' '+x.value).join(' · ');
     slot.appendChild(list);
   }}};
   window.__mutationCalls=[];
   const fetch=async(url,opts={})=>{
      if(opts.method&&opts.method!=='GET'){
        window.__mutationCalls.push(url);throw new Error('Mutation prohibited in visual certification');
      }
      return {ok:true,status:200,json:async()=>payload};
   };
   if(kind==='sourcing')return window.KomerceCanonicalSourcingWorkspace.mount({
     root:doc.querySelector('main'),document:doc,ui,fetch,
     locationSearch:search,confirm:()=>false,prompt:()=>null,
   });
   return window.KomerceCanonicalCatalogWorkspace.mount({
     root:doc.querySelector('main'),document:doc,ui,fetch,
     location:{search},confirm:()=>false,prompt:()=>null,
   });
 },{kind,search,payload:kind==='sourcing'?payload:catalog});
}
async function check(page,width){
 await page.setViewportSize({width,height:900});
 await mount(page,'sourcing','');
 const tabs=page.getByRole('tab');
 assert.deepEqual(await tabs.allTextContents(),[
   'À qualifier · 2','Imports & découvertes · 1',
   'Portefeuille sourcing · 1','Fournisseurs · 1']);
 assert.equal(await tabs.nth(0).getAttribute('aria-selected'),'true');
 assert.equal(await page.locator('tr[data-candidate-ref]').count(),2);
 const row=page.locator('tr[data-candidate-ref="KSC-NEW"]');
 const primary=row.locator('td:last-child > [data-workspace-action]');
 assert.equal(await primary.count(),1);
 assert.equal(await primary.getAttribute('data-workspace-action'),'scan-candidate');
 const second=page.locator('tr[data-candidate-ref="KSC-SCANNED"] td:last-child > [data-workspace-action]');
 assert.equal(await second.getAttribute('data-workspace-action'),'classify-boutique');
 const more=row.locator('.kmc-sourcing-row-more');
 await more.locator('summary').click();
 assert((await more.locator('[data-workspace-action="promote-candidate"]').count())===1);
 assert((await more.locator('[data-workspace-action="reject-candidate"]').count())===1);
 await page.screenshot({path:path.join(output,'sourcing-queue-'+width+'.png'),fullPage:true});
 await tabs.nth(1).click();
 assert.equal(await page.locator('#kmc-sourcing-panel-candidates').isVisible(),false);
 assert.equal(await page.locator('#kmc-sourcing-panel-imports').isVisible(),true);
 assert((await page.locator('#kmc-sourcing-panel-imports').innerText()).includes('Lancer un import'));
 await page.screenshot({path:path.join(output,'sourcing-imports-'+width+'.png'),fullPage:true});
 await tabs.nth(3).click();
 assert((await page.locator('#kmc-sourcing-panel-suppliers').innerText()).includes('Fournisseurs sourcing'));
 assert.equal(await page.evaluate(()=>window.__mutationCalls.length),0);

 await mount(page,'catalog','?product_ref=P-FINALIZED');
 assert.equal(await page.locator('[data-focused-product-result="visible"]').count(),1);
 assert.equal(await page.locator('.kmc-catalog-context-target').count(),1);
 assert.equal(await page.locator('[data-workspace-action="refinery-correct-active-fr"]').count(),0);
 await page.screenshot({path:path.join(output,'catalog-focused-'+width+'.png'),fullPage:true});
 await mount(page,'catalog','?product_ref=P-HISTORICAL');
 assert.equal(await page.locator('[data-focused-product-result="not-in-page"]').count(),1);
 assert((await page.locator('[data-focused-product-result]').innerText()).includes('ne signifie ni rejet ni dépublication'));
 assert.equal(await page.locator('a[href*="view=refinery"]').count(),1);
 await page.screenshot({path:path.join(output,'catalog-unlisted-'+width+'.png'),fullPage:true});
 const dimensions=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth}));
 assert(dimensions.scrollWidth<=dimensions.width+2,'outer overflow '+JSON.stringify(dimensions));
 return {width,tabs:4,primaryActions:2,catalogueFocus:true,noBusinessMutation:true};
}
async function main(){
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try{const page=await browser.newPage();const results=[];for(const w of [1440,390])results.push(await check(page,w));console.log(JSON.stringify({verdict:'PASS',scenario:'Sourcing/Catalogue finishing V5',results}));}
 finally{await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1});
