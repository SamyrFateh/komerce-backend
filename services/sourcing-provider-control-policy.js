/**
 * @komerce-arch
 * @role          sourcing-provider-control-policy
 * @domain        sourcing
 * @layer         service
 * @criticality   high
 * @inputs        authenticated_operator,source_ref,capability,desired_state,reason
 * @outputs       audited_provider_capability_policy
 * @depends       db.js
 * @used-by       routes/admin-sourcing-workspace.js, services/sourcing-source-autopilot.js
 * @db-read       sourcing_sources
 * @db-write      sourcing_sources, sourcing_provider_control_events
 * @db-txn        atomic_policy_and_audit
 * @doctrine      fail_closed_capability_controls,production_requires_provider_specific_runtime_certification
 * @impact-areas  sourcing,catalog,admin-dashboard
 * @version       2026-09
 */
'use strict';
const db=require('../db');
const CAPABILITIES=Object.freeze({discovery:'discovery_enabled',sync:'sync_enabled',import:'import_enabled',production:'production_enabled'});
class ProviderPolicyError extends Error {
 constructor(status,code,message){super(message);this.status=status;this.code=code;}
}
function assertCapability(value){if(!Object.hasOwn(CAPABILITIES,value))throw new ProviderPolicyError(400,'provider_capability_invalid','Capacité fournisseur inconnue');return CAPABILITIES[value];}
function canRunAutomaticImport(source){return Boolean(source?.discovery_enabled&&source?.sync_enabled&&source?.import_enabled&&source?.production_enabled);}
async function setCapability(sourceRef,capability,enabled,actor,reason){
 const column=assertCapability(capability);
 if(typeof enabled!=='boolean')throw new ProviderPolicyError(400,'provider_state_invalid','enabled doit être booléen');
 if(!String(reason||'').trim())throw new ProviderPolicyError(400,'provider_reason_required','Motif opérateur obligatoire');
 // A structural Markdown/manifest checker is not a runtime provider certification.
 // Production remains locked until a separate durable per-provider evidence authority exists.
 if(capability==='production'&&enabled)throw new ProviderPolicyError(409,'provider_certification_runtime_evidence_required','Production verrouillée : preuve de certification runtime par fournisseur non disponible');
 const client=await db.getClient();
 try{
  await client.query('BEGIN');
  const {rows:[source]}=await client.query('SELECT source_id, discovery_enabled,sync_enabled,import_enabled,production_enabled FROM sourcing_sources WHERE source_id=$1 FOR UPDATE',[sourceRef]);
  if(!source)throw new ProviderPolicyError(404,'provider_source_not_found','Source introuvable');
  const previous=Boolean(source[column]);
  if(previous!==enabled){
   await client.query('UPDATE sourcing_sources SET '+column+'=$2,updated_at=NOW() WHERE source_id=$1',[sourceRef,enabled]);
   await client.query('INSERT INTO sourcing_provider_control_events(source_id,capability,old_value,new_value,actor_id,reason) VALUES($1,$2,$3,$4,$5,$6)',[sourceRef,capability,previous,enabled,actor?.id?String(actor.id):null,String(reason).trim().slice(0,500)]);
  }
  await client.query('COMMIT');
  return {source_ref:sourceRef,capability,enabled,changed:previous!==enabled};
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
module.exports={CAPABILITIES,ProviderPolicyError,canRunAutomaticImport,setCapability};
