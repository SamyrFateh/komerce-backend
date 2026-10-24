/** @komerce-arch-lite
 * @role staging-campaign-selective-cleanup-audit
 * @domain infrastructure
 * @layer script
 * @owner backend-core
 * @purpose Identify RCT1-owned rows and FK dependencies; no deletion.
 * @db-read orders, products, users, relais, pg_catalog
 * @db-write none
 */
'use strict';
const { ORDERS, MARKET_ORDERS, PRODUCTS, ACTORS, RELAYS } = require('./rct1/data');
const { confirmTarget } = require('./target-guard');
const ROOTS = Object.freeze([
  { table:'orders', key:'reference', values:[...ORDERS,...MARKET_ORDERS].map(o=>o.ref), scope:'simulation_scope', scopeValue:'RCT1', retention:'campaign_transaction' },
  { table:'products', key:'product_ref', values:Object.values(PRODUCTS).map(p=>p.ref), retention:'persistent_demo_catalog' },
  { table:'users', key:'email', values:ACTORS.map(a=>a.email), retention:'protected_identity' },
  { table:'relais', key:'name', values:RELAYS.map(r=>r.name), retention:'protected_operational_reference' },
]);
function scopedSql(root) {
  if (!ROOTS.includes(root)) throw new Error('CAMPAIGN_ROOT_NOT_ALLOWLISTED');
  return {
    sql: `SELECT "id", "${root.key}" AS marker FROM "${root.table}" WHERE "${root.key}" = ANY($1::text[])` +
      (root.scope ? ` AND "${root.scope}" = $2` : '') + ` ORDER BY "${root.key}"`,
    params: root.scope ? [root.values, root.scopeValue] : [root.values],
  };
}
function evaluateAudit(roots, dependencies) {
  const reasons = [];
  const protectedRoots = ROOTS.filter(r=>r.retention!=='campaign_transaction').map(r=>({table:r.table,retention:r.retention}));
  roots.forEach(r=>{if(r.missing.length) reasons.push('MISSING_FIXTURES:'+r.table);});
  dependencies.forEach(d=>reasons.push('UNREVIEWED_FK:'+d.parent_table+'->'+d.child_table+':'+d.constraint_name));
  return {cleanup_allowed:false, protected_roots:protectedRoots, eligible_for_future_provenance_review:['orders'], injection_recommended:roots.some(r=>r.missing.length>0),
    reasons:reasons.length?reasons:['NO_DELETION_CONTRACT_APPROVED'],
    message:'Inventaire exclusivement : aucune suppression autorisée par cette commande.'};
}
async function inspect({db, env=process.env, confirm=confirmTarget}) {
  if (String(env.KOMERCE_ENV).toLowerCase()!=='staging' || env.NODE_ENV==='production') throw Error('CAMPAIGN_STAGING_ONLY');
  const identity=await confirm({db,env});
  if (!identity || identity.confirmed!==true) throw Error('CAMPAIGN_TARGET_NOT_CONFIRMED');
  const client=await db.pool.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const roots=[];
    for(const root of ROOTS) {
      const {sql,params}=scopedSql(root);
      const {rows}=await client.query(sql,params);
      const found=new Set(rows.map(r=>r.marker));
      roots.push({table:root.table,retention:root.retention,present:rows.length,ids:rows.map(r=>r.id),
        missing:root.values.filter(v=>!found.has(v))});
    }
    const {rows:dependencies}=await client.query(`
      SELECT p.relname AS parent_table,c.relname AS child_table,con.conname AS constraint_name,
             pg_get_constraintdef(con.oid) AS definition
        FROM pg_constraint con
        JOIN pg_class p ON p.oid=con.confrelid
        JOIN pg_class c ON c.oid=con.conrelid
        JOIN pg_namespace pn ON pn.oid=p.relnamespace
        JOIN pg_namespace cn ON cn.oid=c.relnamespace
       WHERE con.contype='f' AND pn.nspname='public' AND cn.nspname='public'
         AND p.relname = ANY($1::text[])
       ORDER BY p.relname,c.relname,con.conname`,[ROOTS.map(r=>r.table)]);
    await client.query('ROLLBACK');
    return {phase:'cleanup-audit',scope:'RCT1',writes:0,target_confirmed:true,roots,
      inbound_foreign_keys:dependencies,verdict:evaluateAudit(roots,dependencies)};
  } catch(err) {
    await client.query('ROLLBACK').catch(()=>{});
    throw err;
  } finally {client.release();}
}
if(require.main===module) {
  if(process.argv.slice(2).length) {
    console.error('REFUS: aucune option de suppression disponible');process.exitCode=2;
  } else {
    const db=require('../../db');
    inspect({db}).then(r=>console.log(JSON.stringify(r,null,2)))
      .catch(e=>{console.error('REFUS: '+e.message);process.exitCode=1;})
      .finally(()=>db.pool.end());
  }
}
module.exports={ROOTS,scopedSql,evaluateAudit,inspect};
