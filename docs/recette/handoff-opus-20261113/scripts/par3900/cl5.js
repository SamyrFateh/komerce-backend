const {chromium}=require('/opt/npm-tools/node_modules/playwright');const S=__dirname;const B='https://komerce-backend-production.up.railway.app';
(async()=>{const br=await chromium.launch();const ctx=await br.newContext({storageState:S+'/client-state.json',viewport:{width:1440,height:900},locale:'fr-FR',recordVideo:{dir:S+'/video-client',size:{width:1280,height:720}}});const p=await ctx.newPage();
const log=[];p.on('response',async r=>{const u=r.url();if(/wallet|documents/.test(u)&&u.includes('/api/'))log.push(r.status()+' '+u.replace(B,'').slice(0,80)+' '+(await r.text().catch(()=>'')).slice(0,350))});
await p.goto(B+'/boutique/?market=KM',{waitUntil:'domcontentloaded'});await p.waitForTimeout(3500);
await p.locator('#k-header-komerce-btn').click();await p.waitForTimeout(1500);
console.log(await p.evaluate(()=>[...document.querySelectorAll('button,a')].filter(e=>e.offsetParent).map(e=>e.innerText.trim().slice(0,30)).filter(x=>/wallet|solde|crédit|avoir|documents|reçu/i.test(x))));
await p.screenshot({path:S+'/shots/Y1-komerce-menu.png'});
const w=await ctx.request.get(B+'/api/wallet',{headers:{origin:B}});console.log('GET /api/wallet',w.status(),(await w.text()).slice(0,400));
console.log(log);await br.close()})();
