/** @komerce-arch-lite
 * @role g6-fresh-buyer-dynamic-bootstrap
 * @domain orders
 * @layer test
 * @owner backend-core
 * @purpose Bind a newly created Chromium buyer order to the dynamic 15-stage runner.
 * @impact-areas staging-only
 */
'use strict';
const {marketProfile}=require('./market-profile');
const {executeBoundJourney}=require('./dynamic-runner');
const {graphFor,scenarioProfile,SCENARIO_STAGE_IDS}=require('./stage-registry');
const SHA=/^[a-f0-9]{40}$/;
const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const REF=/^[A-Z0-9][A-Z0-9-]{5,63}$/;
const DIGEST=/^[a-f0-9]{64}$/;
const REQUIRE=['attestRuntimeBeforeBuyer','executeBuyerChromium','verifyBuyerIndependently',
 'persistEvidence','authenticateCheckpoint','attestRuntime','executeStage','verifyStageProof'];
async function bootstrapFreshScenario({scenario='M01',toStage='CLIENT_PICKUP',adapters}={}){
 scenarioProfile(scenario);
 if(!adapters||REQUIRE.some(name=>typeof adapters[name]!=='function'))
  throw Error('G6_FRESH_BOOTSTRAP_ADAPTERS_REQUIRED');
 const runtime=await adapters.attestRuntimeBeforeBuyer();
 if(runtime?.environment!=='staging'||runtime.scenario_id!==scenario||runtime.market!==marketProfile(process.env).code||
  !SHA.test(String(runtime.staging_sha||''))||!String(runtime.db_fingerprint||'').trim()||
  runtime.production_permitted!==false||
  runtime.attestation_origin!=='INDEPENDENT_CHROMIUM_POSTGRESQL')
  throw Error('G6_FRESH_BOOTSTRAP_RUNTIME_INVALID');
 const graph=graphFor(scenario),stage=graph.byId.get('BUYER');
 // M02 : le produit LOCAL_STOCK vendable est choisi ici, en lecture seule ; M01 garde son produit historique.
 let product=null,basket=null,variants=null;
 // M03 : panier mixte résolu en lecture seule (refus sous 3 sources import distinctes), ajouté par l'écran boutique.
 if(scenario==='M03'){
  if(typeof adapters.resolveMixedBasket!=='function')throw Error('G6_FRESH_BOOTSTRAP_BASKET_RESOLVER_REQUIRED');
  const resolved=await adapters.resolveMixedBasket({runtime});
  basket=resolved?.basket;
  if(!basket?.local||!Array.isArray(basket.imports)||basket.imports.length<3||
   new Set(basket.imports.map(p=>p.source_key)).size<3||!REF.test(String(basket.local.product_ref||'').toUpperCase()))
   throw Error('G6_FRESH_BOOTSTRAP_MIXED_BASKET_INVALID');
 }else if(scenario==='N33'){
  // N33 : produit multi-SKU résolu en lecture seule ; PREREQ_MISSING_MULTI_SKU sinon.
  if(typeof adapters.resolveMultiSkuProduct!=='function')throw Error('G6_FRESH_BOOTSTRAP_MULTI_SKU_RESOLVER_REQUIRED');
  variants=await adapters.resolveMultiSkuProduct({runtime});
  if(!variants||!REF.test(String(variants.product_ref||''))||variants.skus?.length!==2)throw Error('G6_FRESH_BOOTSTRAP_MULTI_SKU_INVALID');
 }else if(!['M01','N07','N20','N11','N12','N13','N14','N15','N16','N17','N18','N19'].includes(scenario)){
  if(typeof adapters.resolveLocalStockProduct!=='function')throw Error('G6_FRESH_BOOTSTRAP_PRODUCT_RESOLVER_REQUIRED');
  product=await adapters.resolveLocalStockProduct({runtime});
  if(!product||!REF.test(String(product.product_ref||''))||!Number.isInteger(product.price)||product.price<=0)
   throw Error('G6_FRESH_BOOTSTRAP_LOCAL_STOCK_PRODUCT_INVALID');
 }
 const buyer=await stage.run({
  runCertifiedStage:async id=>{
   if(id!=='BUYER')throw Error('G6_FRESH_BOOTSTRAP_STAGE_MISMATCH');
   return basket?adapters.executeBuyerChromium({runtime,basket}):variants?adapters.executeBuyerChromium({runtime,variants}):product?adapters.executeBuyerChromium({runtime,product}):adapters.executeBuyerChromium({runtime});
  }
 });
 if(buyer?.verdict!=='G6_P2_REAL_OTP_CHROMIUM_ORDER_CREATED_NO_EXTERNAL_EFFECTS'||
  buyer.market!==runtime.market||buyer.order?.market!==runtime.market||
  buyer.order?.scope!=='G6-BUYER'||buyer.order?.status!=='pending'||
  buyer.order?.payment_status!=='pending'||
  !UUID.test(String(buyer.order?.id||''))||!REF.test(String(buyer.order?.reference||''))||
  buyer.db_fingerprint!==runtime.db_fingerprint||
  buyer.runtime_sha!==runtime.staging_sha||
  buyer.payment_real!==false||buyer.supplier_order_real!==false||
  buyer.blocked_requests?.length)
  throw Error('G6_FRESH_BOOTSTRAP_BUYER_PROOF_INVALID');
 const context=Object.freeze({scenario_id:scenario,market:runtime.market,
  order_id:buyer.order.id,order_reference:buyer.order.reference,
  staging_sha:runtime.staging_sha,db_fingerprint:runtime.db_fingerprint,
  production_permitted:false});
 const attested=await stage.validate({
  validateCertifiedStage:async(id,proof)=>{
   if(id!=='BUYER'||proof!==buyer)throw Error('G6_FRESH_BOOTSTRAP_BUYER_CONTEXT_MISMATCH');
   return adapters.verifyBuyerIndependently({buyer:proof,context,runtime});
  }
 },buyer);
 if(attested?.stage_id!=='BUYER'||attested.order_id!==context.order_id||
  attested.order_reference!==context.order_reference||
  attested.db_fingerprint!==context.db_fingerprint||
  attested.staging_sha!==context.staging_sha||
  attested.scenario_id!==scenario||attested.market!==context.market||
  attested.production_permitted!==false||
  attested.attestation_origin!=='INDEPENDENT_CHROMIUM_POSTGRESQL'||
  attested.external_supplier_calls!==0||attested.external_payment_executed!==false||
  !DIGEST.test(String(attested.evidence_sha256||'')))
  throw Error('G6_FRESH_BOOTSTRAP_INDEPENDENT_PROOF_INVALID');
 const persisted=await adapters.persistEvidence({
  stageId:'BUYER',proof:buyer,attestation:attested,context
 });
 if(persisted?.persisted!==true||persisted.stage_id!=='BUYER'||
  persisted.evidence_sha256!==attested.evidence_sha256||
  !/^\d{8,}$/.test(String(persisted.source_run_id||''))||
  typeof persisted.evidence_path!=='string'||
  !/^test-results\/[A-Za-z0-9_./-]+$/.test(persisted.evidence_path)||
  persisted.evidence_path.includes('..'))
  throw Error('G6_FRESH_BOOTSTRAP_EVIDENCE_NOT_DURABLE');
 if(toStage==='BUYER')return Object.freeze({
  contract:'G6-DYNAMIC-CHAIN-v1',order_id:context.order_id,
  order_reference:context.order_reference,stages:Object.freeze([{stage_id:'BUYER',
   evidence_sha256:attested.evidence_sha256}]),
  verdict:'NOT_PROVEN',full_chain_certified:false,production_permitted:false
 });
 const checkpoint=Object.freeze({...context,stage_id:'BUYER',
  source_run_id:String(persisted.source_run_id),
  evidence_path:persisted.evidence_path,evidence_sha256:attested.evidence_sha256,verdict:'PASS'});
 return executeBoundJourney({fromStage:'RELAY_CASH',toStage,context,
  checkpoints:[checkpoint],adapters});
}
const bootstrapFreshM01=(args={})=>bootstrapFreshScenario({...args,scenario:'M01'});
module.exports={bootstrapFreshM01,bootstrapFreshScenario};
