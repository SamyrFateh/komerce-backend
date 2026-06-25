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
 *   2) Baseline automatique = toutes les migrations présentes dans le git-tree
 *      au commit qui a produit le dump actuel. Calculé dynamiquement via git :
 *      pas de liste à maintenir à la main.
 *   3) Appelle run-migrations.js pour appliquer les seules migrations
 *      vraiment nouvelles (ajoutées APRÈS le dernier snapshot).
 *   4) Les migrations CI_EXCLUDED sont aussi baselinées, mais leur raison
 *      d'exclusion est différente et documentée : elles ne sont pas rejouables
 *      par le runner générique (dépendance données ou CONCURRENTLY hors txn).
 *
 * Usage (ci.yml uniquement — NE PAS utiliser en prod) :
 *   node scripts/ci-migrate.js
 * ============================================================================
 */

const path = require('path');
const { execSync } = require('child_process');
const db   = require('../db');
const { run, listMigrationFiles } = require('./run-migrations');

const ROOT      = path.join(__dirname, '..');
const DUMP_FILE = path.join(ROOT, 'docs', 'db', 'railway-live-schema.sql');

/**
 * Migrations non rejouables par le runner générique — raisons documentées.
 * Ces fichiers sont aussi baselinés (jamais appliqués par run()), mais leur
 * exclusion tient à une incompatibilité structurelle, pas à leur présence
 * dans le dump.
 *
 * 064_enrich_test_products.sql :
 *   INSERT/UPDATE sur des UUID de produits codés en dur (Caftan eb75a33d-…,
 *   Sneakers 63db5b3a-…, etc.) qui n'existent qu'en prod. Plante en FK
 *   violation sur toute base fraîche (aucune donnée). Aucun test ne dépend
 *   de ces lignes — vérifié 2026-06-25.
 *
 * 069_analytical_indexes.sql :
 *   Utilise CREATE INDEX CONCURRENTLY. Son propre en-tête dit explicitement
 *   "ne doit JAMAIS être exécuté dans une transaction". run-migrations.js
 *   wrap chaque migration dans BEGIN/COMMIT → incompatible par construction.
 *   À appliquer manuellement via : psql $DATABASE_URL -f migrations/069_analytical_indexes.sql
 */
const CI_EXCLUDED = new Set([
  '064_enrich_test_products.sql',
  '069_analytical_indexes.sql',
]);

/**
 * Retourne l'ensemble des fichiers de migrations/ présents dans le commit git
 * qui a produit le dump actuel. Ce sont les migrations "déjà dans le dump" :
 * les rejouer ferait des conflits.
 *
 * Si git n'est pas disponible (edge case), retourne un Set vide → run() tente
 * tout → échoue vite sur les conflits connus → on s'en rend compte immédiatement.
 */
function baselineFromDumpCommit() {
  try {
    // Hash du dernier commit qui a touché le dump
    const dumpRel    = path.relative(ROOT, DUMP_FILE).replace(/\\/g, '/');
    const commitHash = execSync(
      `git log --format="%H" -1 -- "${dumpRel}"`,
      { cwd: ROOT, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();

    if (!commitHash) {
      console.warn('[ci-migrate] WARN: git log sur le dump n\'a retourné aucun commit — baseline vide.');
      return new Set();
    }

    // Fichiers de migrations/ dans cet arbre git
    const listing = execSync(
      `git ls-tree -r --name-only "${commitHash}" -- migrations/`,
      { cwd: ROOT, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    );

    const NUMERIC = /^\d{3}/;
    const files = listing
      .split('\n')
      .map(p => path.basename(p))
      .filter(f => NUMERIC.test(f) && f.endsWith('.sql'));

    console.log(`[ci-migrate] Baseline git : ${files.length} migration(s) au commit ${commitHash.slice(0, 8)}`);
    return new Set(files);
  } catch (e) {
    console.warn(`[ci-migrate] WARN: impossible de calculer la baseline git (${e.message}) — baseline vide.`);
    return new Set();
  }
}

async function main() {
  const client = await db.getClient();
  try {
    // 1. Table schema_migrations
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename   TEXT PRIMARY KEY,
        checksum   TEXT,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // 2. Calculer la baseline dynamiquement depuis git + CI_EXCLUDED
    const gitBaseline  = baselineFromDumpCommit();
    const fullBaseline = new Set([...gitBaseline, ...CI_EXCLUDED]);

    const all        = listMigrationFiles();
    const toBaseline = all.filter(f => fullBaseline.has(f));
    const toApply    = all.filter(f => !fullBaseline.has(f));

    let baselined = 0;
    for (const f of toBaseline) {
      const reason = CI_EXCLUDED.has(f) ? 'ci-excluded' : 'ci-dump-baseline';
      const { rowCount } = await client.query(
        `INSERT INTO schema_migrations (filename, checksum)
         VALUES ($1, $2)
         ON CONFLICT (filename) DO NOTHING`,
        [f, reason]
      );
      if (rowCount > 0) baselined++;
    }

    console.log(`[ci-migrate] Baselinées : ${baselined} (${gitBaseline.size} dump + ${CI_EXCLUDED.size} ci-excluded)`);
    if (toApply.length > 0) {
      console.log(`[ci-migrate] À appliquer : ${toApply.length} migration(s) post-snapshot`);
      for (const f of toApply) console.log(`   • ${f}`);
    } else {
      console.log('[ci-migrate] Rien à appliquer — dump à jour.');
    }
  } finally {
    client.release();
  }

  // 3. Appliquer les migrations vraiment nouvelles (post-snapshot)
  const { applied } = await run();
  console.log(`[ci-migrate] ✅ ${applied.length} migration(s) appliquée(s).`);
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('[ci-migrate] ÉCHEC :', err.message);
    process.exit(1);
  });
