'use strict';
const {classify,audit}=require('../../scripts/recette/demo60/readiness');
test('missing product fails closed',()=>expect(classify(null,[])).toEqual({status:'MISSING',blockers:['PRODUCT_MISSING']}));
test('a fully exposed product is only ready for a checkout probe, not certified',()=>{
 const product={is_active:true,is_available:true,image_url:'/images/demo.jpg',stock:10,boutique_category_key:'Maison',boutique_subcategory_key:'Cuisine'};
 expect(classify(product,[{is_active:true,status:'LOCAL_ACTIVE',amount:15000,commercial_exposure:'ENABLED'}])).toEqual({status:'CATALOG_READY_FOR_CHECKOUT_PROBE',blockers:[]});
});
test('no image and no market price remain blocked',()=>{
 const result=classify({is_active:true,is_available:true,stock:5,boutique_category_key:'Maison',boutique_subcategory_key:'Cuisine'},[]);
 expect(result.blockers).toEqual(expect.arrayContaining(['IMAGE_MISSING','NO_ACTIVE_MARKET_PRICE_AND_EXPOSURE']));
});
test('audit refuses non-staging before any db query',async()=>{
 await expect(audit({env:{KOMERCE_ENV:'production'}})).rejects.toThrow('DEMO60_STAGING_ONLY');
});
