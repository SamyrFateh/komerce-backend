const {run,B}=require('./R.js');
run('agent-hub',async({p,shot,btns,log})=>{
 await p.goto(B+'/admin/workspaces/shipping-customs?market=KM',{waitUntil:'domcontentloaded'});await p.waitForTimeout(7000);
 await p.locator('tr',{hasText:'CLAUDE-PAR-20261113-EXP'}).getByRole('button').first().click();await p.waitForTimeout(3500);await shot('O3a');
 const setv=(n,v)=>p.evaluate(([n,v])=>{const e=document.querySelector('[name='+n+']');e.focus();e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}))},[n,v]);
 await setv('forwarder_name','CLAUDE-PAR Transitaire');await setv('proof_ref','CLAUDE-PAR-20261113 bon de remise transitaire');await setv('notes','Remise saisie manuellement CLAUDE-PAR-20261113');
 console.log(await p.evaluate(()=>{const f=document.querySelector('input[name=forwarder_name]').closest('form');return [...f.querySelectorAll('button')].map(b=>b.type+':'+b.innerText.trim()).join(' ; ')+' || '+[...f.elements].map(e=>e.name+'='+e.value).join(', ')}));
 await shot('O3-remise-form');await p.evaluate(()=>document.querySelector('input[name=forwarder_name]').closest('form').requestSubmit());await p.waitForTimeout(4500);await shot('O4-remis');
});
