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
function buyerParams(env=process.env){
 const scenario=scenarioProfile(env.G6_CANONICAL_SCENARIO||'M01');
 const market=String(env.G6_TARGET_MARKET||'KM').toUpperCase();
 if(scenario==='M01')return Object.freeze({scenario,market,product_ref:M01_PRODUCT_REF,
  expected_price:M01_MARKET_PRICE[market],source:'FIXED_CATALOGUE',fulfillment:null});
 const ref=String(env.G6_BUYER_PRODUCT_REF||''),price=Number(env.G6_BUYER_EXPECTED_PRICE);
 if(!/^[A-Z0-9][A-Z0-9-]{2,63}$/i.test(ref)||!Number.isInteger(price)||price<=0)
  throw Error('G6_M02_LOCAL_STOCK_PRODUCT_NOT_BOUND');
 return Object.freeze({scenario,market,product_ref:ref,expected_price:price,
  source:'RESOLVED_LOCAL_STOCK',fulfillment:'LOCAL_STOCK'});
}
module.exports={buyerParams,M01_PRODUCT_REF,M01_MARKET_PRICE};
