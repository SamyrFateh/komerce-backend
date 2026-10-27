'use strict';
/**
 * Read-only P1/P2/P7 wiring; never a new business gate.
 * Exactly ONE persisted order-item is inspected: group carts can contain
 * different products, markets and SKUs and cannot be arbitrarily collapsed.
 * No new endpoints, no HTTP provider, no staging writes, no GO.
 */
const {MAP,evaluateP1P7}=require('./p1-p7-boundary-oracle');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MARKET=/^[A-Z]{2}$/;
function record(id,sourceStatus,targetStatus,sourceIds,targetIds,context={}) {
 const edge=MAP.find(e=>e.id===id);
 return {source:{authority:edge.owner,status:sourceStatus,ids:sourceIds},
   target:{authority:edge.consumer,status:targetStatus,ids:targetIds},context};
}
function statusOfGate(gate) {
 if(gate?.status==='PROVED')return 'PROVED';
 if(gate?.status==='ANOMALIE')return 'BLOCKED';
 return 'UNKNOWN'; // Non-prouvé != interdit. Persisted order != verified checkout.
}
function marketStatus(market,readiness,delivery,forCheckout) {
 if(!market || typeof market.is_active!=='boolean')return 'UNKNOWN';
 if(!market.is_active || (market.lifecycle_status && market.lifecycle_status!=='ACTIVE'))return 'BLOCKED';
 if(forCheckout && delivery?.proven===false)return 'BLOCKED';
 if(forCheckout && !delivery)return 'UNKNOWN';
 if(!readiness || typeof readiness.ready_for_activation!=='boolean')return 'UNKNOWN';
 return readiness.ready_for_activation?'PROVED':'UNKNOWN';
}
async function collectP1P7Canonical(db,{productId,marketCode,orderReference,orderItemId}={},owners={}) {
 if(!db||typeof db.query!=='function')throw Error('Canonical query executor required');
 const code=String(marketCode||'').trim().toUpperCase();
 if(!MARKET.test(code)||!UUID.test(String(productId||''))||!UUID.test(String(orderItemId||''))||
     typeof orderReference!=='string'||!orderReference.trim())
  throw Error('Exact productId, marketCode, orderReference and orderItemId required');
 const {rows}=await db.query(
  'SELECT oi.id AS order_item_id, oi.order_id, oi.product_id, oi.sku_id, '+
  'o.reference, o.simulation_scope, o.market_id, o.relais_id, m.code AS order_market_code '+
  'FROM order_items oi JOIN orders o ON o.id=oi.order_id '+
  'LEFT JOIN markets m ON m.id=o.market_id '+
  'WHERE o.reference=$1 AND oi.id=$2 LIMIT 2',
  [orderReference,orderItemId]);
 if(rows.length!==1)throw Error('Exact order item missing or ambiguous; never use a different item');
 const item=rows[0],expectedProductId=String(productId),errors=[];
 // Do not use requested market to filter the actual order: mismatches must be observable.
 const safe=async(label,fn)=>{
  try{return await fn();}catch(error){
   errors.push({owner:label,code:String(error.code||error.name||'READ_ERROR').slice(0,100)});
   return null;
  }
 };
 const plane=await safe('services/market-control-plane.getControlPlane',()=>{
   const fn=owners.controlPlane||require('../../services/market-control-plane').getControlPlane;
   return fn(db,code);
 });
 const market=plane?.market||null,marketId=market?.id||null;
 const exposure=marketId?await safe('services/catalog-market-exposure-service.getExposure',()=>{
   const fn=owners.exposure||require('../../services/catalog-market-exposure-service').getExposure;
   return fn(expectedProductId,marketId,db);
 }):null;
 const activePrice=marketId?await safe('services/market-local-price-resolution-service.resolveActiveProductMarketPricingById',()=>{
   const fn=owners.pricing||require('../../services/market-local-price-resolution-service').resolveActiveProductMarketPricingById;
   return fn(db,{marketId,productId:expectedProductId});
 }):null;
 const {rows:skuRows}=item.sku_id?await db.query(
  'SELECT id, product_id, is_active FROM product_skus WHERE id=$1 LIMIT 2',[item.sku_id]):{rows:[]};
 if(skuRows.length>1)throw Error('Ambiguous sold SKU identity');
 const sku=skuRows[0]||null;
 const upstream=await safe('services/golden-upstream-evidence.projectUpstreamEvidence',()=>{
  const fn=owners.upstream||require('../../services/golden-upstream-evidence').projectUpstreamEvidence;
  return fn(db,{productId:expectedProductId,marketCode:code,orderReference,fetchImpl:null});
 });
 const origin=upstream?.gates?.find(x=>x.key==='CHECKOUT_ORIGIN_PROVED')||null;
 const checkout=statusOfGate(origin);
 const exposureStatus=exposure==null?'UNKNOWN':exposure==='ENABLED'?'PROVED':'BLOCKED';
 const pricingStatus=!marketId?'UNKNOWN':errors.some(e=>e.owner.includes('resolveActiveProductMarketPricingById'))?
  'UNKNOWN':activePrice?'PROVED':'BLOCKED';
 const catalogGate=upstream?.gates?.find(x=>x.key==='CATALOG_RELEASE_PROVED')||null;
 const catalogStatus=(!sku || !marketId)?'UNKNOWN':
   !sku.is_active||exposureStatus==='BLOCKED'||pricingStatus==='BLOCKED'||catalogGate?.status==='ANOMALIE'?'BLOCKED':
   exposureStatus==='PROVED'&&pricingStatus==='PROVED'&&catalogGate?.status==='PROVED'?'PROVED':'UNKNOWN';
 const readiness=plane?.readiness||null,delivery=plane?.deliveryProof||null;
 const governancePrice=marketStatus(market,readiness,delivery,false);
 const governanceCheckout=marketStatus(market,readiness,delivery,true);
 const sourceMarket={market_code:market?.code||code};
 const actualMarket={market_code:item.order_market_code||null};
 const ctx={market_code:code,market_id:marketId,order_reference:orderReference,
   order_item_id:String(item.order_item_id),simulation_scope:item.simulation_scope||null};
 const proofs={
  P7_P1_MARKET_PRICING:record('P7_P1_MARKET_PRICING',governancePrice,pricingStatus,sourceMarket,sourceMarket,
    {...ctx,control_plane_readiness:readiness,local_active:!!activePrice}),
  P7_P1_MARKET_EXPOSURE:record('P7_P1_MARKET_EXPOSURE',governancePrice,exposureStatus,sourceMarket,sourceMarket,
    {...ctx,control_plane_readiness:readiness,exposure}),
  P7_P2_CHECKOUT:record('P7_P2_CHECKOUT',governanceCheckout,checkout,sourceMarket,actualMarket,
    {...ctx,checkout_gate:origin?.status||'MISSING',delivery_proven:delivery?.proven??null}),
  P1_P2_SELLABLE_UNIT:record('P1_P2_SELLABLE_UNIT',catalogStatus,checkout,
   {product_id:sku?.product_id||null,sku_id:sku?.id||null,market_code:code},
   {product_id:item.product_id,sku_id:item.sku_id,market_code:item.order_market_code},
   {...ctx,sku_active:sku?.is_active??null,exposure,local_active:!!activePrice,
    catalog_gate:catalogGate?.status||'MISSING'}),
 };
 const purchasingHub=await safe('scripts/research/p2-p4-canonical-collector.collectP2P4Canonical',()=>{
   const fn=owners.p2p4||require('./p2-p4-canonical-collector').collectP2P4Canonical;
   return fn(db,{item,upstream});
 });
 if(purchasingHub?.proofs)Object.assign(proofs,purchasingHub.proofs);
 const physicalHandoff=await safe('scripts/research/p4-p2-canonical-collector.collectP4P2Canonical',()=>{
   const fn=owners.p4p2||require('./p4-p2-canonical-collector').collectP4P2Canonical;
   return fn(db,{item});
 });
 if(physicalHandoff?.proofs)Object.assign(proofs,physicalHandoff.proofs);
 const customerFinance=await safe('scripts/research/p5-p2-canonical-collector.collectP5P2Canonical',()=>{
   const fn=owners.p5p2||require('./p5-p2-canonical-collector').collectP5P2Canonical;
   return fn(db,{item,upstream});
 });
 if(customerFinance?.proofs)Object.assign(proofs,customerFinance.proofs);
 const supplierCost=await safe('scripts/research/p3-p6-canonical-collector.collectP3P6Canonical',()=>{
   const fn=owners.p3p6||require('./p3-p6-canonical-collector').collectP3P6Canonical;
   return fn(db,{item});
 });
 if(supplierCost?.proofs)Object.assign(proofs,supplierCost.proofs);
 const report=evaluateP1P7(proofs);
 return {...report,execution:'CANONICAL_READ_ONLY_OWNER_ADAPTERS',wired_edges:Object.keys(proofs),
   evidence_provenance:['services/market-control-plane.js:getControlPlane',
    'services/catalog-market-exposure-service.js:getExposure',
    'services/market-local-price-resolution-service.js:resolveActiveProductMarketPricingById',
    'services/golden-upstream-evidence.js:projectUpstreamEvidence',
    'orders/order_items/product_skus exact persisted identity'],
   owner_read_errors:errors,
   purchasing_hub:purchasingHub?{facts:purchasingHub.facts||null,
     diagnostics:purchasingHub.diagnostics||null,
     owner_provenance:purchasingHub.owner_provenance||null}:null,
   physical_handoff:physicalHandoff?{facts:physicalHandoff.facts||null,
     diagnostics:physicalHandoff.diagnostics||null,
     owner_provenance:physicalHandoff.owner_provenance||null}:null,
   customer_finance:customerFinance?{facts:customerFinance.facts||null,
     diagnostics:customerFinance.diagnostics||null,
     owner_provenance:customerFinance.owner_provenance||null}:null,
   supplier_cost:supplierCost?{facts:supplierCost.facts||null,
     diagnostics:supplierCost.diagnostics||null,
     owner_provenance:supplierCost.owner_provenance||null}:null,
   context:{...ctx,selected_market:code,persisted_order_market:item.order_market_code||null,
     actual_product_id:item.product_id,actual_sku_id:item.sku_id,
     provenance:'CANONICAL_OWNER_READS_NOT_EXTERNAL_CHECKOUT'},
   stagingCertified:false,liveCheckoutCertified:false,financeCertified:false};
}
module.exports={record,statusOfGate,marketStatus,collectP1P7Canonical};
