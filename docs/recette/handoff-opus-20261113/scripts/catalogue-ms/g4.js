const {api,fs}=require('./lib');
(async()=>{
 const x=await api('market-operator','GET','/api/admin/workspaces/pricing/market/KM');
 const sp=x.body.simulation_products; console.log(Object.keys(sp[0]).join(','));
 const real=sp.filter(p=>!/^E2E|^RCT|^TEST|^\[TEST/i.test(p.name||'')&&!/^E2E/.test(p.product_ref||''));
 console.log('total',sp.length,'real',real.length);
 const c=await api('market-operator','GET','/api/admin/workspaces/pricing/market/KM/commercial-prices');
 const cp=c.body.products; console.log(Object.keys(cp[0]).join(','));
 const st={};cp.forEach(p=>{st[p.decision_status]=(st[p.decision_status]||0)+1});console.log(st);
 fs.writeFileSync('km-real.json',JSON.stringify({real,cp},null,1));
 real.slice(0,60).forEach(p=>console.log(p.product_ref,'|',(p.name||'').slice(0,50),'|',p.supplier_name||p.supplier||'', '|', p.source_platform||p.platform||''));
})();
