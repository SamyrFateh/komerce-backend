'use strict';
/** @komerce-arch
 * @role cj-commercial-proposals
 * @domain sourcing
 * @layer script
 * @criticality low
 * @inputs source paths grouped by KIR audit, active boutique taxonomy
 * @outputs read-only human review proposals
 * @depends db.js, scripts/audit-kir-unified-commercial-coverage.js
 * @db-read boutique_categories, boutique_subcategories, import_runtime_runs, import_runtime_item_events, sourcing_candidates, supplier_commercial_category_mappings
 * @db-write none
 * @db-txn none
 */
const db=require('../db');
const {audit:coverageAudit}=require('./audit-kir-unified-commercial-coverage');
const {normalizePath}=require('../services/supplier-commercial-category-mapping');
// Explicit phrase-level evidence only. These are proposals, never automatic mappings.
const RULES=[
 {re:/home (office|storage)|bathroom storage/,pair:['Maison','Rangement'],evidence:'storage'},
 {re:/lady dresses|blouses|rompers|wide leg pants|panties/,pair:['Mode & Beauté','Femme'],evidence:'womens garment'},
 {re:/men.s clothing|casual pants|t-shirts|socks/,pair:['Mode & Beauté','Homme'],evidence:'mens garment'},
 {re:/stuffed.*plush animals/,pair:['Enfant','Jouets'],evidence:'plush toy'},
 {re:/sportswear.*sports accessories/,pair:['Sport','Fitness'],evidence:'sports accessories',reviewOnly:true},
];
function suggest(sourcePath,activePairs) {
 const normalized=normalizePath(sourcePath);
 const matches=RULES.filter(r=>r.re.test(normalized)&&activePairs.has(r.pair.join('/')));
 if(matches.length!==1)return {status:'REVIEW_REQUIRED',proposal:null,reason:matches.length?'MULTIPLE_POSSIBLE':'NO_SAFE_MATCH'};
 const rule=matches[0];
 return {status:'PROPOSAL_NEEDS_CONFIRMATION',proposal:{category:rule.pair[0],subcategory:rule.pair[1]},
  reason:rule.reviewOnly?'BROAD_CATEGORY_CONFIRM':'SOURCE_PATH_PHRASE',evidence:rule.evidence};
}
async function audit(runRef,deps={}) {
 const q=deps.query||db;
 const coverage=await (deps.coverageAudit||coverageAudit)(runRef,{query:q});
 const {rows}=await q.query(`SELECT bc.key AS category,bs.key AS subcategory
 FROM boutique_categories bc JOIN boutique_subcategories bs ON bs.category_key=bc.key
 WHERE bc.is_active=TRUE AND bs.is_active=TRUE`);
 const pairs=new Set(rows.map(r=>r.category+'/'+r.subcategory));
 const all=coverage.products.filter(p=>p.status==='REVIEW_REQUIRED');
 const grouped=new Map();
 for(const p of all){
   const key=normalizePath(p.source_path)||'__MISSING_PATH__';
   if(!grouped.has(key))grouped.set(key,{source_path:p.source_path,product_refs:[]});
   grouped.get(key).product_refs.push(p.candidate_ref);
 }
 const decisions=[...grouped.values()].map(g=>({...g,count:g.product_refs.length,
   ...suggest(g.source_path,pairs)})).sort((a,b)=>b.count-a.count||String(a.source_path).localeCompare(String(b.source_path)));
 return {run_ref:runRef,provider:coverage.provider,inspected:coverage.inspected,
   unresolved_products:all.length,review_groups:decisions.length,
   proposed_groups:decisions.filter(x=>x.proposal).length,
   manual_only_groups:decisions.filter(x=>!x.proposal).length,
   workpack:decisions.slice(0,10),deferred_groups:Math.max(0,decisions.length-10),
   all_groups:decisions,writes:0,provider_calls:0,
   note:'Read-only suggestions; no category is confirmed, auto-applied or published.'};
}
if(require.main===module){
 const run=process.argv.find(x=>x.startsWith('--run='))?.slice(6)||'';
 audit(run).then(x=>console.log(JSON.stringify(x,null,2)))
  .catch(e=>{console.error(e.message);process.exitCode=1;})
  .finally(()=>db.pool.end());
}
module.exports={audit,suggest};
