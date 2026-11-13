const {run,B}=require('./R.js');
run('agent-hub',async({p,shot,txt,btns,log,S})=>{
 await p.goto(B+'/admin/hub-live?view=execute&market=KM',{waitUntil:'domcontentloaded'});await p.waitForTimeout(8000);
 const c=p.getByText(/Casserole en aluminium avec couvercle — /).first();console.log('card',await c.count());
 await c.click();await p.waitForTimeout(2000);await shot('D10-need-casserole');
 await p.getByRole('button',{name:/Constituer une PO · 1 u/}).click();await p.waitForTimeout(4000);await shot('D11-po-casserole');console.log((await btns()).filter(x=>!/E2E|Anomalie/.test(x)).slice(6));
});
