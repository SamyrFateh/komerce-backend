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
   evidence.items.length!==20||evidence.items.some(x=>!x.candidate_ref)||
   new Set(evidence.items.map(x=>x.candidate_ref)).size!==20)
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
   if(!candidate || ['rejected','archived'].includes(candidate.state))
    throw new Error('CANDIDATE_NOT_EDITABLE:'+item.candidate_ref);
   const imported=candidate.state==='imported_to_catalog' && Boolean(candidate.product_id);
   if((candidate.state==='imported_to_catalog')!==Boolean(candidate.product_id))
    throw new Error('CANDIDATE_PRODUCT_STATE_CONFLICT:'+item.candidate_ref);
   let product=null;
   if(imported){
    const {rows:[linked]}=await client.query(
      `SELECT id,boutique_category_key,boutique_subcategory_key,lifecycle_status,is_active
         FROM products WHERE id=$1${apply?' FOR UPDATE':''}`,[candidate.product_id]);
    if(!linked || linked.lifecycle_status!=='candidate' || linked.is_active!==false)
      throw new Error('CATALOG_PRODUCT_NOT_DRAFT:'+item.candidate_ref);
    if((linked.boutique_category_key && linked.boutique_category_key!==mapped.category) ||
       (linked.boutique_subcategory_key && linked.boutique_subcategory_key!==mapped.subcategory))
      throw new Error('CATALOG_CLASSIFICATION_CONFLICT:'+item.candidate_ref);
    product=linked;
   }
   const current=candidate.commercial_taxonomy_review;
   if(current&&current.status==='CONFIRMED'&&(current.category!==mapped.category||
      current.subcategory!==mapped.subcategory))
     throw new Error('EXISTING_CLASSIFICATION_CONFLICT:'+item.candidate_ref);
   const unchanged=current?.status==='CONFIRMED'&&current.category===mapped.category&&
      current.subcategory===mapped.subcategory;
   const needsProduct=Boolean(product && (!product.boutique_category_key || !product.boutique_subcategory_key));
   if(apply && needsProduct){
     const updated=await client.query(
       `UPDATE products SET boutique_category_key=$1,boutique_subcategory_key=$2
          WHERE id=$3 AND lifecycle_status='candidate' AND is_active=FALSE
            AND (boutique_category_key IS NULL OR boutique_category_key=$1)
            AND (boutique_subcategory_key IS NULL OR boutique_subcategory_key=$2)`,
       [mapped.category,mapped.subcategory,product.id]);
     if(updated.rowCount!==1)throw new Error('CATALOG_DRAFT_CHANGED:'+item.candidate_ref);
   }
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
     subcategory:mapped.subcategory,
     candidate_action:unchanged?'UNCHANGED':apply?'ATTACHED':'WOULD_ATTACH',
     product_action:!product?'NOT_APPLICABLE':needsProduct?(apply?'FILLED':'WOULD_FILL'):'UNCHANGED'});
  }
  if(apply)await client.query('COMMIT');
  return {run_ref:'KIR-000007',mode:apply?'APPLIED':'PREVIEW',total:changes.length,
    changed:changes.filter(x=>x.candidate_action==='ATTACHED').length,
    product_filled:changes.filter(x=>x.product_action==='FILLED').length,changes,
    kir_writes:0,customs_writes:0,product_taxonomy_writes:changes.filter(x=>x.product_action==='FILLED').length,
    note:'Only candidate and inactive catalog draft boutique classification; never changes customs, price, lifecycle, publication or KIR evidence.'};
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
