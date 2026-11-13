const {run,B}=require('./R.js');
run('agent-hub',async({p,shot,btns,log})=>{
 await p.goto(B+'/admin/hub-live?view=execute&market=KM',{waitUntil:'domcontentloaded'});await p.waitForTimeout(8000);
 await p.getByRole('button',{name:'KC692IV',exact:true}).first().click();await p.waitForTimeout(1500);
 await p.locator('[data-hlc-action=open-physical-details]').first().click();await p.waitForTimeout(2500);
 console.log((await btns()).filter(x=>!/E2E-HUB|^KC|KUYI|KRJ/.test(x)));
 console.log(await p.evaluate(()=>[...document.querySelectorAll('input,select,textarea')].filter(e=>e.offsetParent&&e.name!=='reference'&&e.type!=='checkbox').map(e=>(e.placeholder||e.name||e.tagName)+'='+e.value+(e.tagName==='SELECT'?'['+[...e.options].map(o=>o.text.slice(0,28)).join('/')+']':'')).slice(-8)));
});
