// usage: node step.js role PO-REF "Bouton" [proof]
const [,,role,ref,btn,proof,sub]=process.argv;
require('./hubpo.js')(role,ref,async({p,shot,btns})=>{
 await p.getByRole('button',{name:new RegExp(btn)}).first().click();await p.waitForTimeout(2000);
 if(proof){const f=p.locator('input[name=proof_ref]:visible');if(await f.count()){await f.first().fill(proof);}}
 if(sub){await p.getByRole('button',{name:sub,exact:true}).click();await p.waitForTimeout(4000)}
 await shot('F-'+ref+'-'+btn.slice(0,8));
 console.log('inputs',await p.evaluate(()=>[...document.querySelectorAll('input,select,textarea')].filter(e=>e.offsetParent&&e.type!=='checkbox'&&!/reference$/.test(e.name||'')&&!/^$/.test(e.name||e.id||e.placeholder)).map(e=>e.tagName+':'+(e.name||e.id)+':'+(e.placeholder||'')).slice(0,12)));
 console.log((await btns()).slice(-5));
});
