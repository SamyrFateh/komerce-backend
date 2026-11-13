require('./hubpo.js')('hub-director','PO-9F3A',async({p,shot,btns})=>{
 await p.getByRole('button',{name:/Valider l.engagement d.achat/}).click();await p.waitForTimeout(2000);await shot('E2-form-eng');
 console.log(await p.evaluate(()=>[...document.querySelectorAll('input,select,textarea')].filter(e=>e.offsetParent&&e.type!=='checkbox'&&!/reference$/.test(e.name||'')).map(e=>e.tagName+':'+e.type+':'+(e.name||e.id)+':'+(e.placeholder||'')+':'+(e.tagName==='SELECT'?[...e.options].map(o=>o.text).join('/'):'')).slice(0,20)));
 console.log((await btns()).slice(-8));
});
