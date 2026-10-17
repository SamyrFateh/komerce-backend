'use strict';
/** @komerce-arch
 * @role golden-post-purge-foundation-gate
 * @domain infrastructure
 * @layer script
 * @criticality low
 * @inputs database connection and foundation data
 * @outputs read-only golden restart gate
 * @depends db.js
 * @db-read pg_catalog, boutique_categories, boutique_subcategories, supplier_commercial_category_mappings, business_rules, sourcing_sources, orders, products, sourcing_candidates
 * @db-write none
 * @db-txn none
 */
const db=require('../db');
const MUST_KEEP=['orders','products','sourcing_candidates'];
async function gate(q=db){
 const {rows:[identity]}=await q.query(`SELECT current_database() AS database_name,
 current_user AS database_user, inet_server_addr()::text AS server_ip,
 current_setting('application_name',true) AS application_name`);
 const {rows:tables}=await q.query(`SELECT tablename FROM pg_tables WHERE schemaname='public'`);
 const has=new Set(tables.map(x=>x.tablename));
 const counts={};
 for(const t of MUST_KEEP) {
  if(has.has(t)){const {rows:[r]}=await q.query('SELECT count(*)::int AS n FROM "'+t+'"');counts[t]=r.n;}
  else counts[t]=null;
 }
 const mappings={};
 if(has.has('supplier_commercial_category_mappings')){
  const {rows}=await q.query(`SELECT provider,status,count(*)::int AS n
    FROM supplier_commercial_category_mappings GROUP BY provider,status ORDER BY provider,status`);
  for(const r of rows)mappings[r.provider+':'+r.status]=r.n;
 }
 const taxonomy={};
 if(has.has('boutique_categories')&&has.has('boutique_subcategories')){
  const {rows:[r]}=await q.query(`SELECT EXISTS(SELECT 1 FROM boutique_categories bc
   JOIN boutique_subcategories bs ON bs.category_key=bc.key
   WHERE bc.key='Maison' AND bc.is_active=TRUE AND bs.key='Rangement' AND bs.is_active=TRUE) AS rangement_active`);
  taxonomy.rangement_active=r.rangement_active;
 }
 const rules={};
 if(has.has('business_rules')){
  const {rows}=await q.query(`SELECT key,value FROM business_rules
   WHERE key IN ('CANONICAL_MARGIN_WRITER_ENABLED','CANONICAL_MARGIN_WRITE_PROVISIONAL')
   ORDER BY key`);
  for(const r of rows)rules[r.key]=r.value;
 }
 let sourcing=null;
 if(has.has('sourcing_sources')){
  const {rows:[r]}=await q.query(`SELECT count(*)::int AS sources,
 count(*) FILTER(WHERE autopilot_enabled)::int AS autopilot_enabled FROM sourcing_sources`);
  sourcing=r;
 }
 const reasons=[];
 for(const t of MUST_KEEP)if(counts[t]!==0)reasons.push('TRANSIENT_NOT_EMPTY:'+t);
 if(!taxonomy.rangement_active)reasons.push('MAISON_RANGEMENT_NOT_ACTIVE');
 if(!(mappings['cjdropshipping:CONFIRMED']>=12))reasons.push('CJ_CONFIRMED_MAPPINGS_MISSING');
 if(!(mappings['aliexpress:CONFIRMED']>0))reasons.push('ALIEXPRESS_CONFIRMED_MAPPINGS_MISSING');
 if(!('CANONICAL_MARGIN_WRITER_ENABLED' in rules)||!('CANONICAL_MARGIN_WRITE_PROVISIONAL' in rules))
  reasons.push('A8_RULES_MISSING');
 return {phase:'POST_PURGE_FOUNDATION',database_identity:identity,runtime:process.env.KOMERCE_ENV||process.env.NODE_ENV||null,
   transient_counts:counts,confirmed_mappings:mappings,taxonomy,rules,sourcing,
   gate:reasons.length?'HOLD':'FOUNDATION_READY',reasons,
   warnings:['Manually verify database_identity against Railway staging before any write.',
    'KIR historical runs and products were intentionally purged; do not reuse their old coverage audits.',
    'A8 rule presence does not certify customs or margin behavior.'],
   writes:0};
}
if(require.main===module){
 gate().then(x=>console.log(JSON.stringify(x,null,2)))
  .catch(e=>{console.error(e.message);process.exitCode=1;})
  .finally(()=>db.pool.end());
}
module.exports={gate};
