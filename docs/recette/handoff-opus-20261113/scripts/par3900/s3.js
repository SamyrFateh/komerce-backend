const {run,B}=require('./R.js');
run('agent-hub',async({p,shot,txt,btns,log})=>{
 await p.goto(B+'/admin/hub-live?view=execute&market=KM',{waitUntil:'domcontentloaded'});await p.waitForTimeout(8000);
 await shot('D1-hub');console.log(await txt('body',2500));console.log(await btns());
});
