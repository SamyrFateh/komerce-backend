/**
 * @komerce-arch
 * @role          economic-cost-post-actual-service
 * @domain        economic-engine
 * @layer         service
 * @criticality   high
 * @inputs        authenticated_central_actor, explicit_scope, post, period, native_amount, evidence
 * @outputs       canonical_structure_fact, explicit_replay
 * @depends       db.js, middleware/require-pricing-global-authority.js, services/pricing-period-structure.js, services/fx-authority.js
 * @used-by       routes/admin-pricing-workspace.js
 * @db-read       markets, economic_cost_centers, economic_cost_posts, charges, economic_structure_cost_events
 * @db-write      none
 * @db-write-via:pricing-period-structure economic_structure_cost_events
 * @db-txn        service_owned_transaction
 * @doctrine      canonical_structure_journal_only, no_operational_cost_reentry, evidence_required, exact_scope, governed_fx
 * @impact-areas  economic-engine, finance
 * @version       2026-11
 */
'use strict';
const db=require('../db');
const fx=require('./fx-authority');
const {hasPricingGlobalAuthority}=require('../middleware/require-pricing-global-authority');
const {recordStructureCostEvent}=require('./pricing-period-structure');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function fail(code,status,message){return Object.assign(new Error(message),{code,status});}
function invalid(){return fail('economic_actual_invalid',400,'Période, montant, devise ou justificatif invalide');}
function parse(raw){
  if(!raw||!UUID.test(String(raw.postId||''))||(raw.marketCode!==null&&!/^[A-Z]{2}$/.test(String(raw.marketCode)))||
    typeof raw.periodStart!=='string'||!/^[1-9][0-9]{3}-(0[1-9]|1[0-2])-01$/.test(raw.periodStart)||
    typeof raw.evidenceRef!=='string'||raw.evidenceRef.trim().length<3||raw.evidenceRef.trim().length>1000)throw invalid();
  const currency=raw.currency,m=typeof raw.amountNative==='string'&&/^(0|[1-9][0-9]{0,13})(?:\.([0-9]{1,4}))?$/.exec(raw.amountNative);
  if(!Object.prototype.hasOwnProperty.call(fx.MINOR_UNITS,currency)||!m||(m[2]||'').length>fx.MINOR_UNITS[currency]||!/[1-9]/.test(raw.amountNative))throw invalid();
  return {postId:raw.postId,marketCode:raw.marketCode,periodStart:raw.periodStart,currency,amountNative:m[1]+'.'+(m[2]||'').padEnd(4,'0'),evidenceRef:raw.evidenceRef.trim()};
}
async function recordPostActual(actor,raw){
  if(!actor?.id)throw fail('AUTH_REQUIRED',401,'Authentification requise');
  if(actor.role!=='admin'||!await hasPricingGlobalAuthority(actor.id))throw fail('pricing_global_access_denied',403,'Autorité globale requise');
  const x=parse(raw),client=await db.getClient();
  try{
    await client.query('BEGIN');
    let marketId=null;
    if(x.marketCode!==null){
      const {rows}=await client.query('SELECT id FROM markets WHERE code=$1 AND is_active=TRUE',[x.marketCode]);
      if(!rows.length)throw fail('market_not_found',404,'Marché introuvable');
      marketId=rows[0].id;
    }
    const {rows:posts}=await client.query('SELECT p.structure_charge_id FROM economic_cost_posts p JOIN economic_cost_centers c ON c.id=p.center_id WHERE p.id=$1 AND c.market_id IS NOT DISTINCT FROM $2::uuid FOR UPDATE OF p',[x.postId,marketId]);
    if(!posts.length)throw fail('economic_actual_post_not_found',404,'Poste introuvable dans ce périmètre');
    const chargeId=posts[0].structure_charge_id;
    if(!chargeId)throw fail('economic_actual_source_required',409,'Ce poste doit être alimenté par sa source propriétaire');
    // Serialize V7 postings on the canonical charge and reject ambiguous evidence.
    await client.query('SELECT id FROM charges WHERE id=$1 FOR UPDATE',[chargeId]);
    const from=new Date(x.periodStart+'T00:00:00.000Z'),to=new Date(from);
    to.setUTCMonth(to.getUTCMonth()+1);
    const {rows:prior}=await client.query(
      'SELECT id,currency,amount_original::text AS amount_original,recorded_by,event_kind FROM economic_structure_cost_events WHERE charge_id=$1 AND market_id IS NOT DISTINCT FROM $2::uuid AND economic_from=$3 AND economic_to=$4 AND evidence_ref=$5',
      [chargeId,marketId,from,to,x.evidenceRef]);
    if(prior.length){
      const e=prior[0];
      if(prior.length!==1||e.event_kind!=='ACCRUAL'||e.currency!==x.currency||e.amount_original!==x.amountNative||String(e.recorded_by)!==String(actor.id))
        throw fail('economic_actual_evidence_conflict',409,'Justificatif déjà utilisé avec des données différentes');
      await client.query('COMMIT');return {outcome:'replayed',fact:e};
    }
    const {rows:clock}=await client.query('SELECT now() AS as_of');
    const at=clock[0].as_of;
    const rate=await fx.convert({amount:'1',from:x.currency,to:'KMF',at,client,round:false});
    // The existing journal stores the applied rate to six decimals and KMF
    // to two decimals. Compute the amount against that exact stored rate.
    const {rows:money}=await client.query('SELECT round($1::numeric,6)::text AS rate,round($2::numeric*round($1::numeric,6),2)::text AS kmf',[rate.amount_text,x.amountNative]);
    if(Number(money[0].kmf)<=0||Number(money[0].rate)<=0)throw invalid();
    const fact=await recordStructureCostEvent({
      charge_id:chargeId,scope_kind:marketId?'MARKET_DIRECT':'GROUP',market_id:marketId,event_kind:'ACCRUAL',
      economic_from:from.toISOString(),economic_to:to.toISOString(),amount_original:x.amountNative,currency:x.currency,
      fx_rate_to_kmf:money[0].rate,amount_kmf:money[0].kmf,fx_source:'FX authority · '+at.toISOString(),source_kind:'INVOICE',
      evidence_ref:x.evidenceRef,notes:JSON.stringify({fxLegs:rate.legs,rateAsOf:at.toISOString()})
    },actor.id,{executor:client});
    await client.query('COMMIT');return {outcome:'created',fact};
  }catch(e){try{await client.query('ROLLBACK');}catch(_){}throw e;}finally{client.release();}
}
module.exports={recordPostActual,parse};
