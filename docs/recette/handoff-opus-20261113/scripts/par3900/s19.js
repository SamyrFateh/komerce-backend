const {run,B}=require('./R.js');
run('agent-hub',async({p,shot,btns,log})=>{
 await p.goto(B+'/admin/hub-live?view=execute&market=KM',{waitUntil:'domcontentloaded'});await p.waitForTimeout(8000);
 await p.getByRole('button',{name:'KC692IV',exact:true}).first().click();await p.waitForTimeout(1500);
 await p.locator('[data-hlc-action=open-physical-details]').first().click();await p.waitForTimeout(2000);
 await p.locator('select:visible').filter({hasText:'Mode dégradé · constat manuel'}).first().selectOption({label:'Mode dégradé · constat manuel'});await p.waitForTimeout(1000);
 const t=p.locator('select:visible').filter({hasText:'Mode dégradé'}).first();await t.scrollIntoViewIfNeeded();await p.evaluate(()=>window.scrollBy(0,-150));
 await shot('J2-sac-manuel');
 console.log(await p.evaluate(()=>[...document.querySelectorAll('input,select,textarea')].filter(e=>e.offsetParent&&e.name!=='reference'&&e.type!=='checkbox').map(e=>e.tagName+':'+(e.name||e.id)+':'+(e.placeholder||'')+'='+e.value).slice(-9)));
 console.log((await btns()).slice(-10));
});
