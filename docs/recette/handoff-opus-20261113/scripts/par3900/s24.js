const {run,B}=require('./R.js');
run('agent-hub',async({p,shot,btns,log})=>{
 await p.goto(B+'/admin/hub-live?view=execute&market=KM',{waitUntil:'domcontentloaded'});await p.waitForTimeout(8000);
 await p.getByRole('button',{name:'KC692IV',exact:true}).first().click();await p.waitForTimeout(1500);
 await p.locator('[data-hlc-action=open-physical-details]').first().click();await p.waitForTimeout(2500);
 await p.getByRole('button',{name:'Créer une KOM-BOX'}).click();await p.waitForTimeout(4000);await shot('K2-box-creee');
 console.log((await btns()).filter(x=>!/E2E-HUB|^KC|KUYI|KRJ/.test(x)).slice(6));
 const t=(await p.locator('body').innerText()).replace(/\s+/g,' ');const i=t.indexOf('FIL DE KC692IV');console.log(t.slice(i,i+900));
});
