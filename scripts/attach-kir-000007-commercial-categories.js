/** @komerce-arch
 * @role kir-commercial-candidate-attachment
 * @domain sourcing
 * @layer script
 * @criticality medium
 * @inputs KIR run evidence and confirmed supplier taxonomy mappings
 * @outputs preview or atomic candidate boutique classification and audited events
 * @depends db.js, scripts/audit-kir-supplier-category-provenance.js, services/supplier-commercial-category-mapping.js
 * @db-read import_runtime_runs, import_runtime_item_events, sourcing_candidates, supplier_commercial_category_mappings, boutique_categories, boutique_subcategories
 * @db-write sourcing_candidates, sourcing_candidate_events
 * @db-txn script_owned
 */
'use strict';
const db=require('../db');
const {audit:sourceAudit}=require('./audit-kir-supplier-category-provenance');
const {findConfirmed}=require('../services/supplier-commercial-category-mapping');
async function run({apply=false,actor=null,query=db,source=sourceAudit,find=findConfirmed}={}){
 const evidence=await source('KIR-000007');
 if(evidence.provider!=='AliExpress'||evidence.inspected!==20||
   evidence.items.length!==20||evidence.items.some(x=>!x.candidate_ref))
   throw new Error('KIR_SOURCE_EVIDENCE_CHANGED');
 const client=apply?await query.getClient():query;
 try{
  if(apply)await client.query('BEGIN');
  const changes=[];
  for(const item of evidence.items){
   const path=item.category_path?.length?item.category_path.join(' > '):item.supplier_category;
   if(!path)throw new Error('KIR_SOURCE_CATEGORY_MISSING:'+item.candidate_ref);
   const mapped=await find(evidence.provider,path,client);
   if(!mapped)throw new Error('CONFIRMED_MAPPING_MISSING:'+item.candidate_ref);
   const {rows:[candidate]}=await client.query(
    `SELECT id,candidate_ref,state,product_id,komerce_category,commercial_taxonomy_review
       FROM sourcing_candidates WHERE candidate_ref=$1${apply?' FOR UPDATE':''}`,[item.candidate_ref]);
   if(!candidate||candidate.product_id||['rejected','archived','imported_to_catalog'].includes(candidate.state))
    throw new Error('CANDIDATE_NOT_EDITABLE:'+item.candidate_ref);
   const current=candidate.commercial_taxonomy_review;
   if(current&&current.status==='CONFIRMED'&&(current.category!==mapped.category||
      current.subcategory!==mapped.subcategory))
     throw new Error('EXISTING_CLASSIFICATION_CONFLICT:'+item.candidate_ref);
   const unchanged=current?.status==='CONFIRMED'&&current.category===mapped.category&&
      current.subcategory===mapped.subcategory;
   if(apply&&!unchanged){
     const review={status:'CONFIRMED',category:mapped.category,subcategory:mapped.subcategory,
       source:'SUPPLIER_MAPPING',provider:'aliexpress',source_path:path};
     await client.query(
       'UPDATE sourcing_candidates SET commercial_taxonomy_review=$1::jsonb,updated_by=$2 WHERE id=$3',
       [JSON.stringify(review),actor,candidate.id]);
     await client.query(
       `INSERT INTO sourcing_candidate_events(candidate_id,event_type,changes,triggered_by)
        VALUES ($1,'data_correction',$2::jsonb,$3)`,
       [candidate.id,JSON.stringify({commercial_taxonomy_review:review}),actor]);
   }
   changes.push({candidate_ref:item.candidate_ref,category:mapped.category,
     subcategory:mapped.subcategory,action:unchanged?'UNCHANGED':apply?'ATTACHED':'WOULD_ATTACH'});
  }
  if(apply)await client.query('COMMIT');
  return {run_ref:'KIR-000007',mode:apply?'APPLIED':'PREVIEW',total:changes.length,
    changed:changes.filter(x=>x.action==='ATTACHED').length,changes,
    kir_writes:0,customs_writes:0,product_writes:0,
    note:'Only candidate boutique classification + audit events; never changes economic customs status, scan decision or KIR evidence.'};
 }catch(e){if(apply){try{await client.query('ROLLBACK');}catch(_){} }throw e;}
 finally{if(apply)client.release();}
}
if(require.main===module){
 const apply=process.argv.includes('--apply');
 const actor=process.argv.find(x=>x.startsWith('--actor='))?.slice(8)||null;
 const confirmed=process.argv.includes('--confirm=KIR-000007-COMMERCIAL-20');
 if(apply&&(!actor||!confirmed)){console.error('APPLY_REQUIRES_ACTOR_AND_CONFIRMATION');process.exitCode=1;}
 else run({apply,actor}).then(r=>console.log(JSON.stringify(r,null,2)))
  .catch(e=>{console.error(e.message);process.exitCode=1;})
  .finally(()=>db.pool.end());
}
module.exports={run};
