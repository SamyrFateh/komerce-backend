const {api,fs}=require('./lib');
const [,, role, market, ref]=process.argv;
(async()=>{
 const b=`/api/admin/workspaces/pricing/market/${market}/products/${ref}/local-price`;
 const log=(m,x)=>{const l=`${new Date().toISOString()} ${market} ${ref} ${m} ${x.status} ${JSON.stringify(x.body).slice(0,350)}`;console.log(l);fs.appendFileSync('journal.log',l+'\n')};
 let p=await api(role,'POST',b+'/price-preview',{amount:1000});log('probe',p);
 const min=p.body.minimum_safe_price_local; if(!min){console.log('NO_MIN');return}
 const amount=Math.ceil(min*1.15/100)*100;
 p=await api(role,'POST',b+'/price-preview',{amount});log('preview '+amount,p);
 if(!p.body.can_proceed||p.body.requires_acknowledgement||p.body.requires_market_gate){console.log('STOP: gate',amount);return}
 let d=await api(role,'POST',b,{amount,reason:'CLAUDE-PAR-20261113 prix catalogue multi-sources (au-dessus du minimum sur)',source:'market_manager'});log('draft',d);
 if(d.status>=300)return;
 const a=await api(role,'GET',b+'/activation-preview');log('act-preview',a);
 const z=await api(role,'POST',b+'/activate',{reason:'CLAUDE-PAR-20261113 activation catalogue multi-sources',source:'market_manager'});log('activate',z);
})();
