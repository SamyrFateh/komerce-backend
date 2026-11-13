const {api,B}=require('./api.js');
(async()=>{
 for(const u of ['/api/products?market=KM&limit=500','/api/shop/products?market=KM&limit=500','/api/catalog/products?market=KM&limit=500','/api/admin/products?limit=5']){
  const r=await fetch(B+u,{headers:{origin:B}});const t=await r.text();console.log(u,r.status,t.slice(0,200));
 }
})();
