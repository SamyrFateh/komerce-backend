/**
 * @komerce-arch
 * @role          economic-cost-center-read-model
 * @domain        economic-engine
 * @layer         service
 * @criticality   high
 * @inputs        authenticated_actor, explicit_market_scope, calendar_month
 * @outputs       scoped_centers_families_resources_posts, latest_budget_revisions, outstanding_commitments, explicit_actual_coverage_status
 * @depends       db, middleware/require-pricing-global-authority.js, services/market-delegation-service.js, services/fx-authority.js
 * @used-by       routes/admin-pricing-workspace.js
 * @db-read       markets, economic_cost_centers, economic_cost_families, economic_cost_resources, economic_cost_posts, economic_cost_budget_revisions, economic_cost_commitments, economic_cost_commitment_movements, economic_structure_cost_events
 * @db-write      none
 * @db-txn        service_owned_read_only_repeatable_read
 * @doctrine      exact_market_scope, budget_is_not_realized_cost, no_fake_zero, group_raw_not_delegated
 * @impact-areas  economic-engine, finance, market-authorization
 * @version       2026-11
 */
'use strict';
const db = require('../db');
const {parseDecimal,roundHalfEven}=require('./fx-authority');
const {hasPricingGlobalAuthority} = require('../middleware/require-pricing-global-authority');
const {resolveAuthorization} = require('./market-delegation-service');
function error(code,status,message){return Object.assign(new Error(message),{code,status});}
function validate(raw){
  if(!raw || !Object.prototype.hasOwnProperty.call(raw,'marketCode') ||
      (raw.marketCode!==null && !/^[A-Z]{2}$/.test(String(raw.marketCode))))
    throw error('economic_reference_scope_invalid',400,'Périmètre explicite requis');
  if(typeof raw.periodStart!=='string'||!/^[1-9][0-9]{3}-(0[1-9]|1[0-2])-01$/.test(raw.periodStart))
    throw error('economic_reference_period_invalid',400,'Mois invalide');
  return {marketCode:raw.marketCode,periodStart:raw.periodStart};
}
async function resolveScope(client,actor,marketCode,central){
  if(central){
    if(marketCode===null)return null;
    const {rows}=await client.query('SELECT id FROM markets WHERE code=$1',[marketCode]);
    if(!rows.length)throw error('market_not_found',404,'Marché introuvable');
    return rows[0].id;
  }
  if(marketCode===null)throw error('economic_reference_group_forbidden',403,'Périmètre groupe interdit');
  const authz=await resolveAuthorization(client,{userId:actor.id,marketCode,requiredCapability:'pricing.read'});
  if(!authz.market_id)throw error('economic_reference_scope_missing',403,'Périmètre non résolu');
  return authz.market_id;
}
// Server-side aggregation of frozen EUR budget snapshots, never realized cost.
// An incomplete set exposes its coverage and a subtotal, not a complete budget.
function budgetSummary(posts){
  let eur=0n,covered=0;
  for(const p of posts){
    const amount=p.budget?.eur;
    if(typeof amount!=='string'||!/^\d+\.\d{2}$/.test(amount))continue;
    eur+=BigInt(amount.replace('.',''));covered++;
  }
  const digits=eur.toString().padStart(3,'0');
  const recordedEur=covered?digits.slice(0,-2)+'.'+digits.slice(-2):null;
  return {recordedEur,totalEur:posts.length>0&&covered===posts.length?recordedEur:null,coveredPosts:covered,totalPosts:posts.length};
}
// Value the remaining administrative commitment at its frozen opening EUR
// snapshot. This is neither an actual expense nor a fresh FX conversion.
// Corrections of linked facts make the balance non-decisional until reconciled.
function commitmentRemainingEur(k){
  if(k.requires_reconciliation)return null;
  const valid=(v)=>typeof v==='string'&&/^\d+(?:\.\d+)?$/.test(v);
  if(![k.initial_native,k.initial_eur,k.remaining_native].every(valid))return null;
  const a=parseDecimal(k.initial_eur), n=parseDecimal(k.remaining_native), d=parseDecimal(k.initial_native);
  if(d.n<=0n||n.n*d.d>d.n*n.d)return null;
  const cents=roundHalfEven(a.n*n.n*d.d,a.d*n.d*d.n,2);
  const s=cents.toString().padStart(3,'0');
  return s.slice(0,-2)+'.'+s.slice(-2);
}
function commitmentSummary(posts){
  const items=posts.flatMap(p=>p.commitments||[]);
  let cents=0n,covered=0;
  for(const k of items){
    if(k.remaining_eur===null||typeof k.remaining_eur!=='string'||!/^\d+\.\d{2}$/.test(k.remaining_eur))continue;
    cents+=BigInt(k.remaining_eur.replace('.',''));covered++;
  }
  const s=cents.toString().padStart(3,'0');
  const recordedEur=posts.length&&(covered||!items.length)?s.slice(0,-2)+'.'+s.slice(-2):null;
  return {recordedEur,totalEur:covered===items.length?recordedEur:null,coveredCommitments:covered,totalCommitments:items.length,valuation:'FROZEN_OPENING_EUR'};
}
async function readCostCenters(actor,raw){
  if(!actor?.id)throw error('AUTH_REQUIRED',401,'Authentification requise');
  const input=validate(raw);
  const central=actor.role==='admin' && await hasPricingGlobalAuthority(actor.id);
  const client=await db.getClient();
  try{
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const marketId=await resolveScope(client,actor,input.marketCode,central);
    const {rows:centers}=await client.query(
      'SELECT id,code,label,responsible_user_id,is_active FROM economic_cost_centers WHERE market_id IS NOT DISTINCT FROM $1::uuid ORDER BY code,id',[marketId]);
    const {rows:families}=await client.query(
      'SELECT f.id,f.center_id,f.code,f.label FROM economic_cost_families f JOIN economic_cost_centers c ON c.id=f.center_id WHERE c.market_id IS NOT DISTINCT FROM $1::uuid ORDER BY f.code,f.id',[marketId]);
    const {rows:resources}=await client.query(
      'SELECT r.id,r.center_id,r.code,r.label,r.resource_kind FROM economic_cost_resources r JOIN economic_cost_centers c ON c.id=r.center_id WHERE c.market_id IS NOT DISTINCT FROM $1::uuid ORDER BY r.code,r.id',[marketId]);
    const {rows:posts}=await client.query(
      `SELECT p.id,p.center_id,p.family_id,p.resource_id,p.code,p.label,p.economic_nature,p.allocation_perimeter,p.allocation_basis,
        b.revision AS budget_revision,b.currency AS budget_currency,b.amount_native::text AS budget_native,b.amount_eur::text AS budget_eur
       FROM economic_cost_posts p JOIN economic_cost_centers c ON c.id=p.center_id
       LEFT JOIN LATERAL (
          SELECT revision,currency,amount_native,amount_eur FROM economic_cost_budget_revisions
          WHERE post_id=p.id AND period_start=$2::date ORDER BY revision DESC LIMIT 1
       ) b ON true
       WHERE c.market_id IS NOT DISTINCT FROM $1::uuid ORDER BY p.code,p.id`,[marketId,input.periodStart]);
    const {rows:commitments}=await client.query(
      `SELECT k.id,k.post_id,k.currency,k.amount_native::text AS initial_native,k.amount_eur::text AS initial_eur,
         (k.amount_native-COALESCE(m.used,0))::text AS remaining_native,
         COALESCE(m.has_correction,false) AS requires_reconciliation
       FROM economic_cost_commitments k
       JOIN economic_cost_posts p ON p.id=k.post_id
       JOIN economic_cost_centers c ON c.id=p.center_id
       LEFT JOIN LATERAL (
         SELECT SUM(x.amount_native) AS used,BOOL_OR(EXISTS (
           SELECT 1 FROM economic_structure_cost_events e WHERE e.adjusts_event_id=x.structure_event_id
         )) AS has_correction FROM economic_cost_commitment_movements x WHERE x.commitment_id=k.id
       ) m ON true
       WHERE c.market_id IS NOT DISTINCT FROM $1::uuid AND k.period_start=$2::date ORDER BY k.id`,[marketId,input.periodStart]);
    const byPost=new Map();
    for(const k of commitments){if(!byPost.has(k.post_id))byPost.set(k.post_id,[]);byPost.get(k.post_id).push({...k,remaining_eur:commitmentRemainingEur(k)});}
    const model=posts.map(p=>({...p,budget:p.budget_revision===null?null:{revision:p.budget_revision,currency:p.budget_currency,native:p.budget_native,eur:p.budget_eur},
      commitments:byPost.get(p.id)||[],actual:null,available:null,coverage:'NOT_RECONCILED'}));
    await client.query('COMMIT');
    return {scope:input.marketCode===null?'GROUP':'MARKET',marketCode:input.marketCode,periodStart:input.periodStart,central,readOnly:true,
      centers:centers.map(c=>({...c,budgetSummary:budgetSummary(model.filter(p=>p.center_id===c.id)),commitmentSummary:commitmentSummary(model.filter(p=>p.center_id===c.id))})),families,resources,posts:model,budgetSummary:budgetSummary(model),commitmentSummary:commitmentSummary(model),actualCoverage:'NOT_RECONCILED',available:null};
  }catch(e){try{await client.query('ROLLBACK');}catch(_){}throw e;}finally{client.release();}
}
module.exports={readCostCenters,budgetSummary,commitmentRemainingEur,commitmentSummary};
