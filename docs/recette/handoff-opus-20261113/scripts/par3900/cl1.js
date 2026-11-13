const {chromium}=require('/opt/npm-tools/node_modules/playwright');const S=__dirname;const B='https://komerce-backend-production.up.railway.app';
(async()=>{const br=await chromium.launch();const ctx=await br.newContext({storageState:S+'/client-state.json',viewport:{width:1440,height:900},locale:'fr-FR',recordVideo:{dir:S+'/video-client',size:{width:1280,height:720}}});const p=await ctx.newPage();
await p.goto(B+'/boutique/?market=KM',{waitUntil:'domcontentloaded'});await p.waitForTimeout(3500);
console.log(await p.evaluate(()=>[...document.querySelectorAll('button,a')].filter(e=>e.offsetParent).map(e=>(e.id||'')+':'+(e.innerText||e.getAttribute('aria-label')||'').trim().slice(0,25)).filter(x=>/compte|komerce|suivi|commande|profil|mes /i.test(x)).slice(0,12)));
await p.screenshot({path:S+'/shots/T0-boutique.png'});
await br.close()})();
