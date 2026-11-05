#!/usr/bin/env node
/**
 * @komerce-arch-lite
 * @role hub-v1-staging-certificate-readonly
 * @domain logistics
 * @layer script
 * @owner backend-core
 * @purpose Collecter les preuves physiques déjà présentes sur staging sans modifier RCT1.
 * @impact-areas logistics, staging-only, purchasing
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const MIGRATIONS = Object.freeze([
  '391_hub_sku_physical_codes.sql',
  '392_hub_order_bag_ownership.sql',
  '393_hub_order_bag_scan_evidence.sql',
  '394_hub_packed_bag_box_link.sql',
  '395_product_suppliers_unique_active_priority.sql',
]);

async function inspect(client) {
  // Important : cette transaction interdit toute écriture, même indirecte.
  await client.query('BEGIN READ ONLY');
  const get = async (query, params=[]) => (await client.query(query,params)).rows;
  try {
    const migrations = await get(
      'SELECT filename, applied_at FROM public.schema_migrations WHERE filename = ANY($1::text[]) ORDER BY filename',
      [MIGRATIONS]
    );
    const duplicates = await get(
      "SELECT product_id, priority, COUNT(*)::int AS n FROM public.product_suppliers " +
      "WHERE is_active = TRUE AND deleted_at IS NULL GROUP BY product_id, priority HAVING COUNT(*) > 1 ORDER BY product_id, priority"
    );
    // RCT1 et AUDIT sont des données historiques de recette ; pas des commandes client à régulariser.
    const fixtureWhere = "(o.simulation_scope = 'RCT1' OR o.reference LIKE 'RCT1-%' OR o.reference LIKE 'AUDIT-%')";
    const orders = await get(
      "SELECT o.reference, o.status::text AS status, o.payment_status::text AS payment, " +
      "o.simulation_scope, COUNT(DISTINCT oi.id)::int AS item_lines, " +
      "COUNT(DISTINCT pl.id)::int AS purchase_lines " +
      "FROM public.orders o LEFT JOIN public.order_items oi ON oi.order_id=o.id " +
      "LEFT JOIN public.purchase_lines pl ON pl.order_item_id=oi.id AND pl.cancelled_at IS NULL " +
      "WHERE " + fixtureWhere + " GROUP BY o.id ORDER BY o.reference LIMIT 200"
    );
    const fixture = "SELECT id FROM public.orders o WHERE " + fixtureWhere;
    const [alloc,placements,bags,links,shipments,relay,authorizations,local] = await Promise.all([
      get("SELECT COUNT(*)::int AS n FROM public.hub_purchase_allocations a WHERE a.order_id IN (" + fixture + ")"),
      get("SELECT COUNT(*)::int AS n FROM public.hub_physical_unit_placements p JOIN public.hub_purchase_allocations a ON a.id=p.allocation_id WHERE a.order_id IN (" + fixture + ")"),
      get("SELECT COUNT(*)::int AS n FROM public.hub_physical_units u WHERE u.order_id IN (" + fixture + ") AND u.unit_type='ORDER_BAG'"),
      get("SELECT COUNT(*)::int AS n FROM public.hub_box_bags b JOIN public.hub_physical_units u ON u.id=b.bag_unit_id WHERE u.order_id IN (" + fixture + ")"),
      get("SELECT COUNT(*)::int AS n FROM public.international_shipment_hub_units h JOIN public.hub_box_bags b ON b.box_unit_id=h.physical_unit_id JOIN public.hub_physical_units u ON u.id=b.bag_unit_id WHERE u.order_id IN (" + fixture + ")"),
      get("SELECT COUNT(*)::int AS n FROM public.international_shipment_relay_receipts r JOIN public.order_items oi ON oi.id=r.order_item_id WHERE oi.order_id IN (" + fixture + ")"),
      get("SELECT a.authorization_type, COUNT(*)::int AS n FROM public.purchase_order_authorizations a WHERE a.purchase_order_id IN (SELECT DISTINCT pl.purchase_order_id FROM public.purchase_lines pl JOIN public.order_items oi ON oi.id=pl.order_item_id WHERE oi.order_id IN (" + fixture + ") AND pl.purchase_order_id IS NOT NULL) GROUP BY a.authorization_type ORDER BY a.authorization_type"),
      get("SELECT COUNT(*)::int AS n FROM public.hub_purchase_allocations a JOIN public.order_items oi ON oi.id=a.order_item_id WHERE oi.fulfillment_source='LOCAL_STOCK' AND oi.order_id IN (" + fixture + ")"),
    ]);
    return {
      generated_at: new Date().toISOString(),
      mode:'READ_ONLY',
      level:'STAGING_INVENTORY_ONLY_NOT_TRANSACTIONAL_E2E',
      migration_proof: { expected:MIGRATIONS, applied:migrations },
      duplicate_active_supplier_priorities:duplicates,
      fixtures:orders,
      physical_trace_counts:{
        allocations:alloc[0].n,
        physical_placements:placements[0].n,
        order_bags:bags[0].n,
        bags_in_boxes:links[0].n,
        boxes_in_shipments:shipments[0].n,
        relay_receipt_proofs:relay[0].n,
        purchase_order_authorizations:authorizations,
        invalid_local_order_allocations:local[0].n,
      },
      verdict: migrations.length===MIGRATIONS.length && duplicates.length===0 && Number(local[0].n)===0
        ? 'SCHEMA_AND_GUARDS_OK_TRANSACTIONAL_STAGING_E2E_NOT_RUN'
        : 'SCHEMA_OR_GUARD_MISMATCH_NO_GO',
      not_proven_by_this_audit:[
        'Création/validation d’une nouvelle PO sur staging',
        'Paiement distinct exécuté sur staging',
        'Réception partielle et idempotence exécutées sur staging',
        'Scan physique, sac, KOM-BOX et remise transitaire exécutés sur staging',
        'Réception attestée et retrait exécutés sur staging'
      ],
    };
  } finally {
    await client.query('ROLLBACK');
  }
}

async function main() {
  if (process.env.KOMERCE_ENV!=='staging' || process.env.KOMERCE_TARGET_ENV!=='staging') {
    throw Error('STAGING_ENV_REQUIRED');
  }
  if (!process.env.DATABASE_URL) throw Error('DATABASE_URL_REQUIRED');
  const pool=new Pool({connectionString:process.env.DATABASE_URL});
  try {
    const client=await pool.connect();
    let report;
    try {report=await inspect(client);} finally {client.release();}
    const folder=path.join(process.cwd(),'test-results','hub-v1-cert');
    fs.mkdirSync(folder,{recursive:true});
    fs.writeFileSync(path.join(folder,'staging-readonly.json'),JSON.stringify(report,null,2)+'\n');
    process.stdout.write(JSON.stringify({
      mode:report.mode,level:report.level,verdict:report.verdict,
      migrations:report.migration_proof.applied.length,
      priority_duplicates:report.duplicate_active_supplier_priorities.length,
      fixture_orders:report.fixtures.length,
      trace:report.physical_trace_counts
    },null,2)+'\n');
    if(report.verdict==='SCHEMA_OR_GUARD_MISMATCH_NO_GO')process.exitCode=2;
  } finally {await pool.end();}
}

if(require.main===module)main().catch(error=>{process.stderr.write(error.message+'\n');process.exitCode=2;});
module.exports={inspect,MIGRATIONS};