const {run,B}=require('./R.js');
run('agent-relais',async({p,shot,txt,btns})=>{
 await p.goto(B+'/admin/relais-live?view=execute&market=KM',{waitUntil:'domcontentloaded'});await p.waitForTimeout(6000);
 await shot('C1-relais-live');
 console.log(await txt('body',1800));
 console.log(await btns());
});
