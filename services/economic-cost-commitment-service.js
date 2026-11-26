/**
 * @komerce-arch
 * @role          economic-cost-commitment-service
 * @domain        economic-engine
 * @layer         service
 * @criticality   high
 * @inputs        authenticated_actor, explicit_scope, post_or_commitment_ref, period, native_amount, evidence, request_key
 * @outputs       immutable_commitment_or_movement, idempotent_replay
 * @depends       db.js, services/economic-cost-write-authority.js, services/fx-authority.js
 * @used-by       routes/admin-pricing-workspace.js
 * @db-read       markets, economic_cost_centers, economic_cost_posts, economic_cost_commitments, economic_cost_commitment_movements
 * @db-write      economic_cost_commitments, economic_cost_commitment_movements
 * @db-txn        service_owned_read_committed_transaction
 * @doctrine      commitments_are_not_real_costs, exact_scope, frozen_fx, append_only, canonical_fact_consumption_only, no_double_count
 * @impact-areas  economic-engine, finance, governance
 * @version       2026-11
 */
'use strict';
const db=require('../db');
const fx=require('./fx-authority');
const costAuthority=require('./economic-cost-write-authority');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function fail(code,status,message){return Object.assign(new Error(message),{code,status});}
const invalid=field=>fail('economic_commitment_invalid',400,field+' invalide');
function ref(value,field){if(typeof value!=='string'||!UUID.test(value))throw invalid(field);return value.toLowerCase();}
function text(value,min,max,field){if(typeof value!=='string'||value.trim().length<min||value.trim().length>max)throw invalid(field);return value.trim();}
function period(value){if(typeof value!=='string'||!/^[1-9][0-9]{3}-(0[1-9]|1[0-2])-01$/.test(value))throw invalid('Mois');return value;}
function scope(value){if(value!==null&&(typeof value!=='string'||!/^[A-Z]{2}$/.test(value)))throw invalid('Périmètre explicite');return value;}
function amount(value,currency){
  const m=typeof value==='string'&&/^(0|[1-9][0-9]{0,13})(?:\.([0-9]{1,4}))?$/.exec(value);
  if(!Object.prototype.hasOwnProperty.call(fx.MINOR_UNITS,currency)||!m||(m[2]||'').length>fx.MINOR_UNITS[currency]||!/[1-9]/.test(value))throw invalid('Montant natif');
  return m[1]+'.'+(m[2]||'').padEnd(4,'0');
}
function common(raw){
  if(!raw)throw invalid('Requête');
  return {marketCode:scope(raw.marketCode),periodStart:period(raw.periodStart),evidenceRef:text(raw.evidenceRef,3,1000,'Justificatif'),requestKey:text(raw.requestKey,8,200,'Clé de requête')};
}
function parseOpen(raw){const c=common(raw),currency=text(raw.currency,3,3,'Devise');return {...c,postId:ref(raw.postId,'Poste'),currency,amountNative:amount(raw.amountNative,currency)};}
function parseMovement(raw){
  const c=common(raw);
  if(!['RELEASE','CONSUME_STRUCTURE'].includes(raw.kind))throw invalid('Type de mouvement');
  if(raw.kind==='RELEASE'&&raw.structureEventId!=null)throw invalid('Fait de consommation');
  return {...c,commitmentId:ref(raw.commitmentId,'Engagement'),kind:raw.kind,structureEventId:raw.kind==='CONSUME_STRUCTURE'?ref(raw.structureEventId,'Fait canonique'):null,rawAmount:raw.amountNative};
}
async function transaction(input,actor,central,action,work){
  const client=await db.getClient();
  try{
    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    let marketId=null;
    if(input.marketCode!==null){
      const {rows}=await client.query('SELECT id FROM markets WHERE code=$1',[input.marketCode]);
      if(!rows.length)throw fail('market_not_found',404,'Marché introuvable');
      marketId=rows[0].id;
    }
    await costAuthority.check(client,actor,input.marketCode,marketId,central,action,{record:true});
    const result=await work(client,marketId);
    await client.query('COMMIT');return result;
  }catch(e){
    try{await client.query('ROLLBACK');}catch(_){}
    if(e.code==='23514'&&/^economic_commitment_(overconsumption|fact_mismatch_or_correction|fact_overallocation)$/.test(e.message))throw fail(e.message,409,'Engagement ou fait économique incompatible avec le mouvement');
    throw e;
  }finally{client.release();}
}
function conflict(){return fail('economic_commitment_idempotency_conflict',409,'Rejeu avec données différentes');}
async function openCommitment(actor,raw){
  const x=parseOpen(raw),central=await costAuthority.classifyActor(actor,x.marketCode);
  return transaction(x,actor,central,'commitment',async(client,marketId)=>{
    const {rows:posts}=await client.query('SELECT p.id FROM economic_cost_posts p JOIN economic_cost_centers c ON c.id=p.center_id WHERE p.id=$1 AND c.market_id IS NOT DISTINCT FROM $2::uuid FOR UPDATE OF p',[x.postId,marketId]);
    if(!posts.length)throw fail('economic_commitment_post_not_found',404,'Poste introuvable dans ce périmètre');
    const {rows:prior}=await client.query('SELECT *, period_start::text AS period_start, amount_native::text AS amount_native, amount_eur::text AS amount_eur FROM economic_cost_commitments WHERE post_id=$1 AND request_key=$2',[x.postId,x.requestKey]);
    if(prior.length){
      const k=prior[0];
      if(k.period_start!==x.periodStart||k.currency!==x.currency||k.amount_native!==x.amountNative||k.evidence_ref!==x.evidenceRef||String(k.recorded_by)!==String(actor.id))throw conflict();
      return {outcome:'replayed',commitment:k};
    }
    const {rows:clock}=await client.query('SELECT now() AS as_of');
    const asOf=clock[0].as_of;
    const converted=await fx.convert({amount:x.amountNative,from:x.currency,to:'EUR',at:asOf,client});
    const {rows}=await client.query('INSERT INTO economic_cost_commitments (post_id,period_start,currency,amount_native,amount_eur,fx_legs,fx_as_of,evidence_ref,request_key,recorded_by) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10) RETURNING *, period_start::text AS period_start, amount_native::text AS amount_native, amount_eur::text AS amount_eur',[x.postId,x.periodStart,x.currency,x.amountNative,converted.amount_text,JSON.stringify(converted.legs),asOf,x.evidenceRef,x.requestKey,actor.id]);
    return {outcome:'created',commitment:rows[0]};
  });
}
async function moveCommitment(actor,raw){
  const x=parseMovement(raw),central=await costAuthority.classifyActor(actor,x.marketCode);
  return transaction(x,actor,central,x.kind==='CONSUME_STRUCTURE'?'consume':'commitment',async(client,marketId)=>{
    const {rows:ks}=await client.query('SELECT k.id,k.currency FROM economic_cost_commitments k JOIN economic_cost_posts p ON p.id=k.post_id JOIN economic_cost_centers c ON c.id=p.center_id WHERE k.id=$1 AND c.market_id IS NOT DISTINCT FROM $2::uuid AND k.period_start=$3::date FOR UPDATE OF k',[x.commitmentId,marketId,x.periodStart]);
    if(!ks.length)throw fail('economic_commitment_not_found',404,'Engagement introuvable dans ce périmètre et cette période');
    const native=amount(x.rawAmount,ks[0].currency);
    const {rows:prior}=await client.query('SELECT *, amount_native::text AS amount_native FROM economic_cost_commitment_movements WHERE commitment_id=$1 AND request_key=$2',[x.commitmentId,x.requestKey]);
    if(prior.length){
      const m=prior[0];
      if(m.kind!==x.kind||m.amount_native!==native||m.structure_event_id!==x.structureEventId||m.evidence_ref!==x.evidenceRef||String(m.recorded_by)!==String(actor.id))throw conflict();
      return {outcome:'replayed',movement:m};
    }
    // A foreign/nonexistent fact is rejected without revealing its contents;
    // the existing transaction trigger remains the final conservation guard.
    if(x.structureEventId){
      const {rows}=await client.query('SELECT e.id FROM economic_structure_cost_events e JOIN economic_cost_posts p ON p.structure_charge_id=e.charge_id JOIN economic_cost_commitments k ON k.post_id=p.id WHERE k.id=$1 AND e.id=$2 AND e.market_id IS NOT DISTINCT FROM $3::uuid',[x.commitmentId,x.structureEventId,marketId]);
      if(!rows.length)throw fail('economic_commitment_fact_not_found',404,'Fait canonique introuvable pour cet engagement');
    }
    const {rows}=await client.query('INSERT INTO economic_cost_commitment_movements (commitment_id,kind,amount_native,structure_event_id,evidence_ref,request_key,recorded_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *, amount_native::text AS amount_native',[x.commitmentId,x.kind,native,x.structureEventId,x.evidenceRef,x.requestKey,actor.id]);
    return {outcome:'created',movement:rows[0]};
  });
}
module.exports={openCommitment,moveCommitment,parseOpen,parseMovement};
