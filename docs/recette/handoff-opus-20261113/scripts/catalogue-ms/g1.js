const {api}=require('./lib');
(async()=>{
 const P='/api/admin/workspaces/sourcing';
 for(const [r,p] of [['sourcing',P+'/sources/catalog'],['sourcing',P+'/catalog-suppliers']]){
  const x=await api(r,'GET',p);console.log(p,x.status,JSON.stringify(x.body).slice(0,1800));
 }
})();
