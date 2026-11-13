const {api}=require('./api.js');
(async()=>{
 for(const q of ['KPR-000144','KPR-000141','KPR-000124','KPR-000162','KPR-000163']){
  const r=await api('admin','GET','/api/products?search='+q+'&limit=3');
  const l=r.j.products||r.j.items||r.j.data||r.j;console.log(q,r.s,JSON.stringify(l).slice(0,400));
 }
})();
