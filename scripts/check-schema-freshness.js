'use strict';

/**
 * @komerce-arch
 * @role         governance-schema-freshness
 * @domain       infrastructure
 * @layer        tooling
 * @criticality  high
 * @purpose      Verifier que le dump live couvre toutes les migrations qui
 *               appartenaient deja a sa baseline git (colonnes ADD COLUMN,
 *               ET nouveaux objets CREATE TABLE / CREATE VIEW), tout en
 *               laissant les migrations post-snapshot suivre le Mode B
 *               intended schema. Suit aussi le cycle de vie create/drop
 *               (in-scope uniquement) pour ne pas exiger dans le dump un
 *               objet cree puis re-droppe par une migration ulterieure
 *               (ex. table zombie).
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
// ALTER TABLE table ... ; — permet de suivre tous les DROP COLUMN d'une
// instruction, y compris les clauses multiples séparées par des virgules.
const ALTER_TABLE_STMT_RE = /ALTER\s+TABLE\s+(?:ONLY\s+)?(?:public\.)?(\w+)\s+([\s\S]*?);/gi;
const DROP_COL_CLAUSE_RE = /DROP\s+COLUMN\s+(?:IF\s+EXISTS\s+)?(\w+)/gi;
// CREATE TABLE [IF NOT EXISTS] [public.]name
const CREATE_TABLE_RE = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?(\w+)/gi;
// CREATE [OR REPLACE] VIEW [public.]name
const CREATE_VIEW_RE = /CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+(?:public\.)?(\w+)/gi;
// DROP TABLE [IF EXISTS] [public.]name
const DROP_TABLE_RE = /DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:public\.)?(\w+)/gi;
// DROP VIEW [IF EXISTS] [public.]name
const DROP_VIEW_RE = /DROP\s+VIEW\s+(?:IF\s+EXISTS\s+)?(?:public\.)?(\w+)/gi;
const MIGRATION_RE = /^\d{3}/;

/**
 * Retire les commentaires ligne `-- ...` avant toute extraction par regex.
 * Sans ça, un commentaire comme "-- Idempotente : CREATE TABLE IF NOT EXISTS"
 * se fait détecter comme une vraie instruction (bug constaté en pratique sur
 * 065_carriers.sql et 071_relay_dashboard_tables.sql).
 */
function stripSqlComments(sql) {
  return sql
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('--');
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join('\n');
}

function listMigrations() {
  return fs.readdirSync(MIGRATIONS_DIR)
    .filter((filename) => MIGRATION_RE.test(filename) && filename.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
}

function extractAddColumns(sql) {
  const clean = stripSqlComments(sql);
  const results = [];
  let match;
  ADD_COL_RE.lastIndex = 0;
  while ((match = ADD_COL_RE.exec(clean)) !== null) {
    results.push({ table: match[1].toLowerCase(), col: match[2].toLowerCase() });
  }
  return results;
}

/**
 * Détecte les DROP COLUMN portés par ALTER TABLE.
 *
 * Supporte notamment :
 *
 *   ALTER TABLE shared_carts
 *     DROP COLUMN IF EXISTS split_mode,
 *     DROP COLUMN IF EXISTS target_date;
 *
 * Le nom de table n'est présent qu'une fois mais chaque clause DROP COLUMN
 * constitue un événement de lifecycle distinct.
 */
function extractDroppedColumns(sql) {
  const clean = stripSqlComments(sql);
  const results = [];
  let stmt;

  ALTER_TABLE_STMT_RE.lastIndex = 0;

  while ((stmt = ALTER_TABLE_STMT_RE.exec(clean)) !== null) {
    const table = stmt[1].toLowerCase();
    const body = stmt[2];
    let match;

    DROP_COL_CLAUSE_RE.lastIndex = 0;

    while ((match = DROP_COL_CLAUSE_RE.exec(body)) !== null) {
      results.push({
        table,
        col: match[1].toLowerCase(),
      });
    }
  }

  return results;
}

/**
 * Détecte les nouveaux objets (tables, vues) créés par une migration.
 * Angle mort corrigé : jusqu'ici seules les colonnes ADD COLUMN étaient
 * vérifiées contre le dump live — une table ou vue entièrement nouvelle
 * (CREATE TABLE / CREATE VIEW) pouvait être absente du dump sans jamais
 * faire échouer le gate.
 */
function extractCreatedObjects(sql) {
  const clean = stripSqlComments(sql);
  const results = [];
  let match;

  CREATE_TABLE_RE.lastIndex = 0;
  while ((match = CREATE_TABLE_RE.exec(clean)) !== null) {
    results.push({ kind: 'table', name: match[1].toLowerCase() });
  }

  CREATE_VIEW_RE.lastIndex = 0;
  while ((match = CREATE_VIEW_RE.exec(clean)) !== null) {
    results.push({ kind: 'view', name: match[1].toLowerCase() });
  }

  return results;
}

/**
 * Détecte les objets DROP TABLE / DROP VIEW d'une migration.
 * Nécessaire pour le suivi de cycle de vie (cf. extractCreatedObjects) :
 * une table créée par une migration ancienne puis re-droppée par une
 * migration postérieure (ex. 071b crée shared_cart_commitments, 099 la
 * re-drop en "zombie") ne doit plus être exigée dans le dump live.
 */
function extractDroppedObjects(sql) {
  const clean = stripSqlComments(sql);
  const results = [];
  let match;

  DROP_TABLE_RE.lastIndex = 0;
  while ((match = DROP_TABLE_RE.exec(clean)) !== null) {
    results.push({ kind: 'table', name: match[1].toLowerCase() });
  }

  DROP_VIEW_RE.lastIndex = 0;
  while ((match = DROP_VIEW_RE.exec(clean)) !== null) {
    results.push({ kind: 'view', name: match[1].toLowerCase() });
  }

  return results;
}

/**
 * Un objet est considéré présent dans le dump live si le dump contient sa
 * propre instruction CREATE TABLE/VIEW pour ce nom — pas une simple
 * occurrence de sous-chaîne (trop faible : une FK vers `product_skus`
 * suffirait à la faire "trouver" sans que la table existe réellement).
 */
function objectExistsInSchema(normalizedSchema, { kind, name }) {
  const re = kind === 'table'
    ? new RegExp(`create\\s+table\\s+(?:if\\s+not\\s+exists\\s+)?(?:public\\.)?${name}\\b`, 'i')
    : new RegExp(`create\\s+(?:or\\s+replace\\s+)?view\\s+(?:public\\.)?${name}\\b`, 'i');
  return re.test(normalizedSchema);
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

/**
 * Construit, à partir des seules migrations DANS LE PÉRIMÈTRE du contrôle
 * (celles qui doivent déjà être reflétées dans le dump), l'état final de
 * chaque objet create/drop rencontré : 'create' si le dernier événement en
 * ordre de fichier est une création, 'drop' si c'est un drop.
 *
 * Volontairement limité aux migrations in-scope : un drop porté par une
 * migration post-snapshot (Mode B, pas encore appliquée) ne doit PAS
 * annuler l'exigence de présence d'un objet créé par une migration baseline
 * — le drop n'a pas encore eu lieu du point de vue du dump live.
 */
function buildObjectLifecycle(inScopeMigrations) {
  const lifecycle = new Map(); // key `${kind}:${name}` -> 'create' | 'drop'

  for (const migration of inScopeMigrations) {
    for (const { kind, name } of extractCreatedObjects(migration.sql)) {
      lifecycle.set(`${kind}:${name}`, 'create');
    }
    for (const { kind, name } of extractDroppedObjects(migration.sql)) {
      lifecycle.set(`${kind}:${name}`, 'drop');
    }
  }

  return lifecycle;
}

/**
 * Rejoue le lifecycle ADD COLUMN / DROP COLUMN uniquement sur les migrations
 * dans le périmètre courant (même règle que pour les tables/vues).
 */
function buildColumnLifecycle(inScopeMigrations) {
  const lifecycle = new Map(); // "table.column" -> 'add' | 'drop'

  for (const migration of inScopeMigrations) {
    for (const { table, col } of extractAddColumns(migration.sql)) {
      lifecycle.set(`${table}.${col}`, 'add');
    }

    for (const { table, col } of extractDroppedColumns(migration.sql)) {
      lifecycle.set(`${table}.${col}`, 'drop');
    }
  }

  return lifecycle;
}

function evaluateFreshness({ schema, migrations, baselineFiles, requireAll = false }) {
  const normalizedSchema = schema.toLowerCase();
  const missing = [];
  const pending = [];

  const inScopeMigrations = migrations.filter((migration) => {
    const mustExistInDump = requireAll || baselineFiles === null || baselineFiles.has(migration.fname);
    if (!mustExistInDump) {
      pending.push(migration.fname);
    }
    return mustExistInDump;
  });

  const lifecycle = buildObjectLifecycle(inScopeMigrations);
  const columnLifecycle = buildColumnLifecycle(inScopeMigrations);

  for (const migration of inScopeMigrations) {
    for (const { table, col } of extractAddColumns(migration.sql)) {
      // Une table créée historiquement mais supprimée plus tard dans le même
      // périmètre ne doit évidemment plus exposer ses anciennes colonnes.
      if (lifecycle.get(`table:${table}`) === 'drop') continue;

      // Une colonne ADD puis DROP dans le périmètre courant est correctement
      // absente du dump final.
      if (columnLifecycle.get(`${table}.${col}`) === 'drop') continue;

      if (!normalizedSchema.includes(col)) {
        missing.push({ fname: migration.fname, kind: 'column', table, col });
      }
    }

    for (const { kind, name } of extractCreatedObjects(migration.sql)) {
      // Objet créé ici mais re-droppé plus tard par une migration également
      // in-scope (table "zombie" nettoyée) : plus rien à exiger du dump.
      if (lifecycle.get(`${kind}:${name}`) === 'drop') continue;

      if (!objectExistsInSchema(normalizedSchema, { kind, name })) {
        missing.push({ fname: migration.fname, kind, name });
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
        ? '✅ Dump fraîchement extrait à jour — toutes les colonnes et tous les objets (tables/vues) de migration sont présents.'
        : '✅ Dump cohérent avec sa baseline git — aucune colonne/table/vue live attendue ne manque.'
    );
    process.exitCode = 0;
    return;
  }

  console.error(`\n❌ Dump de schéma PÉRIMÉ ou PARTIEL — ${missing.length} objet(s)/colonne(s) de baseline manquant(s) :\n`);
  for (const item of missing) {
    if (item.kind === 'column') {
      console.error(`   [${item.fname}]  colonne manquante : ${item.table}.${item.col}`);
    } else {
      console.error(`   [${item.fname}]  ${item.kind} manquante : ${item.name}`);
    }
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
  extractDroppedColumns,
  extractCreatedObjects,
  extractDroppedObjects,
  objectExistsInSchema,
  baselineFromDumpCommit,
  evaluateFreshness,
};
