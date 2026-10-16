/** @komerce-arch
 * @role kir-approved-commercial-mapping-bootstrap
 * @domain sourcing
 * @layer script
 * @criticality medium
 * @inputs KIR-000007 and explicit operator approval
 * @outputs read-only preview or atomic idempotent supplier mapping confirmations
 * @depends db.js, scripts/audit-kir-commercial-mapping-coverage.js, services/supplier-commercial-category-mapping.js
 * @db-read boutique_categories, boutique_subcategories, supplier_commercial_category_mappings, sourcing_candidates, import_runtime_runs, import_runtime_item_events
 * @db-write supplier_commercial_category_mappings
 * @db-txn script_owned
 */
'use strict';
const db=require('../db');
const {audit:coverageAudit}=require('./audit-kir-commercial-mapping-coverage');
const {normalizePath}=require('../services/supplier-commercial-category-mapping');
const APPROVED=[
 ['Automobiles, Parts & Accessories > Exterior Accessories','Auto','Accessoires','Accessoires extérieurs'],
 ['Phones & Telecommunications Accessories > Mobile Phone Cases & Covers','Tech','Phones','Coques et étuis'],
 ['Automobiles, Parts & Accessories > Interior Accessories','Auto','Accessoires','Accessoires intérieurs'],
 ['Phones & Telecommunications Accessories > Holders & Stands','Tech','Phones','Supports de téléphone'],
 ['Phones & Telecommunications Accessories > Mobile Phone Protective Film','Tech','Phones',"Protections d'écran"],
 ['Phones & Telecommunications Accessories > Mobile Phone Photography Accessories','Tech','Phones','Accessoires photo téléphone'],
 ['Automobiles, Parts & Accessories > Car Electronics','Auto','Accessoires','Électronique automobile'],
 ['Phones & Telecommunications Accessories > Mobile Phone Accessories','Tech','Phones','Accessoires de téléphone'],
];
async function plan(coverage){
 if(coverage.provider!=='AliExpress'||coverage.inspected!==20||coverage.source_category_groups!==8||
    coverage.ungrouped_products!==0)throw new Error('KIR_SOURCE_EVIDENCE_CHANGED');
 const wanted=new Map(APPROVED.map(([path,category,subcategory,label_fr])=>
    [normalizePath(path),{path,category,subcategory,label_fr}]));
 const actual=new Set(coverage.categories.map(x=>normalizePath(x.source_path)));
 if(actual.size!==8||[...actual].some(x=>!wanted.has(x))||
    coverage.categories.reduce((s,g)=>s+g.count,0)!==20)
    throw new Error('KIR_FAMILY_SET_CHANGED');
 return coverage.categories.map(group=>({...wanted.get(normalizePath(group.source_path)),count:group.count}));
}
async function run({apply=false,actor=null,query=db,coverage=coverageAudit}={}){
 const groups=await plan(await coverage('KIR-000007'));
 const client=apply?await query.getClient():query;
 try{
  if(apply)await client.query('BEGIN');
  const {rows:destinations}=await client.query(
    `SELECT bc.key AS category,bs.key AS subcategory
      FROM boutique_categories bc JOIN boutique_subcategories bs
      ON bs.category_key=bc.key AND bs.is_active=TRUE
      WHERE bc.is_active=TRUE AND ((bc.key='Auto' AND bs.key='Accessoires') OR
      (bc.key='Tech' AND bs.key='Phones'))`);
  const destinationsSet=new Set(destinations.map(x=>x.category+'/'+x.subcategory));
  if(destinationsSet.size!==2||!destinationsSet.has('Auto/Accessoires')||!destinationsSet.has('Tech/Phones'))
    throw new Error('BOUTIQUE_TARGET_PAIR_INACTIVE');
  const receipts=[];
  for(const group of groups){
    const path=normalizePath(group.path);
    const {rows:[existing]}=await client.query(
      'SELECT status,boutique_category_key,boutique_subcategory_key,proposed_label_fr FROM supplier_commercial_category_mappings WHERE provider=$1 AND source_category_path=$2'+(apply?' FOR UPDATE':''),
      ['aliexpress',path]);
    const same=existing?.status==='CONFIRMED'&&existing.boutique_category_key===group.category&&
      existing.boutique_subcategory_key===group.subcategory&&existing.proposed_label_fr===group.label_fr;
    if(existing&&!same)throw new Error('EXISTING_MAPPING_CONFLICT:'+path);
    if(apply&&!same){
      const result=await client.query(
       `INSERT INTO supplier_commercial_category_mappings
       (provider,source_category_path,source_locale,proposed_label_fr,
        boutique_category_key,boutique_subcategory_key,status,confirmed_by,confirmed_at)
       VALUES ('aliexpress',$1,'en',$2,$3,$4,'CONFIRMED',$5,NOW())
       ON CONFLICT(provider,source_category_path) DO NOTHING RETURNING id`,
       [path,group.label_fr,group.category,group.subcategory,actor]);
      if(result.rowCount!==1)throw new Error('CONCURRENT_MAPPING_CONFLICT:'+path);
    }
    receipts.push({source_path:group.path,count:group.count,category:group.category,
      subcategory:group.subcategory,label_fr:group.label_fr,
      action:same?'UNCHANGED':apply?'CONFIRMED':'WOULD_CONFIRM'});
  }
  if(apply)await client.query('COMMIT');
  return {run_ref:'KIR-000007',provider:'AliExpress',mode:apply?'APPLIED':'PREVIEW',
    total_products:20,groups:receipts.length,
    changed:receipts.filter(x=>x.action==='CONFIRMED').length,receipts,
    product_writes:0,customs_writes:0,kir_writes:0,
    note:'Mapping only: no supplier calls, product edits, customs classification, reimport or publication.'};
 }catch(e){if(apply){try{await client.query('ROLLBACK');}catch(_){} }throw e;}
 finally{if(apply)client.release();}
}
if(require.main===module){
 const apply=process.argv.includes('--apply');
 const actorArg=process.argv.find(x=>x.startsWith('--actor='));
 const actor=actorArg?.slice('--actor='.length)||null;
 if(apply&&(!actor||process.argv.find(x=>x.startsWith('--confirm='))!=='--confirm=KIR-000007-8-MAPPINGS')){
  console.error('APPLY_REQUIRES_ACTOR_AND_EXPLICIT_KIR_CONFIRMATION');process.exitCode=1;
 }else{
  run({apply,actor}).then(result=>console.log(JSON.stringify(result,null,2)))
    .catch(e=>{console.error(e.message);process.exitCode=1;})
    .finally(()=>db.pool.end());
 }
}
module.exports={run,plan,APPROVED};
