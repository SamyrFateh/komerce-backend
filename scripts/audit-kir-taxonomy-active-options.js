/** @komerce-arch
 * @role kir-taxonomy-active-options
 * @domain sourcing
 * @layer script
 * @criticality low
 * @inputs KIR ref, active boutique taxonomy
 * @outputs read-only commercial mapping proposal versus active category keys
 * @depends db.js, scripts/audit-kir-commercial-mapping-coverage.js
 * @db-read boutique_categories, boutique_subcategories, supplier_commercial_category_mappings, sourcing_candidates, import_runtime_runs, import_runtime_item_events
 * @db-write none
 * @db-txn none
 */
'use strict';
const db=require('../db');
const {audit:coverageAudit}=require('./audit-kir-commercial-mapping-coverage');
const PROPOSALS={
  'automobiles, parts & accessories > exterior accessories':['Auto','Accessoires extérieurs'],
  'automobiles, parts & accessories > interior accessories':['Auto','Accessoires intérieurs'],
  'automobiles, parts & accessories > car electronics':['Auto','Électronique embarquée'],
  'phones & telecommunications accessories > mobile phone cases & covers':['Téléphonie','Coques et étuis'],
  'phones & telecommunications accessories > holders & stands':['Téléphonie','Supports'],
  'phones & telecommunications accessories > mobile phone protective film':['Téléphonie','Protections d’écran'],
  'phones & telecommunications accessories > mobile phone photography accessories':['Téléphonie','Accessoires photo'],
  'phones & telecommunications accessories > mobile phone accessories':['Téléphonie','Accessoires divers'],
};
function fold(value){return String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();}
function suggest(group,categories,subcategories){
 const destination=PROPOSALS[String(group.source_path||'').normalize('NFKC').trim().toLowerCase().replace(/\s*>\s*/g,' > ').replace(/\s+/g,' ')]||null;
 if(!destination)return {status:'REVIEW_REQUIRED',reason:'NO_FR_PROPOSAL'};
 const [parent,child]=destination;
 const parentRow=categories.find(x=>x.is_active&&[x.key,x.label].some(v=>fold(v)===fold(parent)));
 if(!parentRow)return {status:'PARENT_CATEGORY_MISSING',proposed_category_fr:parent,proposed_subcategory_fr:child};
 const subRow=subcategories.find(x=>x.is_active&&x.category_key===parentRow.key&&[x.key,x.label,x.short_label].some(v=>fold(v)===fold(child)));
 return {status:subRow?'EXISTING_ACTIVE':'SUBCATEGORY_PROPOSED',
   proposed_category_fr:parent,proposed_subcategory_fr:child,
   category_key:parentRow.key,subcategory_key:subRow?.key||null};
}
async function audit(runRef,deps={}){
 const coverage=await (deps.coverageAudit||coverageAudit)(runRef);
 const q=deps.query||db;
 const [catResult,subResult]=await Promise.all([
  q.query('SELECT key,label,is_active FROM boutique_categories'),
  q.query('SELECT category_key,key,label,short_label,is_active FROM boutique_subcategories'),
 ]);
 const categories=coverage.categories.map(group=>({
  source_path:group.source_path,count:group.count,
  existing_mapping:group.mapping,
  suggestion:group.mapping?{status:'ALREADY_MAPPED'}:suggest(group,catResult.rows,subResult.rows),
 }));
 return {run_ref:runRef,source_category_groups:categories.length,
   categories,writes:0,provider_calls:0,
   note:'Proposals only. Never infer keys, create subcategories, confirm mappings, classify customs or alter KIR.'};
}
if(require.main===module){
 const run=process.argv.find(x=>x.startsWith('--run='))?.slice(6)||'';
 audit(run).then(x=>console.log(JSON.stringify(x,null,2)))
   .catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>db.pool.end());
}
module.exports={audit,suggest};
