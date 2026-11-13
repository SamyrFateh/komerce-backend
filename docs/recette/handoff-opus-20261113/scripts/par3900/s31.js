const {run,B}=require('./R.js');
run(process.env.ROLE||'agent-hub',async({p,shot,btns,log})=>{
 await p.goto(B+'/admin/workspaces/shipping-customs?market=KM',{waitUntil:'domcontentloaded'});await p.waitForTimeout(7000);
 await p.locator('tr',{hasText:'CLAUDE-PAR-20261113-EXP'}).getByRole('button',{name:'Consulter'}).click();await p.waitForTimeout(3000);await shot('O2-consulter');
 console.log(await p.evaluate(()=>[...document.querySelectorAll('input,select,textarea')].filter(e=>e.offsetParent&&e.name!=='reference').map(e=>e.tagName+':'+(e.name||e.id)+':'+(e.placeholder||'')+'='+e.value+(e.tagName==='SELECT'?'['+[...e.options].map(o=>o.text.slice(0,30)).join('/')+']':'')).slice(0,20)));
 console.log(await p.evaluate(()=>[...document.querySelectorAll('button')].map(e=>(e.disabled?'[off]':'')+(e.offsetParent?'':'[hid]')+e.innerText.trim().slice(0,40)).filter(x=>/Remis|Confirmer|Enregistrer|transit|Réception|Valider/i.test(x))));console.log((await btns()).filter(x=>!/Mettre en transit|Consulter/.test(x)));
});
