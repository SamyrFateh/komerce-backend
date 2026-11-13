const {run,B}=require('./R.js');
run('agent-relais',async({p,shot,txt,btns,log})=>{
 await p.goto(B+'/admin/relais-live?view=execute&market=KM',{waitUntil:'domcontentloaded'});await p.waitForTimeout(6000);
 await p.locator('tr',{hasText:'KC692IV'}).getByRole('button',{name:'Encaisser',exact:true}).click();await p.waitForTimeout(3000);
 await shot('C2-encaisser');console.log(await txt('body',600));console.log(await btns());
});
