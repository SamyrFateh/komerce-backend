'use strict';
/**
 * Isolated Chromium smoke proof of the real Canonical Raffinerie/Catalogue JS.
 * No network, credentials, staging, user accounts or business mutations.
 */
const { chromium } = require('@playwright/test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const css = relative => path.join(root, 'public/dashboards/canonical/css', relative);
const script = path.join(root, 'public/dashboards/canonical/js/catalog-workspace.js');
const out = path.join(root, 'test-results', 'refinery-v4');
fs.mkdirSync(out, { recursive: true });

const refineryPayload = {
  scope: { mode:'refinery_preparation' },
  approval: [],
  approval_page: {total:0,limit:50,offset:0,has_previous:false,has_next:false},
  refinery: {
    coverage: {
      in_approval_queue:0, unprepared_candidates:1, active_recheck:1,
      handoff_already_active:2, active_products:2, rejected_products:0,
    },
    unprepared: [{
      product_ref:'P-DRAFT', name:'Téléphone à qualifier', candidate_ref:'SC-DRAFT',
      supplier_name:'CJ', reason:{label:'Source du contenu à qualifier',detail:'Origine éditoriale absente'},
    }],
    unprepared_page:{total:1,limit:30,offset:0,has_previous:false,has_next:false},
    recheck: [{
      product_ref:'P-RECHECK', name:'Coque à revoir', supplier_name:'CJ',
      issues:['editorial_to_complete'], lifecycle_status:'active', is_active:true,
    }],
    recheck_page:{total:1,limit:30,offset:0,has_previous:false,has_next:false},
  },
};
const catalogPayload = {
  scope: { mode:'global_catalog_registry' },
  categories:[{key:'tech',label:'Tech',is_active:true,
    subcategories:[{key:'phones',label:'Téléphones',is_active:true}]}],
  products:[{
    product_ref:'P-FINALIZED',name:'Coque finalisée',supplier_name:'CJ',supplier_product_id:'S-101',
    supplier_category:'Accessoires',boutique_category_key:'tech',boutique_subcategory_key:'phones',
    boutique_category_label:'Tech',boutique_subcategory_label:'Téléphones',
    work_status:'catalog_approved',lifecycle_status:'active',is_active:true,
    issues:[],supplier_image_preview:false,needs_review:false,
  }],
  registry_page:{total:1,limit:50,offset:0,has_previous:false,has_next:false},
  commercial_products:[],approval:[],summary:{},curation:{},
};

async function check(page, kind, width) {
  await page.setViewportSize({width,height:900});
  await page.setContent('<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body class="kmc-shell-v4"><main id="canonical-admin-root"></main></body></html>');
  await page.addStyleTag({content: '*,*::before,*::after{box-sizing:border-box} html,body{margin:0;width:100%;max-width:100%;} main{max-width:100%;min-width:0;padding:10px;} '});
  await page.addStyleTag({path:css('operations-workspace.css')});
  await page.addStyleTag({path:css('catalog-workspace-wide-v1.css')});
  await page.addStyleTag({path:css('refinery-workspace-v4.css')});
  await page.addScriptTag({path:script});
  const payload=kind==='refinery'?refineryPayload:catalogPayload;
  const text = await page.evaluate(async ({kind,payload}) => {
    const doc=document,root=doc.querySelector('#canonical-admin-root');
    const Section={
      create({title,description}) {
        const section=doc.createElement('section'); section.className='kmc-section';
        const heading=doc.createElement('header'); heading.className='kmc-section-header';
        heading.appendChild(Object.assign(doc.createElement('h2'),{textContent:title}));
        if(description) heading.appendChild(Object.assign(doc.createElement('p'),{textContent:description}));
        section.appendChild(heading);
        const slot=doc.createElement('div'); slot.className='kmc-section-body';
        section.appendChild(slot);
        return {element:section,slot};
      },
    };
    window.__refineryCalls=[];
    const result=await window.KomerceCanonicalCatalogWorkspace.mount({
      root,document:doc,ui:{Section},
      location:{search:kind==='refinery'?'?view=refinery&diagnostic=1':''},
      fetch:async(url,options={})=>{
        if(options.method==='POST'){
          window.__refineryCalls.push({url,body:JSON.parse(options.body||'{}')});
          return {ok:true,status:200,json:async()=>({ok:true,action:'refinery_active_editorial_recheck'})};
        }
        return {ok:true,status:200,json:async()=>payload};
      },
    });
    return {visible:root.innerText,result:!!result,view:kind};
  },{kind,payload});
  assert.equal(text.result,true);
  if(kind==='refinery') {
    for(const label of ['Préparation automatique','Brouillons suivis',
      'Remises historiques actives','Ouvrir les fiches dans le Catalogue']) {
      assert(text.visible.includes(label), 'Monitoring missing '+label+' at '+width+'px');
    }
    for(const removed of ['Produits actifs à réexaminer','Fiches à qualifier',
      'En attente de contrôle et validation','Corriger la fiche FR']) {
      assert(!text.visible.includes(removed), 'Obsolete manual action '+removed);
    }
  } else {
    assert(text.visible.includes('P-FINALIZED'));
    assert(!text.visible.includes('P-RECHECK'));
    assert(!text.visible.includes('P-DRAFT'));
    assert(!text.visible.includes('Préparer en français'));
  }
  const dims=await page.evaluate(()=>({
    scrollWidth:document.documentElement.scrollWidth,
    innerWidth:window.innerWidth,
    wrappers:[...document.querySelectorAll('.kmc-workspace-table-wrap')].map(x=>({
      scrollWidth:x.scrollWidth,clientWidth:x.clientWidth,
    })),
  }));
  assert(dims.scrollWidth<=dims.innerWidth+2,
    `${kind} ${width}px outer horizontal overflow ${JSON.stringify(dims)}`);
  await page.screenshot({path:path.join(out,`${kind}-${width}.png`),fullPage:true});
  if(kind==='refinery') {
    assert.equal(await page.locator('[data-workspace-action="refinery-correct-active-fr"]').count(),0);
    assert.equal(await page.locator('[data-workspace-action="approve"]').count(),0);
    assert.equal(await page.locator('.kmc-refinery-unprepared-table').count(),0);
    assert.equal(await page.evaluate(()=>window.__refineryCalls.length),0);
  }
  return {kind,width,overflow:false,scrollableTables:dims.wrappers.filter(x=>x.scrollWidth>x.clientWidth).length};
}

async function main() {
  const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  try {
    const page=await browser.newPage({viewport:{width:1440,height:900}});
    const results=[];
    for(const width of [1440,390]){
      for(const kind of ['refinery','catalog']){
        results.push(await check(page,kind,width));
      }
    }
    console.log(JSON.stringify({verdict:'PASS',browser:'Chromium',mode:'isolated UI fixture',results}));
  } finally { await browser.close(); }
}
main().catch(error=>{console.error(error);process.exitCode=1});
