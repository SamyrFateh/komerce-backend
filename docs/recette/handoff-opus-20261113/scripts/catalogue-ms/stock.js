const {session,api,D,B,fs}=require('./lib');
const [,,role,market]=process.argv;
const PRODUCTS=[['21bc5285-7b1a-47c5-a914-7656790816c5','coque',6],['fe2c8a44-d385-45ff-ae5b-8acbd3bf8534','planche',5]];
(async()=>{
 const v=await (await fetch(B+'/health/version')).json();
 const log=m=>{const l=`${new Date().toISOString()} stock ${market} ${m}`;console.log(l);fs.appendFileSync(D+'/journal.log',l+'\n')};
 log('commit '+v.commit.slice(0,9));
 const {br,ctx,p}=await session(role,'stock-'+market);
 p.on('dialog',async d=>{log('DIALOG '+d.message());await d.dismiss()});
 await p.goto(B+'/dashboards/canonical/market-autonomy.html',{waitUntil:'domcontentloaded'});
 await p.waitForSelector('[data-market-local-offer]',{timeout:30000}).catch(()=>log('section absente'));
 await p.screenshot({path:D+`/shot-stock-${market}-0.png`,fullPage:true});
 for(const [pid,label,qty] of PRODUCTS){
  const form=p.locator('[data-market-local-offer] form.kmc-team-invite');
  await form.locator('input[name=product_id]').fill(pid);
  const opts=await form.locator('select[name=relais_id] option').allTextContents();
  const target='CLAUDE-PAR Relais '+market;
  if(!opts.includes(target)){log('relais absent '+JSON.stringify(opts));break}
  await form.locator('select[name=relais_id]').selectOption({label:target});
  await form.locator('input[name=qty_received]').fill(String(qty));
  await form.locator('input[name=proof_ref]').fill(`CLAUDE-PAR-20261113-BL-${market}-${label}`);
  await form.locator('input[name=note]').fill('CLAUDE-PAR-20261113 reception recette catalogue');
  await p.screenshot({path:D+`/shot-stock-${market}-${label}-avant.png`,fullPage:true});
  await form.locator('button[type=submit]').click();
  await p.waitForTimeout(3500);
  log('submitted '+label+' qty '+qty);
  await p.screenshot({path:D+`/shot-stock-${market}-${label}-apres.png`,fullPage:true});
 }
 await ctx.close();await br.close();
 const g=await api(role,'GET','/api/markets/'+market+'/local-stock');
 const mine=(g.body.stock||[]).filter(s=>PRODUCTS.some(x=>x[0]===s.product_id));
 log('result '+JSON.stringify(mine));
})();
