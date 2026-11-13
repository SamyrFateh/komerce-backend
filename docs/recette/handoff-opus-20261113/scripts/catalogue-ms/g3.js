const {api}=require('./lib');
(async()=>{
 for (const [r,m] of [['market-operator','KM'],['cm-market-operator','CM']]){
 const x=await api(r,'GET','/api/admin/workspaces/pricing/market/'+m);
 console.log(r,x.status,typeof x.body==='object'?Object.keys(x.body):x.body);
 const b=x.body; if(b&&typeof b==='object'){ for(const k of Object.keys(b)){const v=b[k]; console.log(' ',k,Array.isArray(v)?'arr'+v.length:typeof v==='object'&&v?Object.keys(v).slice(0,12).join(','):v)} }
 const c=await api(r,'GET','/api/admin/workspaces/pricing/market/'+m+'/commercial-prices');
 console.log(' commercial-prices',c.status,JSON.stringify(c.body).slice(0,600));
 const l=await api(r,'GET','/api/markets/'+m+'/local-stock');
 console.log(' local-stock',l.status,JSON.stringify(l.body).slice(0,700));
 }
})();
