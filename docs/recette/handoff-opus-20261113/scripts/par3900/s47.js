const {run,B}=require('./R.js');
run('agent-relais',async({p,shot,btns,S,log})=>{
 await p.goto(B+'/admin/relais-live?view=execute&market=KM',{waitUntil:'domcontentloaded'});await p.waitForTimeout(6000);
 await p.getByText('Retours & SAV',{exact:true}).first().click();await p.waitForTimeout(2500);
 await p.locator('input[placeholder="Référence commande"]').fill('KC692IV');await p.getByRole('button',{name:'Rechercher'}).click();await p.waitForTimeout(3000);
 const sels=p.locator('select:visible');const n=await sels.count();
 await sels.nth(n-2).selectOption({index:1});
 await sels.nth(n-1).selectOption({label:'Produit défectueux'});
 await p.locator('textarea:visible').fill('CLAUDE-PAR-20261113 : débardeur défectueux (couture), retour après remise');
 await p.getByRole('button',{name:'Ouvrir le dossier SAV'}).click();await p.waitForTimeout(4000);
 await shot('X2-dossier-ouvert');
 const t=(await p.locator('body').innerText()).replace(/\s+/g,' ');const i=t.indexOf('KC692IV',t.indexOf('REPRISE PHYSIQUE'));console.log(t.slice(i-50,i+400));
 console.log(await btns());
});
