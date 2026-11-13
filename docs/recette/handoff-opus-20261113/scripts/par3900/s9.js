const {run,B}=require('./R.js');
run('hub-director',async({p,shot,txt,btns,log,S})=>{
 await p.goto(B+'/admin/hub-live?view=execute&market=KM',{waitUntil:'domcontentloaded'});await p.waitForTimeout(8000);
 const c=p.getByText(/PO-9F3A/).first();console.log('card',await c.count());
 await c.click();await p.waitForTimeout(2000);await shot('E1-po-cj');
 console.log((await btns()).filter(x=>!/E2E|Anomalie/.test(x)).slice(5));
});
