const {chromium}=require('/opt/npm-tools/node_modules/playwright');const S=__dirname;const B='https://komerce-backend-production.up.railway.app';
(async()=>{const br=await chromium.launch();const ctx=await br.newContext({storageState:S+'/client-state.json',viewport:{width:1440,height:900},locale:'fr-FR',recordVideo:{dir:S+'/video-client',size:{width:1280,height:720}}});const p=await ctx.newPage();
const log=[];p.on('response',async r=>{const u=r.url();if(u.includes('/api/auth/me/documents'))log.push(r.status()+' '+u.replace(B,'').slice(0,90)+' '+(await r.text().catch(()=>'')).slice(0,400))});
await p.goto(B+'/boutique/?market=KM',{waitUntil:'domcontentloaded'});await p.waitForTimeout(3500);
await p.locator('#k-header-komerce-btn').click();await p.waitForTimeout(1200);await p.getByText('Mes Commandes').first().click();await p.waitForTimeout(3000);
await p.locator('text=KC692IV').first().click();await p.waitForTimeout(4000);
await p.screenshot({path:S+'/shots/W1-commande-retiree.png',fullPage:true});
console.log((await p.locator('body').innerText()).replace(/\s+/g,' ').match(/(Retiré|preuve|Preuve|Documents)[^|]{0,160}/g));
console.log(log);await br.close()})();
