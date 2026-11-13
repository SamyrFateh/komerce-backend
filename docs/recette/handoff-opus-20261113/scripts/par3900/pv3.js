const {chromium}=require('/opt/npm-tools/node_modules/playwright');const S=__dirname;const B='https://komerce-backend-production.up.railway.app';
(async()=>{const br=await chromium.launch();const ctx=await br.newContext({storageState:S+'/client-state.json',viewport:{width:1440,height:900}});const p=await ctx.newPage();
await p.goto(B+'/boutique/?market=KM',{waitUntil:'domcontentloaded'});await p.waitForTimeout(3000);
console.log(await p.evaluate(()=>JSON.stringify(Object.keys(localStorage).map(k=>k+':'+localStorage.getItem(k).length))));
await p.locator('#k-cart-btn').click();await p.waitForTimeout(1500);
console.log(await p.evaluate(()=>document.getElementById('k-side-cart').innerText.slice(0,500)));
await br.close()})();
