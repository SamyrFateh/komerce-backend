const {run,B}=require('./R.js');
run('agent-hub',async({p,shot,btns,log})=>{
 await p.goto(B+'/admin/hub-live?view=execute&market=KM',{waitUntil:'domcontentloaded'});await p.waitForTimeout(8000);
 await p.getByRole('button',{name:'KC692IV',exact:true}).first().click();await p.waitForTimeout(1500);
 await p.getByRole('button',{name:/Préparer le sac KC692IV/}).click();await p.waitForTimeout(3000);
 await p.evaluate(()=>window.scrollBy(0,600));await shot('J1-sac-form');
 console.log(await p.evaluate(()=>[...document.querySelectorAll('input,select,textarea')].filter(e=>e.offsetParent&&e.name!=='reference'&&e.type!=='checkbox').map(e=>e.tagName+':'+e.type+':'+(e.name||e.id)+':'+(e.placeholder||'')+'='+e.value+':'+(e.tagName==='SELECT'?[...e.options].map(o=>o.text.slice(0,30)).join('/'):'')).slice(0,16)));
 console.log((await btns()).slice(-8));
});
