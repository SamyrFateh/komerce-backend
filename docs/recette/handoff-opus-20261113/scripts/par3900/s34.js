const {run,B}=require('./R.js');
run('admin',async({p,shot,btns,log,S})=>{
 await p.goto(B+'/admin/workspaces/shipping-customs?market=KM',{waitUntil:'domcontentloaded'});await p.waitForTimeout(7000);
 await p.getByRole('button',{name:'Arrivée & douane'}).click();await p.waitForTimeout(3000);
 await p.screenshot({path:S+'/shots/Q1-douane.png',fullPage:true});
 console.log((await p.locator('body').innerText()).replace(/\s+/g,' ').slice(300,1800));
 console.log(await btns());
});
