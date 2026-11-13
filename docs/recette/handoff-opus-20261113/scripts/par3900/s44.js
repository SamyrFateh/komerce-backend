const {run,B}=require('./R.js');
run('agent-relais',async({p,shot,btns,S})=>{
 await p.goto(B+'/admin/relais-live?view=execute&market=KM',{waitUntil:'domcontentloaded'});await p.waitForTimeout(6000);
 await p.getByText('Remises',{exact:true}).first().click().catch(()=>{});await p.waitForTimeout(2500);
 console.log((await p.locator('body').innerText()).replace(/\s+/g,' ').slice(250,1300));
 console.log(await btns());
 console.log(await p.evaluate(()=>[...document.querySelectorAll('input,select,textarea')].filter(e=>e.offsetParent&&e.name!=='reference').map(e=>e.tagName+':'+(e.name||e.id)+':'+(e.placeholder||'')).slice(0,10)));
 await p.screenshot({path:S+'/shots/U1-remises.png',fullPage:true});
});
