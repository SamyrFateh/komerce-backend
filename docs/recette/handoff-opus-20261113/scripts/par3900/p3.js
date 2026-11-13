const {B}=require('./api.js');
(async()=>{
 const r=await fetch(B+'/api/products?market=KM&limit=500',{headers:{origin:B}});const j=await r.json();
 for(const p of j.products)console.log(p.product_ref,p.name.slice(0,30),p.is_available,p.purchasable,p.has_variants,p.stock,p.sourcing_source,p.market_price_amount,p.market_price_currency);
})();
