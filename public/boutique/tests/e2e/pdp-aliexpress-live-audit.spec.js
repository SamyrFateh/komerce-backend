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

function push(list,severity,code,message,evidence=null){ list.push({severity,code,message,evidence}); }
function outDir(ref,viewport){ const dir=path.join(OUT,ref,viewport); fs.mkdirSync(dir,{recursive:true}); return dir; }
function write(dir,name,value){ fs.writeFileSync(path.join(dir,name),JSON.stringify(value,null,2)); }
function esc(value){ return String(value).replace(/\\/g,'\\\\').replace(/"/g,'\\"'); }
function optionSelector(axis,value){ return `[data-axis-key="${esc(axis)}"] button[data-option-value="${esc(value)}"]`; }
function mediaIdentity(url){ return String(url||'').replace(/,w_\d+(?=\/|,)/g,',w_*'); }
function expectedAnonymous401(response){
  if(response.status()!==401)return false;
  try{
    const pathname=new URL(response.url()).pathname;
    return pathname==='/api/auth/me'||pathname==='/api/shared-carts/mine';
  }catch(_){ return false; }
}

async function catalog(request){
  const response=await request.get(new URL('/api/products?market=KM&limit=1000',BASE_URL).toString());
  return {status:response.status(),body:await response.json()};
}
async function detail(request,id){
  const response=await request.get(new URL(`/api/products/${id}/detail?market=KM`,BASE_URL).toString());
  return {status:response.status(),body:await response.json()};
}

async function openPdp(page,product){
  await page.goto(`${BASE_URL}${BASE_URL.includes('?')?'&':'?'}market=KM`,{waitUntil:'domcontentloaded'});
  // Ne jamais taper avant que Boutique ait fini son bootstrap. Le précédent
  // oracle pouvait remplir l'input mobile avant setupSearch(), donnant 20 faux
  // OPEN_FAILED alors que le PDP n'avait même pas encore été sollicité.
  await page.waitForSelector('#k-grid .k-promo-card, #k-grid .k-card',{state:'attached',timeout:12000});
  const input=page.locator('#k-search-input');
  await expect(input).toBeVisible({timeout:5000});
  await input.fill(product.name);
  const dropdown=page.locator('#k-search-dropdown');
  await expect(dropdown).toHaveClass(/open/,{timeout:8000});
  const item=dropdown.locator(`.k-search-item[data-id="${esc(product.id)}"]`).first();
  await expect(item).toBeVisible({timeout:8000});
  await item.click();
  await waitForModalOpen(page);
  await expect(page.locator('#k-modal-name')).toContainText(product.name,{timeout:5000});
}

async function domSnapshot(page){
  return page.evaluate(()=>{
    const rect=(el)=>{ if(!el)return null; const r=el.getBoundingClientRect(); return {top:r.top,right:r.right,bottom:r.bottom,left:r.left,width:r.width,height:r.height}; };
    const q=(selector)=>document.querySelector(selector);
    const add=q('#k-add-cart-btn');
    const buy=q('#k-buy-now-btn');
    const message=q('#k-modal-selection-message');
    const overlay=q('#k-modal-overlay');
    return {
      viewport:{width:innerWidth,height:innerHeight},
      width:{scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth},
      overlayClass:overlay?.className||'',
      modal:rect(q('#k-modal')),
      scroll:rect(q('.k-modal-scroll')),
      actions:rect(q('.k-modal-actions')),
      identity:{
        name:q('#k-modal-name')?.textContent?.trim()||'',
        ref:q('#k-modal-sku')?.textContent?.trim()||'',
        price:q('#k-modal-price')?.textContent?.trim()||'',
      },
      add:{disabled:!!add?.disabled,text:add?.textContent?.trim()||'',rect:rect(add)},
      buy:{disabled:!!buy?.disabled,text:buy?.textContent?.trim()||'',rect:rect(buy)},
      message:{hidden:!!message?.hidden,text:message?.textContent?.trim()||''},
      options:[...document.querySelectorAll('#k-modal-overlay [data-axis-key]')].map(axis=>({
        key:axis.dataset.axisKey,
        label:axis.querySelector('.k-vg-label')?.textContent?.replace(/\s+/g,' ').trim()||'',
        values:[...axis.querySelectorAll('button[data-option-value]')].map(button=>({
          value:button.dataset.optionValue,
          state:button.dataset.optionState,
          selected:button.getAttribute('aria-pressed')==='true',
        })),
      })),
      images:[...document.querySelectorAll('#k-modal-carousel-track .k-modal-slide')].map(img=>({
        src:img.currentSrc||img.src,
        alt:img.alt,
        w:img.naturalWidth,
        h:img.naturalHeight,
      })),
      text:(overlay?.innerText||'').replace(/\s+/g,' ').trim(),
    };
  });
}

async function selectUnit(page,detailContract,unit){
  try{
    for(const axis of detailContract.option_axes||[]){
      const value=unit.option_values?.[axis.key];
      if(value==null)return {ok:false,missing:`${axis.key}=<missing>`};
      const selector=optionSelector(axis.key,value);
      const button=page.locator(selector).first();
      if(await button.count()===0)return {ok:false,missing:`${axis.key}=${value}`};
      await button.click({timeout:4000});
      await expect(page.locator(selector).first()).toHaveAttribute('aria-pressed','true',{timeout:3000});
    }
    const add=page.locator('#k-add-cart-btn');
    const buy=page.locator('#k-buy-now-btn');
    const available=unit.stock_status==='AVAILABLE'&&Number(unit.available_quantity)>0;
    if(available){
      await expect.poll(async()=>({
        add:await add.isEnabled().catch(()=>false),
        buy:await buy.isEnabled().catch(()=>false),
      }),{timeout:3500}).toEqual({add:true,buy:true}).catch(()=>{});
    }
    return {
      ok:true,
      add:await add.isEnabled().catch(()=>false),
      buy:await buy.isEnabled().catch(()=>false),
      ref:(await page.locator('#k-modal-sku').textContent().catch(()=>''))?.trim()||'',
      price:(await page.locator('#k-modal-price').textContent().catch(()=>''))?.trim()||'',
      message:(await page.locator('#k-modal-selection-message').textContent().catch(()=>''))?.trim()||'',
    };
  }catch(error){
    return {ok:false,reason:'interaction-error',error:error.message};
  }
}

async function forceCloseFullscreen(page){
  const root=page.locator('.k-modal-fullscreen.is-open');
  if(await root.count()){
    const close=root.locator('.k-modal-fullscreen-close');
    if(await close.count())await close.click({force:true}).catch(()=>{});
    await page.keyboard.press('Escape').catch(()=>{});
  }
}

async function fullscreenMediaIdentity(page){
  const slides=page.locator('#k-modal-carousel-track .k-modal-slide');
  const count=await slides.count();
  if(count<2)return {skipped:true,count};
  let expected='';
  try{
    const mobile=await page.evaluate(()=>innerWidth<900);
    if(mobile){
      await page.locator('.k-modal-img-wrap').evaluate((wrap)=>{
        const fire=(type,x,y)=>{
          const event=new Event(type,{bubbles:true,cancelable:true});
          Object.defineProperty(event,'touches',{configurable:true,value:type==='touchend'?[]:[{clientX:x,clientY:y}]});
          Object.defineProperty(event,'changedTouches',{configurable:true,value:[{clientX:x,clientY:y}]});
          wrap.dispatchEvent(event);
        };
        fire('touchstart',300,180); fire('touchmove',120,180); fire('touchend',120,180);
      });
      await expect.poll(async()=>page.locator('.k-modal-counter').textContent(),{timeout:3000}).toMatch(/2\s*[/／]\s*\d+/);
      expected=mediaIdentity(await slides.nth(1).getAttribute('src'));
      await page.locator('.k-modal-carousel').evaluate((carousel)=>{
        const fire=(type,x,y)=>{
          const event=new Event(type,{bubbles:true,cancelable:true});
          Object.defineProperty(event,'touches',{configurable:true,value:type==='touchend'?[]:[{clientX:x,clientY:y}]});
          Object.defineProperty(event,'changedTouches',{configurable:true,value:[{clientX:x,clientY:y}]});
          carousel.dispatchEvent(event);
        };
        fire('touchstart',180,180); fire('touchend',181,181);
      });
    }else{
      const next=page.locator('.k-modal-carousel-handle--next');
      await expect(next).toBeVisible({timeout:3000});
      await next.click();
      await expect(page.locator('.k-modal-thumb').nth(1)).toHaveClass(/is-active/,{timeout:3000});
      expected=mediaIdentity(await slides.nth(1).getAttribute('src'));
      await page.locator('.k-modal-view-full').click();
    }

    const fullscreen=page.locator('.k-modal-fullscreen.is-open');
    await expect(fullscreen).toBeVisible({timeout:3000});
    const transform=await fullscreen.locator('.k-modal-fullscreen-track').evaluate(el=>el.style.transform);
    const currentIndex=transform.includes('-100%')?1:0;
    const actual=mediaIdentity(await fullscreen.locator('.k-modal-fullscreen-slide img').nth(currentIndex).getAttribute('src'));
    return {skipped:false,index:1,expected,actual,transform,ok:currentIndex===1&&expected===actual};
  }finally{
    await forceCloseFullscreen(page);
  }
}

async function audit(page,request,ref,viewport){
  const findings=[];
  const dir=outDir(ref,viewport[0]);
  const consoleErrors=[];
  const pageErrors=[];
  const failed=[];
  const http=[];
  let contract=null;
  let units=[];
  let opened=false;

  page.on('console',message=>{ if(message.type()==='error')consoleErrors.push(message.text()); });
  page.on('pageerror',error=>pageErrors.push(error.message));
  page.on('requestfailed',requestFailure=>failed.push({url:requestFailure.url(),error:requestFailure.failure()?.errorText||''}));
  page.on('response',response=>{
    try{
      if(response.status()>=400&&new URL(response.url()).origin===new URL(BASE_URL).origin&&!expectedAnonymous401(response)){
        http.push({status:response.status(),url:response.url()});
      }
    }catch(_){ /* ignore malformed URLs */ }
  });

  try{
    const list=await catalog(request);
    if(list.status!==200)push(findings,'P0','CATALOG_HTTP',`HTTP ${list.status}`);
    const product=(list.body.products||[]).find(item=>item.product_ref===ref);
    if(!product){ push(findings,'P0','CATALOG_MISSING',`${ref} absent du catalogue KM`); return findings; }

    const detailResult=await detail(request,product.id);
    if(detailResult.status!==200)push(findings,'P0','DETAIL_HTTP',`HTTP ${detailResult.status}`);
    contract=detailResult.body||{};
    units=Array.isArray(contract.sellable_units)?contract.sellable_units:[];
    write(dir,'api-product.json',product);
    write(dir,'api-detail.json',contract);

    if(contract.product?.reference!==ref)push(findings,'P0','REF_MISMATCH','référence API incohérente',{expected:ref,actual:contract.product?.reference});
    if(contract.inventory_model!=='SKU')push(findings,'P0','LEGACY_INVENTORY',`inventory_model=${contract.inventory_model}`);
    if(!contract.product?.description||contract.product.description.trim().length<20)push(findings,'P1','DESCRIPTION_WEAK','description absente/trop courte');
    if(!contract.pricing?.price_kmf||contract.pricing.price_kmf<=0)push(findings,'P0','PRICE_INVALID','prix API invalide',contract.pricing);
    if(!Array.isArray(contract.media)||!contract.media.length)push(findings,'P0','NO_MEDIA','aucun média API');
    if(contract.inventory_model==='SKU'&&!units.length)push(findings,'P0','NO_SELLABLE_UNITS','SKU sans unité vendable');

    await page.setViewportSize({width:viewport[1],height:viewport[2]});
    try{
      await openPdp(page,product);
      opened=true;
    }catch(error){
      const evidence=await page.evaluate(()=>({
        overlay:document.querySelector('#k-modal-overlay')?.className||null,
        search:document.querySelector('#k-search-dropdown')?.className||null,
        gridCards:document.querySelectorAll('#k-grid .k-promo-card, #k-grid .k-card').length,
        url:location.href,
      })).catch(()=>null);
      push(findings,'P0','OPEN_FAILED',error.message,evidence);
      await page.screenshot({path:path.join(dir,'00-open-failed.png'),fullPage:true}).catch(()=>{});
      return findings;
    }

    await page.screenshot({path:path.join(dir,'01-top.png'),fullPage:false});
    let snapshot=await domSnapshot(page);
    write(dir,'dom-initial.json',snapshot);

    if(snapshot.width.scroll>snapshot.width.client+1)push(findings,'P1','HORIZONTAL_OVERFLOW','débordement horizontal',snapshot.width);
    if(!snapshot.identity.name)push(findings,'P0','NAME_MISSING','nom absent');
    if(!snapshot.identity.ref.includes(ref))push(findings,'P1','REF_NOT_VISIBLE','référence non visible',snapshot.identity.ref);
    if(!snapshot.identity.price)push(findings,'P0','PRICE_MISSING','prix non visible');
    if(!snapshot.images.length)push(findings,'P0','NO_DOM_IMAGES','aucune image rendue');
    snapshot.images.forEach(image=>{ if(!image.src||image.w===0||image.h===0)push(findings,'P1','BROKEN_IMAGE','image produit non chargée',image); });
    const english=[...new Set((snapshot.text.match(ENGLISH)||[]).map(value=>value.toLowerCase()))];
    if(english.length)push(findings,'P1','ENGLISH_RESIDUE','anglais visible',english);
    snapshot.options.forEach(axis=>{ if(!axis.key||!axis.values.length)push(findings,'P0','BROKEN_AXIS','axe variante incomplet',axis); });
    if(!snapshot.message.hidden&&/achat désactivé/i.test(snapshot.message.text)&&(!snapshot.add.disabled||!snapshot.buy.disabled)){
      push(findings,'P0','CTA_CONTRADICTION','message bloqué mais CTA actifs',{message:snapshot.message,add:snapshot.add,buy:snapshot.buy});
    }
    if(!snapshot.message.hidden&&/achat désactivé/i.test(snapshot.message.text)){
      push(findings,'P1','DISABLED_VISUAL','CTA disabled à valider visuellement',{add:snapshot.add,buy:snapshot.buy});
    }

    try{
      const identityResult=await fullscreenMediaIdentity(page);
      write(dir,'fullscreen-media-identity.json',identityResult);
      if(!identityResult.skipped&&!identityResult.ok){
        push(findings,'P0','FULLSCREEN_MEDIA_MISMATCH','le fullscreen ne conserve pas le média courant',identityResult);
      }
    }catch(error){
      push(findings,'P0','FULLSCREEN_MEDIA_MISMATCH',error.message);
      await forceCloseFullscreen(page);
    }

    const available=units.filter(unit=>unit.stock_status==='AVAILABLE'&&Number(unit.available_quantity)>0);
    const outOfStock=units.filter(unit=>unit.stock_status==='OUT_OF_STOCK'||Number(unit.available_quantity)===0);
    for(const unit of available.slice(0,12)){
      const state=await selectUnit(page,contract,unit);
      if(!state.ok)push(findings,'P0','OPTION_MISSING',`option DOM absente/inutilisable pour ${unit.sku||unit.sku_id}`,state);
      else if(!state.add||!state.buy)push(findings,'P0','AVAILABLE_NOT_BUYABLE',`SKU disponible mais bloqué ${unit.sku||unit.sku_id}`,state);
      else if(unit.sku&&!state.ref.includes(unit.sku))push(findings,'P0','SKU_REFERENCE_MISMATCH',`SKU sélectionné non reflété dans la référence ${unit.sku}`,state);
    }
    for(const unit of outOfStock.slice(0,8)){
      const state=await selectUnit(page,contract,unit);
      if(state.ok&&(state.add||state.buy))push(findings,'P0','OUT_OF_STOCK_BUYABLE',`SKU rupture achetable ${unit.sku||unit.sku_id}`,state);
    }

    const scroll=page.locator('.k-modal-scroll');
    if(await scroll.count())await scroll.evaluate(element=>{ element.scrollTop=element.scrollHeight; });
    await page.screenshot({path:path.join(dir,'02-bottom.png'),fullPage:false});
    await page.screenshot({path:path.join(dir,'03-full.png'),fullPage:true});
    snapshot=await domSnapshot(page);
    write(dir,'dom-final.json',snapshot);
  }catch(error){
    push(findings,'P0','AUDIT_EXCEPTION',error.message,{stack:error.stack||null});
    await page.screenshot({path:path.join(dir,'99-audit-exception.png'),fullPage:true}).catch(()=>{});
  }finally{
    await forceCloseFullscreen(page).catch(()=>{});
    if(opened)await closeModal(page).catch(()=>{});
    if(consoleErrors.length)push(findings,'P1','CONSOLE_ERRORS',`${consoleErrors.length} erreur(s) console`,consoleErrors);
    if(pageErrors.length)push(findings,'P0','PAGE_ERRORS',`${pageErrors.length} erreur(s) page`,pageErrors);
    if(failed.length)push(findings,'P1','REQUEST_FAILED',`${failed.length} requête(s) échouée(s)`,failed);
    if(http.length)push(findings,'P1','HTTP_ERRORS',`${http.length} réponse(s) >=400`,http);
    write(dir,'report.json',{
      ref,
      viewport,
      inventory_model:contract?.inventory_model||null,
      sellable_units:units.length,
      findings,
      consoleErrors,
      pageErrors,
      failed,
      http,
    });
  }
  return findings;
}

test.describe('AliExpress live PDP exhaustive audit',()=>{
  test.skip(process.env.PDP_LIVE_AUDIT!=='1','PDP_LIVE_AUDIT=1 required');
  test.setTimeout(180000);
  for(const viewport of VIEWPORTS){
    for(const ref of REFS){
      test(`${ref} @ ${viewport[0]}`,async({page,request})=>{
        const findings=await audit(page,request,ref,viewport);
        const p0=findings.filter(finding=>finding.severity==='P0');
        expect(p0,JSON.stringify(p0,null,2)).toEqual([]);
      });
    }
  }
});
