// usage: node tr.js confirm|tracking
const mode=process.argv[2];
const {run,B}=require('./R.js');
run('agent-transitaire',async({p,shot,btns,log,S})=>{
 await p.goto(B+'/admin/workspaces/shipping-customs?market=KM',{waitUntil:'domcontentloaded'});await p.waitForTimeout(7000);
 await p.locator('tr',{hasText:'CLAUDE-PAR-20261113-EXP'}).getByRole('button').first().click();await p.waitForTimeout(3500);
 const sums=await p.evaluate(()=>[...document.querySelectorAll('summary')].map(s=>s.innerText.trim()));console.log(sums);
 const setv=(n,v)=>p.evaluate(([n,v])=>{const e=document.querySelector('.kmc-journey-form [name='+n+']');e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}))},[n,v]);
 if(mode==='confirm'){
  await p.locator('summary',{hasText:/^Confirmer/}).first().click();await p.waitForTimeout(800);
  await setv('proof_ref','CLAUDE-PAR-20261113 preuve '+(process.argv[3]||'transitaire'));await setv('notes','saisie manuelle CLAUDE-PAR-20261113');
  await p.evaluate(()=>document.querySelector('.kmc-journey-form [name=proof_ref]').closest('form').requestSubmit());
 }else{
  await p.locator('summary',{hasText:/^Suivi/}).first().click();await p.waitForTimeout(800);
  await setv('tracking_reference','CLPAR-TRK-20261113');await setv('container_reference','CLPAR-CNT-20261113');await setv('bill_of_lading_ref','CLPAR-BL-20261113');await setv('estimated_arrival_date','2026-11-27');await p.evaluate(()=>{const e=document.querySelector('[name=tracking_reference]').closest('form').querySelector('[name=proof_ref]');e.value='CLAUDE-PAR-20261113 BL saisi manuellement';e.dispatchEvent(new Event('input',{bubbles:true}))});
  console.log(await p.evaluate(()=>{const f=document.querySelector('[name=tracking_reference]').closest('form');return [f.checkValidity(),[...f.elements].filter(e=>!e.checkValidity()).map(e=>e.name+':'+e.validationMessage+':'+e.value)]}));await p.evaluate(()=>document.querySelector('[name=tracking_reference]').closest('form').requestSubmit());
 }
 await p.waitForTimeout(4500);await p.screenshot({path:S+'/shots/P2-'+mode+'-'+(process.argv[3]||'x')+'.png',fullPage:true});
});
