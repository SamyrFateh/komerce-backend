const {run,B}=require('./R.js');
run('admin',async({p,shot,btns,log,S})=>{
 await p.goto(B+'/admin/workspaces/shipping-customs?market=KM',{waitUntil:'domcontentloaded'});await p.waitForTimeout(7000);
 await p.getByRole('button',{name:'Arrivée & douane'}).click();await p.waitForTimeout(2500);
 const r=p.locator('tr',{hasText:'CLAUDE-PAR-20261113-EXP'});console.log('rows',await r.count());
 await r.first().getByRole('button').first().click();await p.waitForTimeout(3500);
 console.log(await p.evaluate(()=>[...document.querySelectorAll('summary')].map(s=>s.innerText.trim())));
 console.log(await p.evaluate(()=>[...document.querySelectorAll('.kmc-journey-form')].map(f=>[...f.elements].map(e=>e.name+'='+e.value+(e.tagName==='SELECT'?'['+[...e.options].map(o=>o.text.slice(0,24)).join('/')+']':'')).join(' ; '))));
 await p.locator('summary',{hasText:/^Confirmer/}).first().click();await p.waitForTimeout(600);await p.evaluate(()=>{const f=document.querySelector('.kmc-journey-form');const e=f.querySelector('[name=proof_ref]');e.value='CLAUDE-PAR-20261113 mainlevée saisie manuelle';e.dispatchEvent(new Event('input',{bubbles:true}));f.requestSubmit()});await p.waitForTimeout(4500);
 await p.screenshot({path:S+'/shots/Q3-douane-tab.png',fullPage:true});
});
