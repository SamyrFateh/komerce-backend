const {run,B}=require('./R.js');
const act=process.argv[2];
run('admin',async({p,shot,btns,log,S})=>{
 await p.goto(B+'/admin/workspaces/shipping-customs?market=KM',{waitUntil:'domcontentloaded'});await p.waitForTimeout(7000);
 await p.getByRole('button',{name:'Arrivée & douane'}).click();await p.waitForTimeout(2500);
 await p.locator('tr',{hasText:'CLAUDE-PAR-20261113-DOUANE0'}).getByRole('button',{name:act}).click();await p.waitForTimeout(4000);
});
