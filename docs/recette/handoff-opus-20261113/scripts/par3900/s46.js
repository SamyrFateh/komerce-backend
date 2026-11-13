const {run,B}=require('./R.js');
run('agent-relais',async({p,shot,btns,S})=>{
 await p.goto(B+'/admin/relais-live?view=execute&market=KM',{waitUntil:'domcontentloaded'});await p.waitForTimeout(6000);
 await p.getByText('Retours & SAV',{exact:true}).first().click();await p.waitForTimeout(3000);
 await p.locator('input[placeholder="Référence commande"]').fill('KC692IV');await p.getByRole('button',{name:'Rechercher'}).click();await p.waitForTimeout(3000);
 console.log((await p.locator('body').innerText()).replace(/\s+/g,' ').slice(700,1800));
 console.log(await btns());
 console.log(await p.evaluate(()=>[...document.querySelectorAll('input,select,textarea')].filter(e=>e.offsetParent&&e.name!=='reference').map(e=>e.tagName+':'+(e.name||e.id)+':'+(e.placeholder||'')+(e.tagName==='SELECT'?'['+[...e.options].map(o=>o.text.slice(0,28)).join('/')+']':'')).slice(0,12)));
 await p.screenshot({path:S+'/shots/X1-sav.png',fullPage:true});
});
