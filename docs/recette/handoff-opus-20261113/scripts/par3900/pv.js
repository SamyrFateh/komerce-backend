const {chromium}=require('/opt/npm-tools/node_modules/playwright');const S=__dirname;const B='https://komerce-backend-production.up.railway.app';
(async()=>{const br=await chromium.launch();const ctx=await br.newContext({storageState:S+'/client-state.json',viewport:{width:1440,height:900}});const p=await ctx.newPage();
let first=true;p.on('response',async r=>{if(r.url().includes('/api/orders/preview')&&first){first=false;console.log('REQ',r.request().postData().slice(0,900));console.log('RES',(await r.text()).slice(0,2500))}});
await p.goto(B+'/boutique/?market=KM',{waitUntil:'domcontentloaded'});await p.waitForTimeout(3000);
await p.locator('#k-cart-btn').click();await p.waitForTimeout(1500);const co=p.locator('#k-sc-checkout');if(await co.isVisible())await co.click();await p.waitForTimeout(5000);
await br.close()})();
