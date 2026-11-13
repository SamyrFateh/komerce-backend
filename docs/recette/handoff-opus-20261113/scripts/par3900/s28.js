const {run,B}=require('./R.js');
run('agent-hub',async({p,shot,btns,log})=>{
 await p.goto(B+'/admin/hub-live?view=execute&market=KM',{waitUntil:'domcontentloaded'});await p.waitForTimeout(7000);
 await p.getByRole('button',{name:'KC692IV',exact:true}).first().click();await p.waitForTimeout(1000);
 await p.locator('[data-hlc-action=open-physical-details]').first().click();await p.waitForTimeout(1500);
 const ref=p.locator('input[placeholder="Référence du nouveau dossier"]');await ref.scrollIntoViewIfNeeded();
 await ref.fill('CLAUDE-PAR-20261113-EXP');
 const cart=p.locator('input[placeholder="Référence du carton (facultative)"]');await cart.fill('KOM-BOX-4290B893227D2A4A7A');
 await shot('N1-dossier-form');
 await p.locator('[data-workspace-action=create-shipment-from-boxes]').click();await p.waitForTimeout(4000);await shot('N2-dossier-cree');
});
