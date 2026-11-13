const {run,B}=require('./R.js');
const N=+(process.env.N||1);
run('agent-hub',async({p,shot,btns,log})=>{
 for(let i=0;i<N;i++){
  await p.goto(B+'/admin/hub-live?view=execute&market=KM',{waitUntil:'domcontentloaded'});await p.waitForTimeout(7000);
  await p.getByRole('button',{name:'KC692IV',exact:true}).first().click();await p.waitForTimeout(1000);
  await p.locator('[data-hlc-action=open-physical-details]').first().click();await p.waitForTimeout(1500);
  const row=p.locator('tr',{hasText:'KOM-BOX-4290B893227D2A4A7A'}).last();await row.scrollIntoViewIfNeeded();
  console.log(i,await row.evaluate(r=>[...r.querySelectorAll('td')].map(t=>t.innerText.trim().slice(0,50)).join(' | ')+' || '+[...r.querySelectorAll('button,select')].map(e=>e.tagName+':'+(e.innerText||[...(e.options||[])].map(o=>o.text.slice(0,40)).join(';'))+(e.disabled?'(off)':'')).join(' ; ')));
  await shot('M-box-'+i);
  const nb=row.getByRole('button',{name:/Étape suivante|Prêt à remettre/});if(!await nb.count())break;
  await nb.first().click();await p.waitForTimeout(3500);
 }
});
