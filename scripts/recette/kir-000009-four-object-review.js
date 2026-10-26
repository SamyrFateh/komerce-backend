/** @komerce-arch-lite
 * @role kir-nine-object-classification-review
 * @domain sourcing
 * @layer tooling
 * @purpose Read-only targeted classification proposals for four real AliExpress objects
 * @db-read sourcing_candidates, import_runtime_runs, boutique_categories, boutique_subcategories
 * @db-write none
 */
'use strict';
const fs=require('node:fs'),path=require('node:path'),db=require('../db');
const {confirmTarget}=require('./recette/target-guard');
const HOST='https://komerce-backend-production.up.railway.app';
const REF='KIR-000009';
const EXPECTED=Object.freeze(['KSC-000162','KSC-000164','KSC-000175','KSC-000178']);
const TARGETS=Object.freeze({
  'KSC-000162':{category:'Tech',subcategory:'Audio',evidence:'cable organizer clips'},
  'KSC-000164':{category:'Tech',subcategory:'Phones',evidence:'usb-c port dust protection'},
  'KSC-000175':{category:'Tech',subcategory:'Audio',evidence:'magnetic cable holder'},
  'KSC-000178':{category:'Tech',subcategory:'Audio',evidence:'cable ties and organizers'},
});
async function inspect({database=db,confirm=confirmTarget,env=process.env}={}){
 if(env.KOMERCE_ENV!=='staging'||env.NODE_ENV==='production'||env.STAGING_BASE_URL!==HOST)
  throw Error('STAGING_ONLY');
 const target=await confirm({db:database,env});
 if(target?.confirmed!==true)throw Error('TARGET_NOT_CONFIRMED');
 const tx=await database.pool.connect();
 try{
  await tx.query('BEGIN READ ONLY');
  const {rows}=await tx.query(`SELECT sc.candidate_ref,sc.product_name,sc.supplier_category,
    sc.product_id,sc.commercial_taxonomy_review,sc.state
    FROM sourcing_candidates sc JOIN import_runtime_runs ir ON ir.import_id=sc.import_id
    WHERE ir.run_ref=$1 AND sc.candidate_ref=ANY($2::text[])
    ORDER BY sc.candidate_ref`,[REF,EXPECTED]);
  const {rows:active}=await tx.query(`SELECT bc.key AS category,bc.label AS category_label,
    bs.key AS subcategory,bs.label AS subcategory_label
    FROM boutique_categories bc JOIN boutique_subcategories bs ON bs.category_key=bc.key
    WHERE bc.is_active=TRUE AND bs.is_active=TRUE`);
  const set=new Set(active.map(x=>x.category+'/'+x.subcategory));
  const items=EXPECTED.map(ref=>{
   const c=rows.find(x=>x.candidate_ref===ref),proposal=TARGETS[ref];
   const valid=set.has(proposal.category+'/'+proposal.subcategory);
   const existing=c?.commercial_taxonomy_review;
   const conflict=Boolean(c?.product_id||existing?.status==='CONFIRMED'
     &&(existing.category!==proposal.category||existing.subcategory!==proposal.subcategory));
   return {candidate_ref:ref,product_name:c?.product_name||null,
     supplier_category:c?.supplier_category||null,
     proposal,active_pair:valid,conflict,found:Boolean(c),
     decision:c&&!conflict&&valid?'READY_FOR_OPERATOR_REVIEW':'NOT_READY'};
  });
  await tx.query('ROLLBACK');
  return {run_ref:REF,mode:'READ_ONLY',writes:0,items,available_pairs:active,
    proposals_ready:items.every(x=>x.decision==='READY_FOR_OPERATOR_REVIEW')};
 }catch(e){await tx.query('ROLLBACK').catch(()=>{});throw e}
 finally{tx.release()}
}
if(require.main===module){
 inspect().then(r=>{
  const out=path.resolve('test-results/staging-p1-20/four-object-proposals.json');
  fs.mkdirSync(path.dirname(out),{recursive:true});
  fs.writeFileSync(out,JSON.stringify(r,null,2)+'\n');
  console.log(JSON.stringify({ready:r.proposals_ready,items:r.items},null,2));
  if(!r.proposals_ready)process.exitCode=2;
 }).catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>db.pool.end());
}
module.exports={inspect,TARGETS};
