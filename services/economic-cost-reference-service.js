/**
 * @komerce-arch
 * @role          economic-cost-reference-service
 * @domain        economic-engine
 * @layer         service
 * @criticality   high
 * @inputs        authenticated_actor, explicit_scope, family_id, post_metadata, reason
 * @outputs       cost_post_reference, idempotent_replay, audit_record
 * @depends       db.js, services/economic-cost-write-authority.js, services/market-structure-charge-reference.js, services/market-delegation-service.js
 * @used-by       routes/admin-pricing-workspace.js, services/market-provisioning-service.js
 * @db-read       markets, economic_cost_centers, economic_cost_families, economic_cost_resources, economic_cost_posts
 * @db-write      economic_cost_centers, economic_cost_families, economic_cost_posts
 * @db-write-via:market-structure-charge-reference charges
 * @db-write-via:market-delegation-service market_delegation_audit
 * @db-txn        service_owned_transaction
 * @doctrine      exact_scope, reference_is_not_realized_cost, no_duplicate_authority, audit_creation
 * @impact-areas  economic-engine, finance
 * @version       2026-11
 */
'use strict';
const db=require('../db');
const costAuthority=require('./economic-cost-write-authority');
const {insertStructureReference}=require('./market-structure-charge-reference');
const {audit}=require('./market-delegation-service');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function fail(code,status,message){return Object.assign(new Error(message),{code,status});}
const invalid=field=>fail('economic_reference_invalid',400,field+' invalide');
function str(x,min,max,field){if(typeof x!=='string'||x.trim().length<min||x.trim().length>max)throw invalid(field);return x.trim();}
function ref(x,field){if(typeof x!=='string'||!UUID.test(x))throw invalid(field);return x.toLowerCase();}
function parsePost(raw){
  if(!raw||(raw.marketCode!==null&&(typeof raw.marketCode!=='string'||!/^[A-Z]{2}$/.test(raw.marketCode))))throw invalid('Périmètre');
  const code=str(raw.code,2,64,'Code');
  if(!/^[A-Z][A-Z0-9_]{1,63}$/.test(code))throw invalid('Code');
  if(!['FIXED','VARIABLE','MIXED'].includes(raw.economicNature))throw invalid('Nature');
  if(!['DIRECT','MUTUALIZED'].includes(raw.allocationPerimeter))throw invalid('Attribution');
  if(!['CANONICAL_SOURCE','STRUCTURE'].includes(raw.source))throw invalid('Source');
  if(raw.source==='STRUCTURE'&&(raw.economicNature!=='FIXED'||(raw.marketCode!==null&&raw.allocationPerimeter!=='DIRECT')||(raw.marketCode===null&&raw.allocationPerimeter!=='MUTUALIZED')))throw invalid('Périmètre de structure');
  return {marketCode:raw.marketCode,familyId:ref(raw.familyId,'Famille'),resourceId:raw.resourceId==null?null:ref(raw.resourceId,'Ressource'),code,label:str(raw.label,3,120,'Libellé'),economicNature:raw.economicNature,allocationPerimeter:raw.allocationPerimeter,allocationBasis:str(raw.allocationBasis,1,200,'Clé'),source:raw.source,reason:str(raw.reason,3,500,'Motif')};
}
async function createPost(actor,raw){
  const x=parsePost(raw),central=await costAuthority.classifyActor(actor,x.marketCode),client=await db.getClient();
  try{
    await client.query('BEGIN');
    let marketId=null;
    if(x.marketCode!==null){
      const {rows}=await client.query('SELECT id FROM markets WHERE code=$1 AND is_active=TRUE',[x.marketCode]);
      if(!rows.length)throw fail('market_not_found',404,'Marché introuvable');
      marketId=rows[0].id;
    }
    await costAuthority.check(client,actor,x.marketCode,marketId,central,'reference',{record:true});
    const {rows:families}=await client.query('SELECT f.id,f.center_id FROM economic_cost_families f JOIN economic_cost_centers c ON c.id=f.center_id WHERE f.id=$1 AND c.market_id IS NOT DISTINCT FROM $2::uuid FOR UPDATE OF f',[x.familyId,marketId]);
    if(!families.length)throw fail('economic_reference_family_not_found',404,'Famille introuvable dans ce périmètre');
    const centerId=families[0].center_id;
    if(x.resourceId){
      const {rows}=await client.query('SELECT id FROM economic_cost_resources WHERE id=$1 AND center_id=$2 FOR SHARE',[x.resourceId,centerId]);
      if(!rows.length)throw fail('economic_reference_resource_not_found',404,'Ressource hors centre');
    }
    const {rows:existing}=await client.query('SELECT * FROM economic_cost_posts WHERE family_id=$1 AND code=$2',[x.familyId,x.code]);
    if(existing.length){
      const p=existing[0];
      if(p.label!==x.label||p.resource_id!==x.resourceId||p.economic_nature!==x.economicNature||p.allocation_perimeter!==x.allocationPerimeter||p.allocation_basis!==x.allocationBasis||Boolean(p.structure_charge_id)!==(x.source==='STRUCTURE'))
        throw fail('economic_reference_post_conflict',409,'Code de poste déjà utilisé avec des données différentes');
      await client.query('COMMIT');return {outcome:'replayed',post:p};
    }
    const charge=x.source==='STRUCTURE'?await insertStructureReference(client,marketId,{name:x.label,description:x.reason,family:'operationnelle',recurrence_period:'monthly'}):null;
    const {rows}=await client.query('INSERT INTO economic_cost_posts(center_id,family_id,resource_id,code,label,economic_nature,allocation_perimeter,allocation_basis,structure_charge_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',[centerId,x.familyId,x.resourceId,x.code,x.label,x.economicNature,x.allocationPerimeter,x.allocationBasis,charge?.id||null]);
    await audit(client,{actorUserId:actor.id,marketId,action:'ECONOMIC_COST_POST_CREATED',after:{post_id:rows[0].id,center_id:centerId,family_id:x.familyId,reason:x.reason,source:x.source}});
    await client.query('COMMIT');return {outcome:'created',post:rows[0]};
  }catch(e){try{await client.query('ROLLBACK');}catch(_){}if(e.code==='23505')throw fail('economic_reference_post_conflict',409,'Référence de poste ou charge déjà existante');throw e;}finally{client.release();}
}
// Administrative skeleton only. Never seed budgets, expenses, volumes or
// fabricated resource quantities. Existing definitions are not overwritten.
const MARKET_TEMPLATE=Object.freeze([
  {code:'RELAIS_LOCAL',label:'Relais local',families:[['PERSONNEL','Personnel'],['LOCAUX','Locaux'],['EQUIPEMENTS','Équipements'],['CONSOMMABLES','Consommables']]},
  {code:'TRANSPORT_DOUANE',label:'Transport et douane',families:[['TRANSPORT','Transport'],['DOUANE','Douane'],['LIVRAISON','Livraison locale']]},
  {code:'SERVICES_MARCHE',label:'Services du marché',families:[['SERVICES','Services'],['ADMINISTRATION','Administration']]}
]);
const GROUP_TEMPLATE=Object.freeze([
  {code:'HUB_CENTRAL',label:'Hub central',families:[['PERSONNEL','Personnel'],['LOCAUX','Locaux'],['EQUIPEMENTS','Équipements'],['CONSOMMABLES','Consommables']]},
  {code:'SERVICES_CENTRAUX',label:'Services centraux',families:[['PERSONNEL','Personnel'],['PLATEFORME','Plateforme'],['SERVICES','Services']]}
]);
async function provisionCostReferences(client,{marketId,actorId}){
  if(!client?.query||!actorId||(marketId!==null&&!UUID.test(String(marketId))))throw invalid('Périmètre de provisioning');
  const template=marketId===null?GROUP_TEMPLATE:MARKET_TEMPLATE;
  const created={centers:0,families:0};
  for(const definition of template){
    const insert=await client.query('INSERT INTO economic_cost_centers(market_id,code,label) VALUES($1,$2,$3) ON CONFLICT(market_id,code) DO NOTHING RETURNING id',[marketId,definition.code,definition.label]);
    created.centers+=insert.rowCount;
    const {rows}=await client.query('SELECT id FROM economic_cost_centers WHERE market_id IS NOT DISTINCT FROM $1::uuid AND code=$2 FOR UPDATE',[marketId,definition.code]);
    const centerId=rows[0].id;
    for(const [code,label] of definition.families){
      const result=await client.query('INSERT INTO economic_cost_families(center_id,code,label) VALUES($1,$2,$3) ON CONFLICT(center_id,code) DO NOTHING',[centerId,code,label]);
      created.families+=result.rowCount;
    }
  }
  if(created.centers||created.families)await audit(client,{actorUserId:actorId,marketId,action:'ECONOMIC_COST_REFERENCE_PROVISIONED',after:created});
  return created;
}
async function initializeCostReferences(actor,marketCode){
  if(marketCode!==null&&(typeof marketCode!=='string'||!/^[A-Z]{2}$/.test(marketCode)))throw invalid('Périmètre');
  const central=await costAuthority.classifyActor(actor,marketCode),client=await db.getClient();
  try{
    await client.query('BEGIN');
    let marketId=null;
    if(marketCode!==null){
      const {rows}=await client.query('SELECT id FROM markets WHERE code=$1',[marketCode]);
      if(!rows.length)throw fail('market_not_found',404,'Marché introuvable');
      marketId=rows[0].id;
    }
    await costAuthority.check(client,actor,marketCode,marketId,central,'reference',{record:true});
    const result=await provisionCostReferences(client,{marketId,actorId:actor.id});
    await client.query('COMMIT');return result;
  }catch(e){try{await client.query('ROLLBACK');}catch(_){}throw e;}finally{client.release();}
}
module.exports={createPost,parsePost,provisionCostReferences,initializeCostReferences};
