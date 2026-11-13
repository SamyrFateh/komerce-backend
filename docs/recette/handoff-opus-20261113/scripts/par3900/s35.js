const {run,B}=require('./R.js');
run('admin',async({p,shot,btns,log,S})=>{
 await p.goto(B+'/admin/workspaces/shipping-customs?market=KM',{waitUntil:'domcontentloaded'});await p.waitForTimeout(7000);
 await p.locator('tr',{hasText:'CLAUDE-PAR-20261113-EXP'}).getByRole('button').first().click();await p.waitForTimeout(3500);
 console.log(await p.evaluate(()=>[...document.querySelectorAll('summary')].map(s=>s.innerText.trim())));
 console.log(await p.evaluate(()=>[...document.querySelectorAll('.kmc-journey-form')].map(f=>[...f.elements].map(e=>e.name+'='+e.value+(e.tagName==='SELECT'?'['+[...e.options].map(o=>o.text.slice(0,24)).join('/')+']':'')).join(' ; '))));
 await p.screenshot({path:S+'/shots/Q2-admin-exp.png',fullPage:true});
});
