const {api}=require('./lib');
(async()=>{
 const P='/api/admin/workspaces/sourcing';
 let x=await api('sourcing','GET',P+'/sources/catalog');
 console.log(x.body.connectors.map(c=>`${c.adapter}:avail=${c.available}:ref=${c.existing_source_ref}`).join(' | '));
 let s=await api('sourcing','GET',P+'/catalog-suppliers');
 console.log(s.body.filter(r=>!/^E2E-HUB|^Audit/.test(r.name)).map(r=>r.name+'/'+r.platform).join(' | '));
 x=await api('sourcing','GET',P+'/');
 console.log(JSON.stringify(x.body).slice(0,1500));
})();
