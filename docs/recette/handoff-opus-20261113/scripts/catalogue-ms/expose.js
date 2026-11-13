const {session,api,D,B,fs}=require('./lib');
const [,,role,market]=process.argv;
const IDS={'21bc5285-7b1a-47c5-a914-7656790816c5':'Coque','fe2c8a44-d385-45ff-ae5b-8acbd3bf8534':'Planche'};
(async()=>{
 const log=m=>{const l=`${new Date().toISOString()} expose ${market} ${m}`;console.log(l);fs.appendFileSync(D+'/journal.log',l+'\n')};
 const {br,ctx,p}=await session(role,'expose-'+market);
 p.on('dialog',async d=>{log('DIALOG '+d.message());await d.dismiss()});
 await p.goto(B+'/dashboards/canonical/market-autonomy.html',{waitUntil:'domcontentloaded'});
 await p.waitForSelector('[data-market-local-offer]',{timeout:30000});
 for(const name of Object.values(IDS)){
  const card=p.locator('[data-market-local-offer] article.kmc-team-member',{hasText:name}).filter({hasText:'en stock'}).first();
  const btn=card.locator('button',{hasText:'Exposer'});
  if(await btn.count()===0){log('pas de bouton Exposer pour '+name);continue}
  await btn.click();await p.waitForTimeout(3000);log('exposé '+name);
 }
 await p.screenshot({path:D+`/shot-stock-${market}-final.png`,fullPage:true});
 await ctx.close();await br.close();
 const g=await api(role,'GET','/api/markets/'+market+'/local-stock');
 log('result '+JSON.stringify((g.body.stock||[]).filter(s=>IDS[s.product_id]).map(s=>[s.name.slice(0,12),s.qty_physical,s.commercial_exposure])));
 const pub=await api(role,'GET','/api/products?market='+market);const a=Array.isArray(pub.body)?pub.body:(pub.body.products||[]);
 log('public '+a.length+' '+JSON.stringify(a.filter(x=>/Planche|Coque/.test(x.name)).map(x=>[x.name.slice(0,12),x.stock,x.local_stock,x.price_local||x.price])));
})();
