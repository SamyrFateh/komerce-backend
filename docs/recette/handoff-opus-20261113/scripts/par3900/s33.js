const {run,B}=require('./R.js');
run('agent-transitaire',async({p,shot,btns,log,S})=>{
 await p.goto(B+'/admin/workspaces/shipping-customs?market=KM',{waitUntil:'domcontentloaded'});await p.waitForTimeout(7000);
 await p.locator('tr',{hasText:'CLAUDE-PAR-20261113-EXP'}).getByRole('button').first().click();await p.waitForTimeout(3500);
 console.log(await p.evaluate(()=>{const f=document.querySelector('form');return f?[...f.elements].map(e=>e.tagName+':'+e.name+'='+e.value+(e.tagName==='SELECT'?'['+[...e.options].map(o=>o.text.slice(0,24)).join('/')+']':'')).join(' ; '):'noform'}));
 console.log(await p.evaluate(()=>[...document.querySelectorAll('form')].map(f=>f.getAttribute('data-journey-action')||f.className+':'+[...f.querySelectorAll('button')].map(b=>b.innerText.trim()).join('|'))));
 await p.screenshot({path:S+'/shots/P1-transitaire.png',fullPage:true});console.log(await p.evaluate(()=>[...document.querySelectorAll('.kmc-journey-form')].map(f=>[...f.elements].map(e=>e.name+'='+e.value+(e.tagName==='SELECT'?'['+[...e.options].map(o=>o.text.slice(0,20)).join('/')+']':'')).join(' ; '))));
});
