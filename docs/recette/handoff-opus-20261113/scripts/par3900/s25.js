const {run,B}=require('./R.js');
run('agent-hub',async({p,shot,btns,log})=>{
 await p.goto(B+'/admin/hub-live?view=execute&market=KM',{waitUntil:'domcontentloaded'});await p.waitForTimeout(8000);
 await p.getByRole('button',{name:'KC692IV',exact:true}).first().click();await p.waitForTimeout(1500);
 await p.locator('[data-hlc-action=open-physical-details]').first().click();await p.waitForTimeout(2500);
 console.log(await p.evaluate(()=>[...document.querySelectorAll('[data-workspace-action],[data-hlc-action]')].filter(e=>e.offsetParent).map(e=>(e.dataset.workspaceAction||e.dataset.hlcAction)+':'+e.innerText.slice(0,30)).filter(x=>!/^\w+:E2E/.test(x)).slice(-25)));
 console.log(await p.evaluate(()=>[...document.querySelectorAll('input')].filter(e=>e.offsetParent).map(e=>e.placeholder||e.name).slice(-10)));
});
