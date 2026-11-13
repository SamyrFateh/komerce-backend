const {run,B}=require('./R.js');
run('agent-hub',async({p,shot,btns,log})=>{
 await p.goto(B+'/admin/hub-live?view=execute&market=KM',{waitUntil:'domcontentloaded'});await p.waitForTimeout(7000);
 await p.getByRole('button',{name:'KC692IV',exact:true}).first().click();await p.waitForTimeout(1000);
 await p.locator('[data-hlc-action=open-physical-details]').first().click();await p.waitForTimeout(1500);
 const row=p.locator('tr',{hasText:'KOM-BOX-4290B893227D2A4A7A'}).last();await row.scrollIntoViewIfNeeded();
 const sel=p.locator('select:visible').filter({hasText:/CLAUDE-PAR-20261113-EXP|Aucune expédition/}).first();const o=await sel.locator('option').allTextContents();console.log('opts',o);
 await sel.selectOption({label:o.find(x=>/CLAUDE-PAR-20261113-EXP/.test(x))});await p.waitForTimeout(800);
 await row.getByRole('button',{name:/Rattacher/}).click();await p.waitForTimeout(4000);await shot('N3-rattache');
});
