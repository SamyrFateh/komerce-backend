const fs=require('fs');const {run,B,S}=require('./R.js');
const code=fs.readFileSync(S+'/.code.admin','utf8').replace(/[^A-Z0-9]/gi,'').toUpperCase();
const seq=(process.env.SEQ||'empty,last4,wrong,wrong').split(',');
run('agent-relais',async({p,shot,btns,log})=>{
 await p.goto(B+'/admin/relais-live?view=execute&market=KM',{waitUntil:'domcontentloaded'});await p.waitForTimeout(6000);
 await p.getByText('Remises',{exact:true}).first().click().catch(()=>{});await p.waitForTimeout(2000);
 const inp=p.locator('input[placeholder="Code complet (8 caractères)"]');
 console.log('select opts',await p.evaluate(()=>[...document.querySelectorAll('select')].filter(e=>e.offsetParent).slice(-1).map(e=>[...e.options].map(o=>o.text).join('/'))));
 for(const k of seq){
  const v=k==='empty'?'':k==='last4'?code.slice(-4):k==='wrong'?'ZZZZ2222':k==='good'?code:k;
  await inp.fill(v);const n=log.length;
  await p.getByRole('button',{name:'Vérifier et remettre'}).click();await p.waitForTimeout(3500);
  console.log('>>',k,'=>',log.slice(n).map(x=>x.replace(/"[A-Z0-9]{8}"/g,'"********"')).join(' | ').slice(0,420)||'(aucune requête : refus côté interface)');
  await shot('V-'+k+'-'+Date.now()%100000);
 }
});
