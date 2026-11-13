const {run,B}=require('./R.js');
run('agent-hub',async({p,shot,btns,log})=>{
 await p.goto(B+'/admin/hub-live?view=execute&market=KM',{waitUntil:'domcontentloaded'});await p.waitForTimeout(8000);
 await p.getByRole('button',{name:'KC692IV',exact:true}).first().click();await p.waitForTimeout(1500);
 const t=(await p.locator('body').innerText()).replace(/\s+/g,' ');const i=t.indexOf('FIL DE KC692IV');console.log(t.slice(i,i+1400));
 console.log((await btns()).slice(-6));
});
