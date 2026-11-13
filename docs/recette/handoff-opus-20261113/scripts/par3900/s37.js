const {run,B}=require('./R.js');
run('admin',async({p,shot,btns,log,S})=>{
 await p.goto(B+'/admin/workspaces/shipping-customs?market=KM',{waitUntil:'domcontentloaded'});await p.waitForTimeout(7000);
 await p.getByRole('button',{name:'Arrivée & douane'}).click();await p.waitForTimeout(2500);
 await p.getByRole('button',{name:'Nouvelle expédition douane'}).click();await p.waitForTimeout(2500);
 console.log(await p.evaluate(()=>[...document.querySelectorAll('input,select,textarea')].filter(e=>e.offsetParent&&e.type!=='search').map(e=>e.tagName+':'+e.type+':'+(e.name||e.id)+':'+(e.placeholder||'')+'='+(e.type==='checkbox'?e.checked+'/'+(e.closest('label')||{innerText:''}).innerText.slice(0,30):e.value)).slice(0,30)));
 await p.screenshot({path:S+'/shots/Q4-nouvelle-douane.png',fullPage:true});
});
