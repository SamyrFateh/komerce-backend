const {run,B}=require('./R.js');
run('agent-hub',async({p,shot,txt,btns,log,S})=>{
 await p.goto(B+'/admin/hub-live?view=execute&market=KM',{waitUntil:'domcontentloaded'});await p.waitForTimeout(8000);
 const cards=p.locator('div,article,li').filter({has:p.locator('input[type=checkbox]'),hasText:/Débardeur de sport à dos fendu.*KC692IV|Legging de sport ajusté.*KC692IV/}).filter({hasNotText:'BESOINS NON COUVERTS'});
 console.log('cards',await cards.count());
 const cbs=p.locator('input[type=checkbox]');console.log('cb',await cbs.count());
 await cbs.nth(0).check();await cbs.nth(1).check();await p.waitForTimeout(1500);
 await p.locator('input[type=checkbox]').first().scrollIntoViewIfNeeded();await p.mouse.wheel(0,0);await shot('D3-selection');await p.screenshot({path:S+'/shots/D3b.png',fullPage:true});
 console.log(await p.evaluate(()=>[...document.querySelectorAll('button')].map(e=>(e.disabled?'[dis]':'')+(e.offsetParent?'':'[hid]')+e.innerText.trim().slice(0,50)).filter(x=>/PO|brouillon|Préparer|Constituer|Créer|achat/i.test(x)&&!/E2E/.test(x))));
});
