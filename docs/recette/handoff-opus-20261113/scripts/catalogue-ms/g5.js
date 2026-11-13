const {api,fs}=require('./lib');
(async()=>{
 const P='/api/admin/workspaces/sourcing';
 const x=await api('sourcing','GET',P+'/');
 const c=x.body.candidates.filter(q=>!/^E2E/.test(q.product_name||'')&&!/^E2E/.test(q.supplier_name||''));
 console.log('non-E2E candidates',c.length);
 c.forEach(q=>console.log(q.candidate_ref,q.product_ref,'|',q.supplier_name,'|',(q.product_name||'').slice(0,40),'|',q.state||q.status,'|img',!!q.image_url,'|',q.purchase_price,q.currency));
 console.log('suppliers',JSON.stringify(x.body.suppliers).slice(0,400));
 console.log('sources',(x.body.sources||[]).filter(s=>s.status!=='archived').slice(0,12).map(s=>s.source_ref+':'+s.status).join(' '));
 fs.writeFileSync('cands.json',JSON.stringify(c,null,1));
})();
