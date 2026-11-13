const {run,B}=require('./R.js');
module.exports=async function(role,ref,after){
return run(role,async(ctx)=>{const {p,shot,btns}=ctx;
 await p.goto(B+'/admin/hub-live?view=execute&market=KM',{waitUntil:'domcontentloaded'});await p.waitForTimeout(8000);
 const ok=await p.evaluate(ref=>{const els=[...document.querySelectorAll('article,div,li,button')].filter(e=>e.offsetParent&&e.innerText&&e.innerText.trim().startsWith(ref)&&/Brouillon|Validation/.test(e.innerText)&&e.innerText.length<600);els.sort((a,b)=>a.innerText.length-b.innerText.length);const t=els[els.length-1];if(!t)return 'none';t.scrollIntoView();t.click();return t.tagName+':'+t.innerText.length},ref);
 console.log('click',ok);await p.waitForTimeout(2000);await shot('PO-'+ref+'-'+role);
 console.log((await btns()).filter(x=>!/E2E|Anomalie|^KC692IV|KUYIYUK|KRJ7I90|Sourcing requis|autres/.test(x)).slice(5));
 if(after)await after(ctx);
});}
