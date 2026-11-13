const ref=process.argv[2];
require('./hubpo.js')('agent-hub',ref,async({p,shot,btns,log})=>{
 await p.getByRole('button',{name:/Enregistrer l.envoi fournisseur/}).first().click();await p.waitForTimeout(2000);
 const sub=p.getByRole('button',{name:'Enregistrer l’envoi',exact:true});await sub.scrollIntoViewIfNeeded();
 await p.locator('input[name=supplier_order_id]:visible').fill('CLAUDE-PAR-20261113-SIM-'+ref);
 console.log('val',await p.locator('input[name=supplier_order_id]:visible').inputValue());
 await sub.click({timeout:5000});await p.waitForTimeout(4000);await shot('G1-sent-'+ref);
});
