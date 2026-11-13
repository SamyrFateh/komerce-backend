const {run,B}=require('./R.js');
run('agent-relais',async({p,shot,btns,S,log})=>{
 await p.goto(B+'/admin/relais-live?view=execute&market=KM',{waitUntil:'domcontentloaded'});await p.waitForTimeout(6000);
 await p.getByText('Retours & SAV',{exact:true}).first().click();await p.waitForTimeout(2500);
 await p.locator('input[placeholder="Référence commande"]').fill('KC692IV');await p.getByRole('button',{name:'Rechercher'}).click();await p.waitForTimeout(3000);
 await p.getByRole('button',{name:'Confirmer la réception'}).scrollIntoViewIfNeeded();
 console.log(await p.evaluate(()=>[...document.querySelectorAll('input,select,textarea')].filter(e=>e.offsetParent&&e.name!=='reference').map(e=>e.tagName+':'+e.type+':'+(e.name||e.id)+':'+(e.placeholder||'')+'='+e.value+(e.tagName==='SELECT'?'['+[...e.options].map(o=>o.text.slice(0,28)).join('/')+']':'')).slice(-7)));
 const ss=p.locator('select:visible');const n=await ss.count();await ss.nth(n-1).selectOption({index:3});await p.locator('input[placeholder="A (facultatif)"]').fill('A');await p.locator('textarea:visible').last().fill('CLAUDE-PAR-20261113 constat : couture défaillante, emballage ouvert, 1 unité reprise');await shot('X3-reprise-form');await p.getByRole('button',{name:'Confirmer la réception'}).click();await p.waitForTimeout(4000);await shot('X4-reprise-ok');
});
