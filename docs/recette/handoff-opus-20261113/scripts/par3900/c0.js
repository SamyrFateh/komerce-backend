const {chromium}=require('/opt/npm-tools/node_modules/playwright');const B='https://komerce-backend-production.up.railway.app';
(async()=>{const br=await chromium.launch();const p=await (await br.newContext({viewport:{width:1440,height:900},locale:'fr-FR'})).newPage();
p.on('request',r=>{if(r.method()!=='GET'&&r.url().includes('/api/'))console.log(r.method(),r.url().replace(B,''))});
await p.goto(B+'/boutique/?market=KM',{waitUntil:'domcontentloaded'});await p.waitForTimeout(4000);
console.log(await p.evaluate(()=>[...document.querySelectorAll('button,a')].filter(e=>e.offsetParent&&/compte|connexion|connecter|account|login/i.test((e.id||'')+(e.innerText||'')+(e.getAttribute('aria-label')||''))).map(e=>e.tagName+'#'+e.id+':'+(e.innerText||'').trim().slice(0,30)).slice(0,10)));
await br.close()})();
