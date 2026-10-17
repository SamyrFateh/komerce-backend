'use strict';
/** @komerce-arch
 * @role golden-staging-deep-clean-inventory
 * @domain infrastructure
 * @layer script
 * @criticality medium
 * @inputs database identity, schema FK dependencies
 * @outputs read-only financial/user/customs purge inventory
 * @depends db.js, scripts/controlled-business-purge.js
 * @db-read pg_catalog, public business tables
 * @db-write none
 * @db-txn none
 */
const db=require('../db');
const {computeCascadeClosure,PROTECTED_TABLES}=require('./controlled-business-purge');
const TARGETS=Object.freeze(['users','customs_shipments','customs_shipment_audit',
 'customs_shipment_events','customs_grouping_audit','customs_payment_declarations',
 'financial_events','financial_transactions','payment_events','payments',
 'payment_attempts','transactions','transaction_documents','invoices','refunds',
 'business_rules_history','order_item_real_cost_allocations']);
const NEVER_PURGE=new Set(['schema_migrations','migrations','knex_migrations','knex_migrations_lock',
 'business_rules','finance_config','economic_variables','charges','markets','relais',
 'supplier_commercial_category_mappings','boutique_categories','boutique_subcategories',
 'roles','permissions','sourcing_sources','supplier_oauth_connections']);
const identifier=x=>{if(!/^[a-z_][a-z0-9_]*$/.test(x))throw Error('UNSAFE_IDENTIFIER');return '"'+x+'"';};
function assess(roots,edges,counts){
 const closure=computeCascadeClosure(roots,edges);
 const foundationHits=closure.filter(x=>NEVER_PURGE.has(x));
 const otherProtected=closure.filter(x=>PROTECTED_TABLES.has(x)&&!roots.includes(x)&&!NEVER_PURGE.has(x));
 return {candidate_roots:roots,cascade_tables:closure,
  foundation_hits:foundationHits,other_protected_dependencies:otherProtected,
  table_counts:counts,decision:foundationHits.length||otherProtected.length?'BLOCKED':'INVENTORY_ONLY'};
}
async function inspect(q=db){
 const {rows:[identity]}=await q.query(`SELECT current_database() AS database_name,
 current_user AS database_user,inet_server_addr()::text AS server_ip,
 inet_server_port() AS server_port`);
 const {rows:tables}=await q.query("SELECT tablename FROM pg_tables WHERE schemaname='public'");
 const existing=new Set(tables.map(x=>x.tablename));
 const roots=TARGETS.filter(x=>existing.has(x));
 const {rows:edges}=await q.query(`SELECT parent.relname AS referenced_table,child.relname AS referencing_table
 FROM pg_constraint c
 JOIN pg_class child ON child.oid=c.conrelid
 JOIN pg_class parent ON parent.oid=c.confrelid
 JOIN pg_namespace nc ON nc.oid=child.relnamespace
 JOIN pg_namespace np ON np.oid=parent.relnamespace
 WHERE c.contype='f' AND nc.nspname='public' AND np.nspname='public'`);
 const closure=computeCascadeClosure(roots,edges);
 const counts={};
 for(const table of closure){
  const {rows:[row]}=await q.query('SELECT count(*)::bigint AS n FROM '+identifier(table));
  counts[table]=Number(row.n);
 }
 const plan=assess(roots,edges,counts);
 return {purpose:'GOLDEN_STAGING_DEEP_CLEAN_INVENTORY',identity,
  runtime:process.env.KOMERCE_ENV||process.env.NODE_ENV||null,...plan,
  hard_requirements:['Prove Railway staging service and database identity out of band',
   'Take restorable database backup and verify restore procedure',
   'Define admin rebootstrap and revoke affected authentication sessions',
   'Review every CASCADE table and financial audit/legal retention scope',
   'Obtain explicit operator confirmation of final deletion plan'],
  warnings:['This script cannot prove staging from database_name, private IP or NODE_ENV.',
   'Historical financial audit records might be subject to retention requirements.',
   'This is inventory only; no delete, truncate or account mutation exists.'],
  writes:0};
}
if(require.main===module){
 if(process.argv.includes('--execute')||process.argv.includes('--apply')){
  console.error('READ_ONLY_INVENTORY_NO_EXECUTION');process.exitCode=2;
 }else inspect().then(x=>console.log(JSON.stringify(x,null,2)))
  .catch(e=>{console.error(e.message);process.exitCode=1;})
  .finally(()=>db.pool.end());
}
module.exports={inspect,assess,TARGETS,NEVER_PURGE};
