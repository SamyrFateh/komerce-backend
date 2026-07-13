'use strict';

/**
 * @komerce-arch
 * @role         governance-schema-freshness
 * @domain       infrastructure
 * @layer        tooling
 * @criticality  high
 * @purpose      Verifier que le dump live couvre toutes les migrations qui
 *               appartenaient deja a sa baseline git, tout en laissant les
 *               migrations post-snapshot suivre le Mode B intended schema.
 * @inputs       migrations/*.sql, docs/db/railway-live-schema.sql, git history
 * @outputs      freshness_report, exit_code
 * @depends      git
 * @used-by      ci.yml, schema-refresh.yml, package.json
 * @db-read      none
 * @db-write     none
 * @db-txn       none
 * @doctrine     KOMERCE_DB_SCHEMA_DOCTRINE
 * @impact-areas governance, ci, database-schema
 * @version      2026-07
 */

/**
 * KOMERCE — Check fraîcheur du dump de schéma live
 * =================================================
 *
 * Deux modes cohérents avec KOMERCE_DB_SCHEMA_DOCTRINE :
 *
 *   défaut / CI PR
 *     - le dernier commit qui a touché le dump définit sa baseline git ;
 *     - toute migration déjà présente à cette baseline DOIT être reflétée dans
 *       le dump ;
 *     - les migrations ajoutées après ce snapshot sont du Mode B
 *       `intended_migration_schema` et seront appliquées par ci-migrate.js sur
 *       la base éphémère. Elles ne peuvent pas être exigées du dump live avant
 *       leur déploiement.
 *
 *   --all / juste après db-snapshot.js
 *     - toutes les migrations courantes DOIVENT être reflétées dans le dump
 *       fraîchement extrait ;
 *     - protège schema-refresh.yml contre un dump partiel ou une mauvaise DB.
 *
 * Si git est indisponible ou si la baseline du dump est introuvable, le mode
 * par défaut retombe en contrôle `--all` : fail-safe, jamais de skip silencieux.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const MIGRATIONS_DIR = path.join(ROOT, 'migrations');
const SCHEMA_FILE = path.join(ROOT, 'docs', 'db', 'railway-live-schema.sql');
const WARN_ONLY = process.argv.includes('--warn');
const REQUIRE_ALL = process.argv.includes('--all');

// ALTER TABLE [ONLY] [public.]table ADD COLUMN [IF NOT EXISTS] colname
const ADD_COL_RE = /ALTER\s+TABLE\s+(?:ONLY\s+)?(?:public\.)?(\w+)\s+ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/gi;
const MIGRATION_RE = /^\d{3}/;

function listMigrations() {
  return fs.readdirSync(MIGRATIONS_DIR)
    .filter((filename) => MIGRATION_RE.test(filename) && filename.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
}

function extractAddColumns(sql) {
  const results = [];
  let match;
  ADD_COL_RE.lastIndex = 0;
  while ((match = ADD_COL_RE.exec(sql)) !== null) {
    results.push({ table: match[1].toLowerCase(), col: match[2].toLowerCase() });
  }
  return results;
}

/**
 * Même définition de baseline que ci-migrate.js : le dernier commit qui a
 * touché le dump fixe les migrations déjà supposées contenues dans ce dump.
 */
function baselineFromDumpCommit() {
  try {
    const dumpRel = path.relative(ROOT, SCHEMA_FILE).replace(/\\/g, '/');
    const commitHash = execSync(
      `git log --format="%H" -1 -- "${dumpRel}"`,
      { cwd: ROOT, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();

    if (!commitHash) {
      return { files: null, commitHash: null, error: 'aucun commit trouvé pour le dump' };
    }

    const listing = execSync(
      `git ls-tree -r --name-only "${commitHash}" -- migrations/`,
      { cwd: ROOT, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
    const files = listing
      .split('\n')
      .map((entry) => path.basename(entry))
      .filter((filename) => MIGRATION_RE.test(filename) && filename.endsWith('.sql'));

    return { files: new Set(files), commitHash, error: null };
  } catch (error) {
    return { files: null, commitHash: null, error: error.message };
  }
}

function evaluateFreshness({ schema, migrations, baselineFiles, requireAll = false }) {
  const normalizedSchema = schema.toLowerCase();
  const missing = [];
  const pending = [];

  for (const migration of migrations) {
    const mustExistInDump = requireAll || baselineFiles === null || baselineFiles.has(migration.fname);
    if (!mustExistInDump) {
      pending.push(migration.fname);
      continue;
    }

    for (const { table, col } of extractAddColumns(migration.sql)) {
      if (!normalizedSchema.includes(col)) {
        missing.push({ fname: migration.fname, table, col });
      }
    }
  }

  return {
    missing,
    pending: [...new Set(pending)],
  };
}

function main() {
  const schema = fs.readFileSync(SCHEMA_FILE, 'utf8');
  const migrationFiles = listMigrations();
  const migrations = migrationFiles.map((fname) => ({
    fname,
    sql: fs.readFileSync(path.join(MIGRATIONS_DIR, fname), 'utf8'),
  }));

  const baseline = baselineFromDumpCommit();
  if (REQUIRE_ALL) {
    console.log('ℹ️  schema freshness : mode --all, dump fraîchement extrait attendu.');
  } else if (baseline.files) {
    console.log(
      `[schema-freshness] Baseline dump : ${baseline.files.size} migration(s) au commit ${baseline.commitHash.slice(0, 8)}`
    );
  } else {
    console.warn(
      `[schema-freshness] WARN baseline git indisponible (${baseline.error}) — contrôle fail-safe de toutes les migrations.`
    );
  }

  const { missing, pending } = evaluateFreshness({
    schema,
    migrations,
    baselineFiles: baseline.files,
    requireAll: REQUIRE_ALL,
  });

  if (pending.length > 0) {
    console.log(`\nℹ️  ${pending.length} migration(s) post-snapshot en Mode B intended_migration_schema :`);
    for (const fname of pending) console.log(`   • ${fname}`);
    console.log('   Elles seront appliquées par ci-migrate.js sur la DB CI et vérifiées live après déploiement.');
  }

  if (missing.length === 0) {
    console.log(
      REQUIRE_ALL
        ? '✅ Dump fraîchement extrait à jour — toutes les colonnes de migration sont présentes.'
        : '✅ Dump cohérent avec sa baseline git — aucune colonne live attendue ne manque.'
    );
    process.exitCode = 0;
    return;
  }

  console.error(`\n❌ Dump de schéma PÉRIMÉ ou PARTIEL — ${missing.length} colonne(s) de baseline manquante(s) :\n`);
  for (const { fname, table, col } of missing) {
    console.error(`   [${fname}]  ${table}.${col}`);
  }
  console.error(`
Action requise :
   npm run db:snapshot
   node scripts/check-schema-freshness.js --all
   git add docs/db/railway-live-schema.sql && git commit -m "chore(schema): refresh depuis Railway prod" && git push
`);

  process.exitCode = WARN_ONLY ? 0 : 1;
}

if (require.main === module) main();

module.exports = {
  extractAddColumns,
  baselineFromDumpCommit,
  evaluateFreshness,
};
