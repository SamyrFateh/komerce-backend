/** @komerce-arch-lite
 * @role g6-canonical-scenario-profile
 * @domain orders
 * @layer test
 * @owner backend-core
 * @purpose Effective buyer parameters per G6_CANONICAL_SCENARIO (M01 fixed catalogue product, M02 resolved LOCAL_STOCK product).
 * @impact-areas staging-only
 */
'use strict';
const {scenarioProfile}=require('./stage-registry');
// M01 : paramètres historiques, jamais influencés par l'environnement (non-régression testée).
const M01_PRODUCT_REF='KPR-000165';
const M01_MARKET_PRICE=Object.freeze({KM:5990,CM:7987,CG:7987});
// M03 : panier mixte résolu en lecture seule (1 ligne LOCAL_STOCK + lignes IMPORT de >=3 sources distinctes).
const REF_RE=/^[A-Z0-9][A-Z0-9-]{2,63}$/i;
function mixedBasketParams(env,market){
 let b;try{b=JSON.parse(String(env.G6_M03_BASKET||''))}catch(_){b=null}
 const bad=p=>!p||!REF_RE.test(String(p.product_ref||''))||!Number.isInteger(p.price)||p.price<=0;
 if(!b||bad(b.local)||!Array.isArray(b.imports)||b.imports.some(bad))throw Error('G6_M03_BASKET_NOT_BOUND');
 if(b.local.product_ref===M01_PRODUCT_REF)throw Error('G6_M03_LOCAL_PRODUCT_IS_M01_REFERENCE');
 const sources=new Set(b.imports.map(p=>p.source_key));
 if(b.imports.length<3||sources.size<3||sources.has(undefined)||sources.has(null))throw Error('G6_M03_IMPORT_SOURCES_BELOW_3');
 const lines=[{product_ref:b.local.product_ref,price:b.local.price,fulfillment:'LOCAL_STOCK'},
  ...b.imports.map(p=>({product_ref:p.product_ref,price:p.price,fulfillment:'IMPORT',source_key:p.source_key}))];
 if(new Set(lines.map(l=>l.product_ref)).size!==lines.length)throw Error('G6_M03_BASKET_DUPLICATE_PRODUCT');
 return Object.freeze({scenario:'M03',market,product_ref:lines[0].product_ref,
  expected_price:lines.reduce((n,l)=>n+l.price,0),source:'RESOLVED_MIXED_BASKET',fulfillment:'MIXED',
  basket:Object.freeze(lines.map(Object.freeze))});
}
// Lignes de panier effectives : M01/M02 = une seule ligne (inchangé), M03 = panier mixte.
function basketLines(params){
 // N33 : un produit, deux variantes (SKU distincts), une unité chacune.
 if(params.variants)return params.variants.map(v=>({product_ref:params.product_ref,price:params.unit_price,fulfillment:null,sku_id:v.sku_id,variant_combo:v.variant_combo}));
 return params.basket||[{product_ref:params.product_ref,price:params.expected_price,fulfillment:params.fulfillment}];
}
// N33 : produit vendable à >= 2 SKU distincts, résolu en lecture seule (adaptateur) puis lié par G6_N33_VARIANTS.
function multiVariantParams(env,market){
 let v;try{v=JSON.parse(String(env.G6_N33_VARIANTS||''))}catch(_){v=null}
 const ok=v&&REF_RE.test(String(v.product_ref||''))&&Number.isInteger(v.price)&&v.price>0&&Array.isArray(v.skus)&&v.skus.length===2&&
  v.skus.every(k=>/^[a-f0-9-]{36}$/i.test(String(k.sku_id||''))&&k.variant_combo&&typeof k.variant_combo==='object')&&
  v.skus[0].sku_id!==v.skus[1].sku_id&&JSON.stringify(v.skus[0].variant_combo)!==JSON.stringify(v.skus[1].variant_combo);
 if(!ok)throw Error('G6_N33_VARIANTS_NOT_BOUND');
 return Object.freeze({scenario:'N33',market,product_ref:v.product_ref,expected_price:v.price*2,unit_price:v.price,
  source:'RESOLVED_MULTI_SKU',fulfillment:null,variants:Object.freeze(v.skus.map(k=>Object.freeze({sku_id:k.sku_id,variant_combo:k.variant_combo})))});
}
function buyerParams(env=process.env){
 const scenario=scenarioProfile(env.G6_CANONICAL_SCENARIO||'M01');
 const market=String(env.G6_TARGET_MARKET||'KM').toUpperCase();
 // Scénarios négatifs : N07 = produit Golden M01 ; N33 = multi-SKU ; N04 et N09 = produit LOCAL_STOCK comme M02.
 if(['N07','N08','N10'].includes(scenario))return Object.freeze({scenario,market,product_ref:M01_PRODUCT_REF,
  expected_price:M01_MARKET_PRICE[market],source:'FIXED_CATALOGUE',fulfillment:null});
 if(scenario==='N33')return multiVariantParams(env,market);
 if(scenario==='M01')return Object.freeze({scenario,market,product_ref:M01_PRODUCT_REF,
  expected_price:M01_MARKET_PRICE[market],source:'FIXED_CATALOGUE',fulfillment:null});
 if(scenario==='M03')return mixedBasketParams(env,market);
 const ref=String(env.G6_BUYER_PRODUCT_REF||''),price=Number(env.G6_BUYER_EXPECTED_PRICE);
 if(!/^[A-Z0-9][A-Z0-9-]{2,63}$/i.test(ref)||!Number.isInteger(price)||price<=0)
  throw Error('G6_M02_LOCAL_STOCK_PRODUCT_NOT_BOUND');
 return Object.freeze({scenario,market,product_ref:ref,expected_price:price,
  source:'RESOLVED_LOCAL_STOCK',fulfillment:'LOCAL_STOCK'});
}
module.exports={buyerParams,basketLines,M01_PRODUCT_REF,M01_MARKET_PRICE};
