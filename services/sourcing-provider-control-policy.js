/**
 * @komerce-arch
 * @role          sourcing-provider-control-policy
 * @domain        sourcing
 * @layer         service
 * @criticality   high
 * @inputs        authenticated_operator,source_ref,capability,desired_state,reason,canonical_runtime_result
 * @outputs       audited_provider_capability_policy,durable_provider_runtime_certification
 * @depends       db.js
 * @used-by       routes/admin-sourcing-workspace.js, services/sourcing-source-autopilot.js, services/suppliers/catalog-import-orchestrator.js
 * @db-read       sourcing_sources,sourcing_captures
 * @db-write      sourcing_sources,sourcing_provider_control_events
 * @db-txn        atomic_policy_and_audit
 * @doctrine      fail_closed_capability_controls,production_requires_provider_specific_runtime_certification
 * @impact-areas  sourcing,catalog,admin-dashboard
 * @version       2026-09
 */
'use strict';
const db=require('../db');

const CAPABILITIES=Object.freeze({
 discovery:'discovery_enabled',
 sync:'sync_enabled',
 import:'import_enabled',
 production:'production_enabled',
});

class ProviderPolicyError extends Error {
 constructor(status,code,message){super(message);this.status=status;this.code=code;}
}

function assertCapability(value){
 if(!Object.hasOwn(CAPABILITIES,value))throw new ProviderPolicyError(400,'provider_capability_invalid','Capacité fournisseur inconnue');
 return CAPABILITIES[value];
}

function hasRuntimeCertification(source){
 return Boolean(source?.production_certified_capture_id&&source?.production_certified_at);
}

function canRunAutomaticImport(source){
 return Boolean(
  source?.discovery_enabled
  &&source?.sync_enabled
  &&source?.import_enabled
  &&source?.production_enabled
  &&hasRuntimeCertification(source)
 );
}

async function recordRuntimeCertification({sourceRef,captureId,pipelineStatus},q=db){
 if(pipelineStatus!=='CANONICAL_RESOLVED'||!sourceRef||!captureId){
  return {source_ref:sourceRef||null,certified:false,reason:'runtime_evidence_incomplete'};
 }
 const {rows:[row]}=await q.query(
  `UPDATE sourcing_sources s
      SET production_certified_capture_id=c.capture_id,
          production_certified_at=NOW(),
          updated_at=NOW()
     FROM sourcing_captures c
    WHERE s.source_id=$1
      AND c.capture_id=$2
      AND c.source_id=s.source_id
      AND c.status='complete'
    RETURNING s.source_id AS source_ref,s.production_certified_at`,
  [sourceRef,captureId]
 );
 return row
  ? {source_ref:row.source_ref,certified:true,certified_at:row.production_certified_at}
  : {source_ref:sourceRef,certified:false,reason:'runtime_capture_not_eligible'};
}

async function setCapability(sourceRef,capability,enabled,actor,reason){
 const column=assertCapability(capability);
 if(typeof enabled!=='boolean')throw new ProviderPolicyError(400,'provider_state_invalid','enabled doit être booléen');
 if(!String(reason||'').trim())throw new ProviderPolicyError(400,'provider_reason_required','Motif opérateur obligatoire');
 const client=await db.getClient();
 try{
  await client.query('BEGIN');
  const {rows:[source]}=await client.query(
   'SELECT source_id,discovery_enabled,sync_enabled,import_enabled,production_enabled,production_certified_capture_id,production_certified_at FROM sourcing_sources WHERE source_id=$1 FOR UPDATE',
   [sourceRef]
  );
  if(!source)throw new ProviderPolicyError(404,'provider_source_not_found','Source introuvable');
  if(capability==='production'&&enabled&&!hasRuntimeCertification(source)){
   throw new ProviderPolicyError(409,'provider_certification_runtime_evidence_required','Production verrouillée : exécuter d’abord un import API CANONICAL_RESOLVED pour ce fournisseur');
  }
  const previous=Boolean(source[column]);
  if(previous!==enabled){
   await client.query('UPDATE sourcing_sources SET '+column+'=$2,updated_at=NOW() WHERE source_id=$1',[sourceRef,enabled]);
   await client.query(
    'INSERT INTO sourcing_provider_control_events(source_id,capability,old_value,new_value,actor_id,reason) VALUES($1,$2,$3,$4,$5,$6)',
    [sourceRef,capability,previous,enabled,actor?.id?String(actor.id):null,String(reason).trim().slice(0,500)]
   );
  }
  await client.query('COMMIT');
  return {source_ref:sourceRef,capability,enabled,changed:previous!==enabled};
 }catch(error){
  await client.query('ROLLBACK').catch(()=>{});
  throw error;
 }finally{
  client.release();
 }
}

module.exports={
 CAPABILITIES,
 ProviderPolicyError,
 hasRuntimeCertification,
 canRunAutomaticImport,
 recordRuntimeCertification,
 setCapability,
};
