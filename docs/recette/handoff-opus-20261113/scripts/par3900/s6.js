const {run,B}=require('./R.js');
run('agent-hub',async({p,shot,txt,btns,log,S})=>{
 await p.goto(B+'/admin/hub-live?view=execute&market=KM',{waitUntil:'domcontentloaded'});await p.waitForTimeout(8000);
 const cbs=p.locator('input[type=checkbox]');await cbs.nth(0).check();await cbs.nth(1).check();await p.waitForTimeout(800);
 await p.getByText('Débardeur de sport à dos fendu, coupe ample — CJ').first().click();await p.waitForTimeout(2000);
 await shot('D5-need');
 await p.getByRole('button',{name:/Constituer une PO · 2 u/}).click();await p.waitForTimeout(4000);await shot('D6-po-prepared');console.log((await btns()).filter(x=>!/E2E|Anomalie/.test(x)).slice(6));
});
