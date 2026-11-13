const {run,B}=require('./R.js');
run('admin',async({p,shot,btns,log,S})=>{
 await p.goto(B+'/admin/workspaces/shipping-customs?market=KM',{waitUntil:'domcontentloaded'});await p.waitForTimeout(7000);
 await p.getByRole('button',{name:'Arrivée & douane'}).click();await p.waitForTimeout(2500);
 await p.locator('tr',{hasText:'CLAUDE-PAR-20261113-EXP'}).first().getByRole('button').first().click();await p.waitForTimeout(3500);
 await p.locator('summary',{hasText:/^Lier le dossier/}).click();await p.waitForTimeout(500);
 await p.evaluate(()=>{const f=document.querySelector('[name=customs_reference]').closest('form');const s=(n,v)=>{const e=f.querySelector('[name='+n+']');e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}))};s('customs_reference','CLAUDE-PAR-20261113-DOUANE1');s('proof_ref','CLAUDE-PAR-20261113 dossier douane lié');f.requestSubmit()});
 await p.waitForTimeout(4500);
});
