/**
 * @komerce-arch
 * @role          economic-cost-write-authority
 * @domain        economic-engine
 * @layer         service
 * @criticality   high
 * @inputs        authenticated_actor, explicit_scope, cost_action
 * @outputs       exact_market_capability, audited_authorization
 * @depends       middleware/require-pricing-global-authority.js, services/market-delegation-service.js
 * @used-by       services/economic-cost-budget-service.js, services/economic-cost-commitment-service.js, services/economic-cost-post-actual-service.js, services/economic-cost-reference-service.js, services/economic-cost-center-read-model.js
 * @db-read       pricing_global_access_grants, market_operating_assignments, assignment_memberships, membership_capabilities, assignment_capability_ceiling
 * @db-write      none
 * @db-write-via:market-delegation-service market_delegation_audit
 * @db-txn        caller_owned
 * @doctrine      exact_scope, no_role_bypass, no_payment_authority, group_central_only
 * @impact-areas  economic-engine, market-authorization
 * @version       2026-11
 */
'use strict';
const {hasPricingGlobalAuthority}=require('../middleware/require-pricing-global-authority');
const {resolveAuthorization,audit}=require('./market-delegation-service');
const ACTION_CAPABILITIES=Object.freeze({
  budget:Object.freeze(['pricing.cost_component.update']),
  commitment:Object.freeze(['pricing.cost_component.update']),
  consume:Object.freeze(['pricing.cost_component.update','structure.event.record']),
  actual:Object.freeze(['structure.event.record']),
  reference:Object.freeze(['pricing.cost_component.update','structure.event.record'])
});
function fail(code,status,message){return Object.assign(new Error(message),{code,status});}
async function classifyActor(actor,marketCode){
  if(!actor?.id)throw fail('AUTH_REQUIRED',401,'Authentification requise');
  if(actor.role==='admin'&&await hasPricingGlobalAuthority(actor.id))return true;
  if(marketCode==null)throw fail('pricing_global_access_denied',403,'Autorité globale requise');
  return false;
}
async function check(client,actor,marketCode,marketId,central,action,{record=false}={}){
  const capabilities=ACTION_CAPABILITIES[action];
  if(!capabilities)throw new TypeError('Unknown economic cost action');
  if(central)return true;
  if(!marketCode||!marketId)throw fail('pricing_global_access_denied',403,'Autorité globale requise');
  let authz;
  for(const capability of ['pricing.read',...capabilities]){
    authz=await resolveAuthorization(client,{userId:actor.id,marketCode,requiredCapability:capability});
    if(String(authz.market_id)!==String(marketId))throw fail('MARKET_SCOPE_DENIED',403,'Marché hors périmètre');
  }
  if(record)await audit(client,{actorUserId:actor.id,marketId,assignmentId:authz.assignment_id,membershipId:authz.membership_id,capability:capabilities[0],action:'ECONOMIC_COST_WRITE_AUTHORIZED',after:{operation:action,capabilities}});
  return true;
}
async function project(client,actor,marketCode,marketId,central){
  const out={};
  for(const action of Object.keys(ACTION_CAPABILITIES)){
    try{out[action]=await check(client,actor,marketCode,marketId,central,action);}
    catch(e){if(e.status===403||e.status===409)out[action]=false;else throw e;}
  }
  return out;
}
module.exports={classifyActor,check,project,ACTION_CAPABILITIES};
