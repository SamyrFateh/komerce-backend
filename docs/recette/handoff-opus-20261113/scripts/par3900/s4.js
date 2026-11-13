const {run,B}=require('./R.js');
run('agent-hub',async({p,shot,txt,btns,log})=>{
 await p.goto(B+'/admin/hub-live?view=execute&market=KM',{waitUntil:'domcontentloaded'});await p.waitForTimeout(8000);
 await p.getByRole('button',{name:/Anomalie KC692IV/}).click();await p.waitForTimeout(3000);
 await shot('D2-anomalie');
 const b=await btns();console.log(b.filter(x=>!/E2E-HUB/.test(x)));
 const t=(await p.locator('body').innerText()).replace(/\s+/g,' ');const i=t.indexOf('KC692IV',t.indexOf('KC692IV')+20);console.log(t.slice(Math.max(0,i-300),i+900));
});
