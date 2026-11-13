const {run,B}=require('./R.js');
run('agent-hub',async({p,shot,btns,log})=>{
 await p.goto(B+'/admin/hub-live?view=execute&market=KM',{waitUntil:'domcontentloaded'});await p.waitForTimeout(8000);
 await p.getByText('Actions Hub',{exact:true}).first().click();await p.waitForTimeout(3000);
 const row=p.locator('tr',{hasText:'KC692IV'});console.log('rows',await row.count());
 await shot('I1-repartir-avant');
 await row.getByRole('button',{name:'Répartir',exact:true}).click();await p.waitForTimeout(4000);
 await shot('I2-repartir-apres');
 console.log((await p.locator('body').innerText()).replace(/\s+/g,' ').match(/KC692IV[^|]{0,200}/g));
});
