const {run,B}=require('./R.js');
run('agent-hub',async({p,log,S})=>{
 await p.goto(B+'/admin/workspaces/shipping-customs?market=KM',{waitUntil:'domcontentloaded'});await p.waitForTimeout(7000);
 await p.getByRole('button',{name:'Vers les relais'}).click();await p.waitForTimeout(2500);
 await p.locator('tr',{hasText:'CLAUDE-PAR-20261113-EXP'}).first().getByRole('button').first().click();await p.waitForTimeout(3500);
 console.log(await p.evaluate(()=>[...document.querySelectorAll('summary')].map(s=>s.innerText.trim())));
 await p.locator('summary',{hasText:/^Confirmer/}).first().click();await p.waitForTimeout(600);
 await p.evaluate(()=>{const f=document.querySelector('.kmc-journey-form');const e=f.querySelector('[name=proof_ref]');e.value='CLAUDE-PAR-20261113 transport local saisi manuellement';e.dispatchEvent(new Event('input',{bubbles:true}));f.requestSubmit()});await p.waitForTimeout(4500);
});
