const {chromium}=require('/opt/npm-tools/node_modules/playwright');const fs=require('fs');
const S=__dirname;const B='https://komerce-backend-production.up.railway.app';
const items=[['Legging de sport','91c94beb-f706-40be-ac05-5d13d6d716dd'],['Casserole en aluminium','af3e5584-a71a-4dbe-b09c-11d9a0849376']];
const GO=process.env.GO==='1';
(async()=>{
 const br=await chromium.launch();
 const ctx=await br.newContext({storageState:S+'/client-state.json',viewport:{width:1440,height:900},locale:'fr-FR',recordVideo:{dir:S+'/video-client',size:{width:1280,height:720}}});
 const p=await ctx.newPage();const log=[];
 p.on('response',r=>{const u=r.url();if(u.includes('/api/')&&r.request().method()!=='GET')log.push(r.status()+' '+r.request().method()+' '+u.replace(B,''))});
 await p.goto(B+'/boutique/?market=KM',{waitUntil:'domcontentloaded'});await p.waitForTimeout(3000);
 // retirer planche et coque
 await p.locator('#k-cart-btn').click();await p.waitForTimeout(1200);
 for(const n of ['Planche à découper','Coque de protection']){const row=p.locator('#k-side-cart').locator('xpath=.//*[contains(.,"'+n+'")][.//button]').last();
   console.log('rm',n,await p.evaluate(n=>{const rows=[...document.querySelectorAll('#k-side-cart *')].filter(e=>e.children.length>=3&&e.innerText&&e.innerText.includes(n)&&e.querySelector('button'));const r=rows[rows.length-1];if(!r)return 'norow';const b=[...r.querySelectorAll('button')].find(b=>b.innerText.trim()==='−');if(!b)return 'nobtn';b.click();return 'ok'},n));await p.waitForTimeout(800);}
 await p.screenshot({path:S+'/shots/B-cart-apres-retrait.png'});
 console.log((await p.evaluate(()=>document.getElementById('k-side-cart').innerText.slice(0,300))).replace(/\s+/g,' '));
 await p.keyboard.press('Escape');
 for(const [q,pid] of items){
  await p.locator('#k-search-input').fill(q);
  const item=p.locator('#k-search-dropdown .k-search-item[data-id="'+pid+'"]');
  await item.waitFor({state:'visible',timeout:25000});await item.click();
  await p.locator('#k-modal-name').waitFor({state:'visible',timeout:13000});await p.waitForTimeout(2000);
  const add=p.locator('#k-add-cart-btn');
  const opts=await p.evaluate(()=>[...document.querySelectorAll('#k-modal-variants button[data-option-value]')].map(b=>b.dataset.optionValue));console.log(q,'opts',opts.slice(0,12));
  const sel=async v=>{const b=p.locator('#k-modal-variants button[data-option-value="'+v+'"]');if(await b.getAttribute('aria-pressed')!=='true'){await b.click();await p.waitForTimeout(500)}};
  const ready=()=>p.evaluate(()=>{const b=document.getElementById('k-add-cart-btn');return !b.disabled&&!b.classList.contains('k-purchase-intent--blocked')});
  if(opts.length){let ok=null;outer:for(const c of opts)for(const z of opts){await sel(c);await sel(z);if(await ready()){ok=c+'/'+z;break outer}}console.log('combo',ok)}
  await p.waitForTimeout(800);
  if(!(await add.getAttribute('class')).includes('in-cart')){await add.click();await p.waitForTimeout(1500)}await p.locator('#k-modal-close').click();await p.waitForTimeout(800);
 }
 await p.locator('#k-cart-btn').click();await p.waitForTimeout(1000);
 console.log((await p.evaluate(()=>document.getElementById('k-side-cart').innerText.slice(0,400))).replace(/\s+/g,' '));
 await p.evaluate(()=>document.getElementById('k-sc-checkout').click());
 await p.locator('#k-order-modal.open').waitFor({state:'visible',timeout:15000});await p.waitForTimeout(3000);
 await p.locator('.ck-step-header-change, button:has-text("Changer")').nth(1).click();await p.waitForTimeout(2000);
 await p.getByRole('button',{name:'Ngazidja'}).click();await p.waitForTimeout(1500);
 await p.getByText('CLAUDE-PAR Relais KM').first().click();await p.waitForTimeout(800);
 await p.screenshot({path:S+'/shots/B-relais-1.png'});
 await p.getByRole('button',{name:/Valider/}).click();await p.waitForTimeout(3000);
 await p.screenshot({path:S+'/shots/B-checkout-final.png'});
 console.log((await p.locator('#k-order-modal').innerText()).slice(0,700).replace(/\n+/g,' | '));
 if(GO){const rp=p.waitForResponse(r=>r.url().endsWith('/api/orders')&&r.request().method()==='POST',{timeout:30000});
 await p.locator('#btn-confirm-order').click();const r=await rp;const body=await r.json().catch(()=>null);console.log('ORDER',r.status(),JSON.stringify(body).slice(0,900));
 await p.waitForTimeout(4000);await p.screenshot({path:S+'/shots/B-confirmation.png'});
 fs.writeFileSync(S+'/order.json',JSON.stringify({status:r.status(),body}));}
 console.log(log);
 await ctx.storageState({path:S+'/client-state.json'});await ctx.close();await br.close();
})();
