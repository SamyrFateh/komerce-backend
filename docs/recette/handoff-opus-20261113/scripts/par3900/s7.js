const {run,B}=require('./R.js');
run('agent-hub',async({p,shot,txt,btns,log,S})=>{
 await p.goto(B+'/admin/hub-live?view=execute&market=KM',{waitUntil:'domcontentloaded'});await p.waitForTimeout(8000);
 await p.getByRole('button',{name:'KC692IV',exact:true}).first().click();await p.waitForTimeout(1500);
 await p.getByRole('button',{name:/Résoudre le sourcing/}).first().click();await p.waitForTimeout(4000);
 await shot('D7-sourcing');
 await p.locator('select:visible').nth(2).selectOption({label:'Fournisseur central Hub · déjà associé'});await p.waitForTimeout(1500);
 await p.getByRole('button',{name:"Créer la ligne d'achat"}).click().catch(async()=>{await p.getByRole('button',{name:/Créer la ligne/}).click()});await p.waitForTimeout(4000);await shot('D9-ligne-achat');
 console.log((await btns()).filter(x=>!/E2E|Anomalie/.test(x)).slice(6));
});
