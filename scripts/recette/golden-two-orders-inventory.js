/**
 * @komerce-arch-lite
 * @role          golden-two-orders-cleanup-inventory
 * @domain        orders
 * @layer         script
 * @owner         backend-core
 * @purpose       Identifier les commandes Golden et leurs dependances avant une suppression ciblee.
 * @impact-areas  staging-only, orders, finance, recette
 */
'use strict';
async function inspect({db}) {
 const client=await db.pool.connect();
 try {
  await client.query('BEGIN READ ONLY');
  const {rows}=await client.query(`SELECT o.reference, o.status::text AS status,
   o.payment_status::text AS payment_status, o.payment_mode::text AS payment_mode,
   o.simulation_scope, o.created_at, o.total_kmf,
   (SELECT COUNT(*)::int FROM order_items i WHERE i.order_id=o.id) AS items_count,
   (SELECT COUNT(*)::int FROM order_item_real_cost_allocations a WHERE a.order_id=o.id) AS cost_rows
   FROM orders o ORDER BY o.created_at DESC LIMIT 100`);
  await client.query('ROLLBACK');
  return {mode:'READ_ONLY',inspected_orders:rows.length,
   likely_golden:rows.filter(r=>/GOLDEN|E2E|TEST|RECETTE/i.test(r.reference||'')),
   recent_orders:rows,
   deletion_authorized:false,
   next:'Confirmer les 2 references et les mouvements financiers avant suppression ciblee'};
 }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}
 finally{client.release()}
}
async function main(){
 if(process.argv.includes('--delete')||process.argv.includes('--apply')) throw Error('DELETE_FORBIDDEN');
 const db=require('../../db');
 try{process.stdout.write(JSON.stringify(await inspect({db}),null,2)+'\n')}
 finally{await db.pool.end()}
}
if(require.main===module)main().catch(e=>{process.stderr.write(e.message+'\n');process.exitCode=1});
module.exports={inspect};
