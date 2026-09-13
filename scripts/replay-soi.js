#!/usr/bin/env node
/**
 * @komerce-arch
 * @role          catalog-replay-supplier-order-identity
 * @domain        catalog
 * @layer         tooling
 * @criticality   high
 * @inputs        DATABASE_URL
 * @outputs       product_skus.supplier_unit_ref + supplier_order_identity populated from normalized_source_contract
 * @depends       db.js, services/catalog-promotion.js
 * @used-by       one-shot rattrapage Lot 1-bis (484 drafts historiques promus avant migration 224)
 * @db-read       sourcing_candidates, products, product_skus
 * @db-write-via:catalog-promotion product_skus (supplier_unit_ref, supplier_order_identity)
 * @db-txn        one transaction per product (promoteCatalog est idempotent)
 * @doctrine      DOCTRINE_SUPPLIER_ORDER_IDENTITY.md — aucun backfill heuristique, replay depuis le contrat V2 autoritaire
 * @impact-areas  catalog, purchasing
 * @version       2026-09
 */
'use strict';

const db = require('../db');
const { promoteCatalog } = require('../services/catalog-promotion');

// ── Configuration ───────────────────────────────────────────────────────────

const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 2000;

function parseArgs(argv = process.argv.slice(2)) {
  let mode = 'dry-run';
  let limit = DEFAULT_LIMIT;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') mode = 'dry-run';
    else if (arg === '--execute') mode = 'execute';
    else if (arg === '--limit') limit = Number.parseInt(argv[++i], 10);
    else if (arg.startsWith('--limit=')) limit = Number.parseInt(arg.split('=', 2)[1], 10);
    else throw new Error(`Argument inconnu: ${arg}`);
  }

  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new Error(`--limit doit être un entier entre 1 et ${MAX_LIMIT}`);
  }
  return { mode, limit };
}

// ── Requêtes ────────────────────────────────────────────────────────────────

/**
 * Sélectionne les produits fournisseur dont au moins un product_skus
 * source=SUPPLIER n'a pas encore de supplier_order_identity, ET dont le
 * sourcing_candidate porte un normalized_source_contract V2.
 */
const SELECT_CANDIDATES = `
  SELECT DISTINCT
    sc.id          AS candidate_id,
    sc.product_id,
    p.product_ref,
    sc.normalized_source_contract
  FROM sourcing_candidates sc
  JOIN products p ON p.id = sc.product_id
  WHERE sc.state = 'imported_to_catalog'
    AND sc.product_id IS NOT NULL
    AND sc.normalized_source_contract IS NOT NULL
    AND sc.normalized_source_contract->>'schema_version' = '2'
    AND EXISTS (
      SELECT 1 FROM product_skus ps
       WHERE ps.product_id = sc.product_id
         AND ps.source = 'SUPPLIER'
         AND ps.supplier_order_identity IS NULL
    )
  ORDER BY p.product_ref
  LIMIT $1
`;

const COUNT_SOI_BEFORE = `
  SELECT
    COUNT(*)::int                                                        AS total,
    COUNT(*) FILTER (WHERE supplier_order_identity IS NOT NULL)::int      AS with_soi,
    COUNT(*) FILTER (WHERE supplier_order_identity IS NULL)::int          AS missing_soi
  FROM product_skus
  WHERE source = 'SUPPLIER'
`;

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const { mode, limit } = parseArgs();
  const isDryRun = mode === 'dry-run';

  console.log(`\n═══ replay-soi.js ═══`);
  console.log(`mode: ${mode}  limit: ${limit}\n`);

  // Baseline
  const { rows: [before] } = await db.query(COUNT_SOI_BEFORE);
  console.log(`Baseline SKU fournisseur : ${before.total} total, ${before.with_soi} avec SOI, ${before.missing_soi} sans SOI\n`);

  if (before.missing_soi === 0) {
    console.log('✅ Aucun SKU fournisseur sans SOI — rien à faire.');
    return;
  }

  // Sélection
  const { rows: candidates } = await db.query(SELECT_CANDIDATES, [limit]);
  console.log(`Produits éligibles au replay : ${candidates.length}\n`);

  if (candidates.length === 0) {
    console.log('Aucun produit éligible (contrats V2 sans sellable_units exploitables ?).');
    return;
  }

  let ok = 0;
  let skipped = 0;
  let errored = 0;

  for (const row of candidates) {
    const label = `${row.product_ref} (${row.product_id})`;

    // Vérifier que le contrat porte des sellable_units avec SOI
    const units = row.normalized_source_contract?.sellable_units || [];
    const unitsWithSoi = units.filter(u => u.supplier_order_identity);
    if (unitsWithSoi.length === 0) {
      console.log(`  SKIP ${label} — aucune sellable_unit avec supplier_order_identity dans le contrat V2`);
      skipped += 1;
      continue;
    }

    if (isDryRun) {
      console.log(`  DRY  ${label} — ${unitsWithSoi.length}/${units.length} unités avec SOI`);
      ok += 1;
      continue;
    }

    // Exécution : replay via promoteCatalog (idempotent)
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const result = await promoteCatalog(client, {
        productId: row.product_id,
        normalizedSourceContract: row.normalized_source_contract,
      });
      await client.query('COMMIT');
      console.log(`  OK   ${label} — replay: ${JSON.stringify(result.skus || {})}`);
      ok += 1;
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`  ERR  ${label} — ${err.message}`);
      errored += 1;
    } finally {
      client.release();
    }
  }

  console.log(`\n─── Résumé ───`);
  console.log(`ok: ${ok}  skipped: ${skipped}  errored: ${errored}  total: ${candidates.length}`);

  if (!isDryRun) {
    const { rows: [after] } = await db.query(COUNT_SOI_BEFORE);
    console.log(`\nAprès replay : ${after.total} total, ${after.with_soi} avec SOI, ${after.missing_soi} sans SOI`);
    console.log(`Delta SOI : +${after.with_soi - before.with_soi}`);
  }

  console.log('');
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error('FATAL:', err); process.exit(1); });
