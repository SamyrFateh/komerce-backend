const {run,B}=require('./R.js');
run('agent-relais',async({p,shot,btns,S})=>{
 await p.goto(B+'/admin/relais-live?view=execute&market=KM',{waitUntil:'domcontentloaded'});await p.waitForTimeout(6000);
 console.log((await p.locator('body').innerText()).replace(/\s+/g,' ').slice(200,1400));
 console.log(await btns());
 await p.screenshot({path:S+'/shots/R1-relais.png',fullPage:true});
});
