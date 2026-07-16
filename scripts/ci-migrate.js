'use strict';

/**
 * KOMERCE — CI Database Setup (scripts/ci-migrate.js)
 * ============================================================================
 * Charge le schéma CI et applique les migrations en attente.
 *
 * MODÈLE (depuis juin 2026) :
 *   La source de vérité est docs/db/railway-live-schema.sql (dump Railway,
 *   rafraîchi par `npm run db:snapshot`, garanti frais par la porte CI
 *   check-schema-freshness.js). Puisque la fraîcheur est une invariante
 *   structurelle, TOUTES les migrations présentes au dernier rafraîchissement
 *   du dump sont déjà reflétées dans ce fichier — les rejouer casserait tout
 *   (conflits "already exists", énumérations manquantes…).
 *
 * Ce que fait ce script :
 *   1) Crée schema_migrations si absente.
 *   2) Baseline automatique = migrations présentes dans le git-tree au commit
 *      qui a produit le dump ET réellement représentées dans sa structure.
 *   3) Appelle run-migrations.js pour appliquer les migrations nouvelles ou
 *      partiellement absentes du snapshot.
 *   4) Les migrations CI_EXCLUDED sont aussi baselinées, mais leur raison
 *      d'exclusion est différente et documentée.
 *
 * Usage (ci.yml uniquement — NE PAS utiliser en prod) :
 *   node scripts/ci-migrate.js
 * ============================================================================
 */

const path = require('path');
const { execSync } = require('child_process');
const db = require('../db');
const { run, listMigrationFiles } = require('./run-migrations');

const ROOT = path.join(__dirname, '..');
const DUMP_FILE = path.join(ROOT, 'docs', 'db', 'railway-live-schema.sql');

const CI_EXCLUDED = new Set([
  '064_enrich_test_products.sql',
  '069_analytical_indexes.sql',
]);

/**
 * Migrations dont la présence dans l'arbre git ne suffit pas : on vérifie une
 * sentinelle structurelle avant de les considérer représentées dans le dump.
 * Cela protège la CI contre un snapshot partiel (tables ajoutées mais ALTER
 * TABLE oubliés, par exemple).
 */
const STRUCTURAL_PROBES = Object.freeze({
  '110_catalog_import_audit.sql': async (client) => {
    const { rows: [row] } = await client.query(`
      SELECT
        EXISTS (
          SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'public'
             AND table_name = 'supplier_catalog_imports'
             AND column_name = 'profile_id'
        )
        AND EXISTS (
          SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'public'
             AND table_name = 'supplier_catalog_imports'
             AND column_name = 'batch_findings'
        )
        AND EXISTS (
          SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'public'
             AND table_name = 'sourcing_candidates'
             AND column_name = 'promotion_status'
        )
        AND to_regclass('public.supplier_catalog_import_rejections') IS NOT NULL
        AND to_regclass('public.sourcing_candidate_observations') IS NOT NULL
        AS represented
    `);
    return row?.represented === true;
  },
});

function baselineFromDumpCommit() {
  try {
    const dumpRel = path.relative(ROOT, DUMP_FILE).replace(/\\/g, '/');
    const commitHash = execSync(
      `git log --format="%H" -1 -- "${dumpRel}"`,
      { cwd: ROOT, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();

    if (!commitHash) {
      console.warn('[ci-migrate] WARN: git log sur le dump n\'a retourné aucun commit — baseline vide.');
      return new Set();
    }

    const listing = execSync(
      `git ls-tree -r --name-only "${commitHash}" -- migrations/`,
      { cwd: ROOT, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    );

    const NUMERIC = /^\d{3}/;
    const files = listing
      .split('\n')
      .map((p) => path.basename(p))
      .filter((f) => NUMERIC.test(f) && f.endsWith('.sql'));

    console.log(`[ci-migrate] Baseline git : ${files.length} migration(s) au commit ${commitHash.slice(0, 8)}`);
    return new Set(files);
  } catch (error) {
    console.warn(`[ci-migrate] WARN: impossible de calculer la baseline git (${error.message}) — baseline vide.`);
    return new Set();
  }
}

async function reconcileStructuralBaseline(client, baseline) {
  const reconciled = new Set(baseline);

  for (const [filename, probe] of Object.entries(STRUCTURAL_PROBES)) {
    if (!reconciled.has(filename)) continue;
    const represented = await probe(client);
    if (!represented) {
      reconciled.delete(filename);
      console.warn(
        `[ci-migrate] Snapshot incomplet pour ${filename} — migration retirée de la baseline et appliquée réellement.`
      );
    }
  }

  return reconciled;
}

async function main() {
  const client = await db.getClient();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename   TEXT PRIMARY KEY,
        checksum   TEXT,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const gitBaseline = await reconcileStructuralBaseline(client, baselineFromDumpCommit());
    const fullBaseline = new Set([...gitBaseline, ...CI_EXCLUDED]);

    const all = listMigrationFiles();
    const toBaseline = all.filter((f) => fullBaseline.has(f));
    const toApply = all.filter((f) => !fullBaseline.has(f));

    let baselined = 0;
    for (const filename of toBaseline) {
      const reason = CI_EXCLUDED.has(filename) ? 'ci-excluded' : 'ci-dump-baseline';
      const { rowCount } = await client.query(
        `INSERT INTO schema_migrations (filename, checksum)
         VALUES ($1, $2)
         ON CONFLICT (filename) DO NOTHING`,
        [filename, reason]
      );
      if (rowCount > 0) baselined++;
    }

    console.log(`[ci-migrate] Baselinées : ${baselined} (${gitBaseline.size} dump + ${CI_EXCLUDED.size} ci-excluded)`);
    if (toApply.length > 0) {
      console.log(`[ci-migrate] À appliquer : ${toApply.length} migration(s) post-snapshot/incomplète(s)`);
      for (const filename of toApply) console.log(`   • ${filename}`);
    } else {
      console.log('[ci-migrate] Rien à appliquer — dump structurellement à jour.');
    }
  } finally {
    client.release();
  }

  const { applied } = await run();
  console.log(`[ci-migrate] ✅ ${applied.length} migration(s) appliquée(s).`);
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('[ci-migrate] ÉCHEC :', error.message);
      process.exit(1);
    });
}

module.exports = {
  CI_EXCLUDED,
  STRUCTURAL_PROBES,
  baselineFromDumpCommit,
  reconcileStructuralBaseline,
  main,
};
