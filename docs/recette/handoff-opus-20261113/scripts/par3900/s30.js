const {run,B}=require('./R.js');
run(process.env.ROLE||'agent-hub',async({p,shot,btns,log})=>{
 await p.goto(B+'/admin/workspaces/shipping-customs?market=KM',{waitUntil:'domcontentloaded'});await p.waitForTimeout(7000);await shot('O1-exp-douane');
 const t=(await p.locator('body').innerText()).replace(/\s+/g,' ');const i=t.indexOf('CLAUDE-PAR-20261113-EXP');console.log('idx',i,t.slice(Math.max(0,i-200),i+700));
 console.log((await btns()).slice(0,30));
});
