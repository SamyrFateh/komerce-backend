const {run,B}=require('./R.js');
run('agent-hub',async({p,shot,btns,log})=>{
 await p.goto(B+'/admin/hub-live?view=execute&market=KM',{waitUntil:'domcontentloaded'});await p.waitForTimeout(8000);
 await p.getByRole('button',{name:'KC692IV',exact:true}).first().click();await p.waitForTimeout(1500);
 await p.locator('[data-hlc-action=open-physical-details]').first().click();await p.waitForTimeout(2000);
 const names=['Legging','Débardeur','Casserole'];
 for(let k=1;k<3;k++){
  if(!(await p.locator('select:visible').filter({hasText:'dispo'}).count())){await p.locator('[data-hlc-action=open-physical-details]').first().click();await p.waitForTimeout(2000);}
  const art=p.locator('select:visible').filter({hasText:'dispo'}).first();
  const labels=await art.locator('option').allTextContents();console.log('opts',labels.map(x=>x.slice(0,30)));
  await art.selectOption({index:0});
  const meth=p.locator('select:visible').filter({hasText:'Mode dégradé · constat manuel'}).first();await meth.selectOption({label:'Mode dégradé · constat manuel'});
  const pr=p.locator('input[placeholder^="Preuve du constat manuel"]:visible');
  if(false){await pr.fill('abc');await p.getByRole('button',{name:'Déposer dans le sac'}).click();await p.waitForTimeout(2500);console.log('apres preuve courte');}
  await pr.fill('CLAUDE-PAR-20261113 constat manuel article '+(k+1));
  await p.getByRole('button',{name:'Déposer dans le sac'}).click();await p.waitForTimeout(4000);
  await shot('J3-depot-'+k);
 }
});
