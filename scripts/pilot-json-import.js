#!/usr/bin/env node
/**
 * KOMERCE — Import PILOTE réel, 5 produits, source JSON (ING-6)
 * ============================================================
 *
 * Écrit réellement en base (supplier_catalog_imports, sourcing_candidates,
 * supplier_catalog_import_rejections) via importCatalog({ source_type: 'json' }).
 * Ne contacte PAS Cloudinary. Conserve les URLs externes telles quelles.
 * Ne promeut RIEN — aucun appel à import-product / promoteCatalog ici.
 *
 * Usage :
 *   DATABASE_URL=postgres://... node scripts/pilot-json-import.js
 *
 * Options :
 *   --input   <f.json>   défaut: data/catalogue-test-raw/komerce_catalogue_brut_tests/komerce-catalogue-brut-sample.json
 *   --profile <f.json>   défaut: config/import-profiles/komerce-test-dummyjson.v1.json
 *   --count   <n>         défaut: 5
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function parseArgs(argv) {
  const args = { input: null, profile: null, count: 5 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--input') args.input = argv[++i];
    else if (argv[i] === '--profile') args.profile = argv[++i];
    else if (argv[i] === '--count') args.count = parseInt(argv[++i], 10);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const inputPath = path.resolve(args.input || 'data/catalogue-test-raw/komerce_catalogue_brut_tests/komerce-catalogue-brut-sample.json');
  const profilePath = path.resolve(args.profile || 'config/import-profiles/komerce-test-dummyjson.v1.json');
  const count = args.count || 5;

  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL requis — ce script écrit réellement en base.');
    process.exit(1);
  }

  const profile = JSON.parse(fs.readFileSync(profilePath, 'utf-8'));
  const fullSource = JSON.parse(fs.readFileSync(inputPath, 'utf-8'));

  // Lot PILOTE : les N premiers produits seulement, jamais les 82.
  const pilotProducts = (fullSource.products || []).slice(0, count);
  const source = { products: pilotProducts };
  const sourceBuf = Buffer.from(JSON.stringify(source), 'utf-8');
  const sourceSha256 = crypto.createHash('sha256').update(sourceBuf).digest('hex');

  const { importCatalog } = require('../services/suppliers/catalog-import-orchestrator');

  const result = await importCatalog(
    {
      supplier_name: profile.supplier_name,
      source_type: 'json',
      source_filename: path.basename(inputPath) + ` (pilote ${count}/${(fullSource.products || []).length})`,
      notes: `Lot pilote ING-6 — ${count} produits réels, aucune promotion, pas de Cloudinary.`,
      import_profile: profile,
      source,
      source_bytes: sourceBuf.length,
      source_sha256: sourceSha256,
    },
    null,
    async () => { throw new Error('dispatchToConnector ne doit pas être appelé pour source_type=json'); }
  );

  console.log('=== IMPORT PILOTE (RÉEL — écrit en base) ===');
  console.log(JSON.stringify(result.body, null, 2));

  if (result.status !== 200) {
    process.exitCode = 1;
  }

  const db = require('../db');
  await db.pool.end();
}

main()
  .catch((err) => {
    console.error('Échec import pilote :', err);
    process.exitCode = 1;
  })
  .finally(() => {
    process.exit(process.exitCode || 0);
  });
