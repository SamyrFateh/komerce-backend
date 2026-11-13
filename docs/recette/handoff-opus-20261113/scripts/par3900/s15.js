require('./hubpo.js')('agent-hub',process.argv[2],async({p,shot,btns,log})=>{
 await p.getByRole('button',{name:/Confirmation fournisseur/}).first().click();await p.waitForTimeout(2500);
 const sub=p.getByRole('button',{name:'Enregistrer la confirmation',exact:true});await sub.scrollIntoViewIfNeeded();
 console.log(await p.evaluate(()=>[...document.querySelectorAll('input[type=number]')].filter(e=>e.offsetParent).map(e=>(e.closest('label,div')||{}).innerText.replace(/\s+/g,' ').slice(0,100)+'|val='+e.value)));
 await p.locator('input[name=supplier_order_id]:visible').fill('CLAUDE-PAR-20261113-CJ-ORDER');
 await sub.click();await p.waitForTimeout(1500);await shot('H2-confirm-cj-refus');await p.locator('input[name=purchase_proof_ref]:visible').fill('CLAUDE-PAR-20261113 capture commande CJ');await p.locator('input[name=seller_label]:visible').fill('CJ Dropshipping (recette CLAUDE-PAR-20261113)');await sub.click();await p.waitForTimeout(4000);await shot('H2-confirm-cj');
});
