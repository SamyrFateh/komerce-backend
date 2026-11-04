#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          audit-sku-supplier-link
 * @domain        purchasing
 * @layer         tooling
 * @criticality   medium
 * @inputs        DATABASE_URL (lecture seule), --json
 * @outputs       écart SKU vendables ↔ fournisseur admissible, doublons de priorité, commandes IMPORT sans ligne d'achat, identités eBay
 * @depends       pg, services/supplier-source-resolution.js
 * @used-by       recette staging (mesure avant reset)
 * @db-read       product_skus, products, product_suppliers, suppliers, orders, order_items, purchase_lines
 * @db-write      none
 * @db-txn        read_only
 * @doctrine      docs/doctrine/DOCTRINE_SUPPLIER_ORDER_IDENTITY.md
 * @impact-areas  catalog, purchasing
 * @version       2026-11-v1
 */
'use strict';

// Lecture seule : transaction READ ONLY, SELECT uniquement. Ne jamais exécuter contre Railway sans décision explicite.
const { hasEligibleSourceSql } = require('../../services/supplier-source-resolution');

const PROVIDER_SQL = "k.supplier_order_identity->>'provider'";

async function runAudit(executor) {
  // Pool pg (connect) ou wrapper db.js (getClient) : une connexion dédiée pour que BEGIN READ ONLY couvre toutes les requêtes.
  let client = executor;
  if (typeof executor.getClient === 'function') client = await executor.getClient();
  else if (typeof executor.connect === 'function' && typeof executor.release !== 'function') client = await executor.connect();
  try {
    await client.query('BEGIN READ ONLY');

    const { rows: publishedWithoutSource } = await client.query(`
      SELECT p.id AS product_id, p.name AS product_name, k.id AS sku_id, k.supplier_sku,
             ${PROVIDER_SQL} AS provider
        FROM product_skus k JOIN products p ON p.id = k.product_id
       WHERE k.source = 'SUPPLIER' AND k.is_active = TRUE AND k.stock > 0
         AND NOT ${hasEligibleSourceSql({ productSql: 'k.product_id', providerSql: PROVIDER_SQL })}
       ORDER BY p.name, k.id`);

    const { rows: priorityDuplicates } = await client.query(`
      SELECT product_id, priority, COUNT(*)::int AS associations,
             array_agg(id ORDER BY created_at) AS product_supplier_ids
        FROM product_suppliers
       WHERE is_active = TRUE AND deleted_at IS NULL
       GROUP BY product_id, priority HAVING COUNT(*) > 1
       ORDER BY product_id, priority`);

    const { rows: paidImportWithoutLine } = await client.query(`
      SELECT o.id AS order_id, o.reference AS order_ref, oi.id AS order_item_id, oi.product_id, oi.sku_id,
             oi.quantity,
             ${hasEligibleSourceSql({
               productSql: 'oi.product_id',
               providerSql: "(SELECT k.supplier_order_identity->>'provider' FROM product_skus k WHERE k.id = oi.sku_id)",
             })} AS eligible_source_present
        FROM orders o JOIN order_items oi ON oi.order_id = o.id AND oi.fulfillment_source = 'IMPORT'
       WHERE o.status NOT IN ('pending', 'cancelled', 'refunded', 'collected')
         AND NOT EXISTS (SELECT 1 FROM purchase_lines pl WHERE pl.order_item_id = oi.id AND pl.cancelled_at IS NULL)
       ORDER BY o.created_at, oi.id`);

    const { rows: ebayIdentities } = await client.query(`
      SELECT k.id AS sku_id, k.product_id, k.supplier_sku, k.is_active
        FROM product_skus k
       WHERE lower(${PROVIDER_SQL}) = 'ebay'
       ORDER BY k.id`);

    await client.query('ROLLBACK');
    return {
      generated_at: new Date().toISOString(),
      counts: {
        published_without_eligible_source: publishedWithoutSource.length,
        priority_duplicates: priorityDuplicates.length,
        paid_import_without_purchase_line: paidImportWithoutLine.length,
        ebay_identities: ebayIdentities.length,
      },
      published_without_eligible_source: publishedWithoutSource,
      priority_duplicates: priorityDuplicates,
      paid_import_without_purchase_line: paidImportWithoutLine,
      ebay_identities: ebayIdentities,
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    if (client !== executor && typeof client.release === 'function') client.release();
  }
}

function renderText(report) {
  const c = report.counts;
  return [
    'Audit SKU ↔ fournisseur (lecture seule)',
    `- SKU vendables sans fournisseur admissible : ${c.published_without_eligible_source}`,
    `- Doublons de priorité (associations actives) : ${c.priority_duplicates}`,
    `- order_items IMPORT payés sans purchase_line : ${c.paid_import_without_purchase_line}`,
    `- Identités eBay existantes : ${c.ebay_identities}`,
  ].join('\n');
}

async function main() {
  const { Pool } = require('pg');
  const url = process.env.DATABASE_URL;
  if (!url) { process.stderr.write('DATABASE_URL requis\n'); process.exit(2); }
  const pool = new Pool({ connectionString: url });
  try {
    const report = await runAudit(pool);
    process.stdout.write(`${process.argv.includes('--json') ? JSON.stringify(report, null, 2) : renderText(report)}\n`);
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((err) => { process.stderr.write(`${err.message}\n`); process.exit(1); });
}

module.exports = { runAudit, renderText };
