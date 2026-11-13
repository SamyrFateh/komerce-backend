const {chromium}=require('/opt/npm-tools/node_modules/playwright');const fs=require('fs');
const S='/tmp/claude-0/-home-claude/011d1491-2f57-5b4d-98e0-a4b4e0b2f674/scratchpad/par3900';const B='https://komerce-backend-production.up.railway.app';
const PH=process.env.PH||'+2693470913';
const items=[['Débardeur de sport','a16c7ade-d317-445d-9489-6cf233612a47'],['Coque de protection effet fibre','21bc5285-7b1a-47c5-a914-7656790816c5'],['Planche à découper en bois','fe2c8a44-d385-45ff-ae5b-8acbd3bf8534']];
(async()=>{
 const br=await chromium.launch();
 const ctx=await br.newContext({viewport:{width:1440,height:900},locale:'fr-FR',recordVideo:{dir:S+'/video-client',size:{width:1280,height:720}}});
 const p=await ctx.newPage();const log=[];
 p.on('response',r=>{const u=r.url();if(u.includes('/api/')&&r.request().method()!=='GET')log.push(r.status()+' '+r.request().method()+' '+u.replace(B,''))});
 await p.goto(B+'/boutique/?market=KM',{waitUntil:'domcontentloaded'});await p.waitForTimeout(3000);
 for(const [q,pid] of items){
  await p.locator('#k-search-input').fill(q);
  const item=p.locator('#k-search-dropdown .k-search-item[data-id="'+pid+'"]');
  await item.waitFor({state:'visible',timeout:25000});await item.click();
  await p.locator('#k-modal-name').waitFor({state:'visible',timeout:13000});await p.waitForTimeout(2000);
  const add=p.locator('#k-add-cart-btn');
  const opts=await p.evaluate(()=>[...document.querySelectorAll('#k-modal-variants button[data-option-value]')].map(b=>b.dataset.optionValue));console.log(q,'opts',opts);
  const sel=async v=>{const b=p.locator('#k-modal-variants button[data-option-value="'+v+'"]');if(await b.getAttribute('aria-pressed')!=='true'){await b.click();await p.waitForTimeout(500)}};
  const ready=()=>p.evaluate(()=>{const b=document.getElementById('k-add-cart-btn');return !b.disabled&&!b.classList.contains('k-purchase-intent--blocked')});
  if(opts.length){let ok=null;outer:for(const c of opts)for(const z of opts){await sel(c);await sel(z);if(await ready()){ok=c+'/'+z;break outer}}console.log('combo',ok)}
  await p.waitForTimeout(800);
  console.log('add enabled',await add.isEnabled());
  await p.screenshot({path:S+'/shots/A-pdp-'+pid.slice(0,4)+'.png'});
  await add.click();await p.waitForTimeout(1500);
  await p.locator('#k-modal-close').click();await p.waitForTimeout(800);
 }
 await p.locator('#k-side-cart.has-items').waitFor({state:'visible',timeout:12000});
 await p.screenshot({path:S+'/shots/A-panier.png'});
 const co=p.locator('#k-sc-checkout');if(await co.isVisible())await co.click();else await p.locator('#k-cart-btn').click();
 await p.waitForTimeout(4000);await p.screenshot({path:S+'/shots/A-checkout0.png'});
 await p.getByRole('button',{name:/identifier pour continuer/}).click();await p.waitForTimeout(4000);
 await p.fill('#k-id-name','CLAUDE-PAR-20261113');await p.fill('#k-id-lastname','Client '+PH.slice(-4));await p.fill('#k-id-phone',PH.replace('+269',''));
 await p.click('#k-id-phone-cta');await p.waitForTimeout(3500);
 await p.screenshot({path:S+'/shots/A-ident2.png'});
 await p.keyboard.type('424242');await p.waitForTimeout(500);await p.waitForTimeout(5000);
 await p.screenshot({path:S+'/shots/A-ident3.png'});
 console.log('me',await p.evaluate(()=>fetch('/api/auth/me').then(r=>r.json()).then(j=>JSON.stringify(j).slice(0,300))));
 await ctx.storageState({path:S+'/client-state.json'});
 console.log(await p.evaluate(()=>[...document.querySelectorAll('#k-order-modal [class*=ck-step],#k-order-modal h3')].map(e=>e.innerText.slice(0,50))));
 fs.writeFileSync(S+'/state.json','{}');
 await p.waitForTimeout(500);await ctx.close();await br.close();
})();
