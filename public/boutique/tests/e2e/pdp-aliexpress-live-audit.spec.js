/** @test-kind e2e @test-runner playwright @test-requires remote-webapp */
'use strict';
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { BASE_URL, waitForModalOpen, closeModal } = require('./helpers/boutique.helpers');

const REFS = ['KPR-131413','KPR-131414','KPR-131415','KPR-131416','KPR-131417'];
const VIEWPORTS = [
  ['m360',360,800], ['m390',390,844], ['m412',412,915], ['m430',430,932], ['d1280',1280,800],
];
const OUT = path.join(process.cwd(), 'test-results', 'pdp-live-audit');
const ENGLISH = /\b(color|size|length|choose|add to cart|buy now|standard shipping|ships from|quantity|black|white|blue|green|pink|red)\b/gi;

function push(a,severity,code,message,evidence=null){ a.push({severity,code,message,evidence}); }
function outDir(ref,v){ const d=path.join(OUT,ref,v); fs.mkdirSync(d,{recursive:true}); return d; }
function write(d,n,v){ fs.writeFileSync(path.join(d,n),JSON.stringify(v,null,2)); }

async function catalog(request){
  const r=await request.get(new URL('/api/products?market=KM&limit=1000',BASE_URL).toString());
  return {status:r.status(), body:await r.json()};
}
async function detail(request,id){
  const r=await request.get(new URL(`/api/products/${id}/detail?market=KM`,BASE_URL).toString());
  return {status:r.status(), body:await r.json()};
}
async function openPdp(page,p){
  await page.goto(`${BASE_URL}${BASE_URL.includes('?')?'&':'?'}market=KM`,{waitUntil:'domcontentloaded'});
  const input=page.locator('#k-search-input');
  await input.fill(p.name);
  const dd=page.locator('#k-search-dropdown');
  await expect(dd).toHaveClass(/open/,{timeout:8000});
  const item=dd.locator('.k-search-item').filter({hasText:p.name}).first();
  await expect(item).toBeVisible({timeout:8000});
  await item.click();
  await waitForModalOpen(page);
}
async function dom(page){
  return page.evaluate(()=>{
    const rect=(e)=>{ if(!e)return null; const r=e.getBoundingClientRect(); return {top:r.top,right:r.right,bottom:r.bottom,left:r.left,width:r.width,height:r.height}; };
    const q=(s)=>document.querySelector(s);
    const add=q('#k-add-cart-btn'), buy=q('#k-buy-now-btn'), msg=q('#k-modal-selection-message'), overlay=q('#k-modal-overlay');
    return {
      viewport:{width:innerWidth,height:innerHeight},
      width:{scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth},
      modal:rect(q('#k-modal')), scroll:rect(q('.k-modal-scroll')), actions:rect(q('.k-modal-actions')),
      identity:{name:q('#k-modal-name')?.textContent?.trim()||'',ref:q('#k-modal-ref')?.textContent?.trim()||'',price:q('#k-modal-price')?.textContent?.trim()||''},
      add:{disabled:!!add?.disabled,text:add?.textContent?.trim()||'',rect:rect(add)},
      buy:{disabled:!!buy?.disabled,text:buy?.textContent?.trim()||'',rect:rect(buy)},
      message:{hidden:!!msg?.hidden,text:msg?.textContent?.trim()||''},
      options:[...document.querySelectorAll('#k-modal-overlay [data-axis-key]')].map(a=>({key:a.dataset.axisKey,label:a.querySelector('.k-vg-label')?.textContent?.replace(/\s+/g,' ').trim()||'',values:[...a.querySelectorAll('button[data-option-value]')].map(b=>({value:b.dataset.optionValue,state:b.dataset.optionState,selected:b.getAttribute('aria-pressed')==='true'}))})),
      images:[...document.querySelectorAll('#k-modal-overlay img')].map(i=>({src:i.currentSrc||i.src,alt:i.alt,w:i.naturalWidth,h:i.naturalHeight})),
      text:(overlay?.innerText||'').replace(/\s+/g,' ').trim(),
    };
  });
}
async function selectUnit(page,u){
  for(const [axis,value] of Object.entries(u.option_values||{})){
    const b=page.locator(`[data-axis-key="${axis}"] button[data-option-value="${value}"]`).first();
    if(await b.count()===0) return {ok:false,missing:`${axis}=${value}`};
    await b.click();
  }
  return {ok:true,add:await page.locator('#k-add-cart-btn').isEnabled().catch(()=>false),buy:await page.locator('#k-buy-now-btn').isEnabled().catch(()=>false),price:(await page.locator('#k-modal-price').textContent().catch(()=>''))?.trim()||'',message:(await page.locator('#k-modal-selection-message').textContent().catch(()=>''))?.trim()||''};
}

async function audit(page,request,ref,vp){
  const findings=[], dir=outDir(ref,vp[0]), consoleErrors=[], pageErrors=[], failed=[], http=[];
  page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text());});
  page.on('pageerror',e=>pageErrors.push(e.message));
  page.on('requestfailed',r=>failed.push({url:r.url(),error:r.failure()?.errorText||''}));
  page.on('response',r=>{if(r.status()>=400&&new URL(r.url()).origin===new URL(BASE_URL).origin)http.push({status:r.status(),url:r.url()});});

  const c=await catalog(request); if(c.status!==200)push(findings,'P0','CATALOG_HTTP',`HTTP ${c.status}`);
  const p=(c.body.products||[]).find(x=>x.product_ref===ref);
  if(!p){push(findings,'P0','CATALOG_MISSING',`${ref} absent du catalogue KM`);write(dir,'report.json',{findings});return findings;}
  const d=await detail(request,p.id); if(d.status!==200)push(findings,'P0','DETAIL_HTTP',`HTTP ${d.status}`);
  const x=d.body||{}; write(dir,'api-product.json',p); write(dir,'api-detail.json',x);

  if(x.product?.reference!==ref)push(findings,'P0','REF_MISMATCH','référence API incohérente',{expected:ref,actual:x.product?.reference});
  if(x.inventory_model!=='SKU')push(findings,'P0','LEGACY_INVENTORY',`inventory_model=${x.inventory_model}`);
  if(!x.product?.description||x.product.description.trim().length<20)push(findings,'P1','DESCRIPTION_WEAK','description absente/trop courte');
  if(!x.pricing?.price_kmf||x.pricing.price_kmf<=0)push(findings,'P0','PRICE_INVALID','prix API invalide',x.pricing);
  if(!Array.isArray(x.media)||!x.media.length)push(findings,'P0','NO_MEDIA','aucun média API');
  if(x.inventory_model==='SKU'&&(!Array.isArray(x.sellable_units)||!x.sellable_units.length))push(findings,'P0','NO_SELLABLE_UNITS','SKU sans unité vendable');

  await page.setViewportSize({width:vp[1],height:vp[2]});
  try{await openPdp(page,p);}catch(e){push(findings,'P0','OPEN_FAILED',e.message);write(dir,'report.json',{findings});return findings;}
  await page.screenshot({path:path.join(dir,'01-top.png'),fullPage:false});
  let s=await dom(page); write(dir,'dom-initial.json',s);

  if(s.width.scroll>s.width.client+1)push(findings,'P1','HORIZONTAL_OVERFLOW','débordement horizontal',s.width);
  if(!s.identity.name)push(findings,'P0','NAME_MISSING','nom absent');
  if(!s.identity.ref.includes(ref))push(findings,'P1','REF_NOT_VISIBLE','référence non visible',s.identity.ref);
  if(!s.identity.price)push(findings,'P0','PRICE_MISSING','prix non visible');
  if(!s.images.length)push(findings,'P0','NO_DOM_IMAGES','aucune image rendue');
  s.images.forEach(i=>{if(!i.src||i.w===0||i.h===0)push(findings,'P1','BROKEN_IMAGE','image non chargée',i);});
  const en=[...new Set((s.text.match(ENGLISH)||[]).map(z=>z.toLowerCase()))]; if(en.length)push(findings,'P1','ENGLISH_RESIDUE','anglais visible',en);
  s.options.forEach(a=>{if(!a.key||!a.values.length)push(findings,'P0','BROKEN_AXIS','axe variante incomplet',a);});
  if(!s.message.hidden&&/achat désactivé/i.test(s.message.text)&&(!s.add.disabled||!s.buy.disabled))push(findings,'P0','CTA_CONTRADICTION','message bloqué mais CTA actifs',{message:s.message,add:s.add,buy:s.buy});
  if(!s.message.hidden&&/achat désactivé/i.test(s.message.text))push(findings,'P1','DISABLED_VISUAL','CTA disabled à valider visuellement',{add:s.add,buy:s.buy});

  const units=Array.isArray(x.sellable_units)?x.sellable_units:[];
  const available=units.filter(u=>u.stock_status!=='OUT_OF_STOCK'&&Number(u.available_quantity)>0);
  const out=units.filter(u=>u.stock_status==='OUT_OF_STOCK'||Number(u.available_quantity)===0);
  for(const u of available.slice(0,12)){
    const st=await selectUnit(page,u);
    if(!st.ok)push(findings,'P0','OPTION_MISSING',`option DOM absente pour ${u.sku}`,st);
    else if(!st.add||!st.buy)push(findings,'P0','AVAILABLE_NOT_BUYABLE',`SKU disponible mais bloqué ${u.sku}`,st);
  }
  for(const u of out.slice(0,8)){
    const st=await selectUnit(page,u);
    if(st.ok&&(st.add||st.buy))push(findings,'P0','OUT_OF_STOCK_BUYABLE',`SKU rupture achetable ${u.sku}`,st);
  }

  const scroll=page.locator('.k-modal-scroll'); if(await scroll.count())await scroll.evaluate(e=>{e.scrollTop=e.scrollHeight;});
  await page.screenshot({path:path.join(dir,'02-bottom.png'),fullPage:false});
  await page.screenshot({path:path.join(dir,'03-full.png'),fullPage:true});
  s=await dom(page); write(dir,'dom-final.json',s);

  if(consoleErrors.length)push(findings,'P1','CONSOLE_ERRORS',`${consoleErrors.length} erreur(s) console`,consoleErrors);
  if(pageErrors.length)push(findings,'P0','PAGE_ERRORS',`${pageErrors.length} erreur(s) page`,pageErrors);
  if(failed.length)push(findings,'P1','REQUEST_FAILED',`${failed.length} requête(s) échouée(s)`,failed);
  if(http.length)push(findings,'P1','HTTP_ERRORS',`${http.length} réponse(s) >=400`,http);
  write(dir,'report.json',{ref,viewport:vp,inventory_model:x.inventory_model,sellable_units:units.length,available_units:available.length,findings,consoleErrors,pageErrors,failed,http});
  await closeModal(page).catch(()=>{});
  return findings;
}

test.describe('AliExpress live PDP exhaustive audit',()=>{
  test.skip(process.env.PDP_LIVE_AUDIT!=='1','PDP_LIVE_AUDIT=1 required');
  test.setTimeout(180000);
  for(const vp of VIEWPORTS)for(const ref of REFS)test(`${ref} @ ${vp[0]}`,async({page,request})=>{
    const findings=await audit(page,request,ref,vp);
    const p0=findings.filter(f=>f.severity==='P0');
    expect(p0,JSON.stringify(p0,null,2)).toEqual([]);
  });
});
