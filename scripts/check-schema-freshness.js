'use strict';

/**
 * @komerce-arch
 * @role         governance-schema-freshness
 * @domain       infrastructure
 * @layer        tooling
 * @criticality  high
 * @purpose      Verifier que le dump live couvre l'état FINAL des migrations
 *               appartenant à sa baseline : créations, suppressions et cycle
 *               de vie des colonnes, tables et vues.
 * @inputs       migrations/*.sql, docs/db/railway-live-schema.sql, git history
 * @outputs      freshness_report, exit_code
 * @depends      git
 * @used-by      ci.yml, schema-refresh.yml, package.json
 * @db-read      none
 * @db-write     none
 * @db-txn       none
 * @doctrine     KOMERCE_DB_SCHEMA_DOCTRINE
 * @impact-areas governance, ci, database-schema
 * @version      2026-08
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const MIGRATIONS_DIR = path.join(ROOT, 'migrations');
const SCHEMA_FILE = path.join(ROOT, 'docs', 'db', 'railway-live-schema.sql');
const WARN_ONLY = process.argv.includes('--warn');
const REQUIRE_ALL = process.argv.includes('--all');
const MIGRATION_RE = /^\d{3}/;

const CREATE_TABLE_RE = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?(\w+)/gi;
const CREATE_VIEW_RE = /CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+(?:public\.)?(\w+)/gi;
const DROP_TABLE_RE = /DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:public\.)?(\w+)/gi;
const DROP_VIEW_RE = /DROP\s+VIEW\s+(?:IF\s+EXISTS\s+)?(?:public\.)?(\w+)/gi;
const ALTER_TABLE_STATEMENT_RE = /ALTER\s+TABLE\s+(?:ONLY\s+)?(?:public\.)?(\w+)([\s\S]*?);/gi;
const ADD_COLUMN_CLAUSE_RE = /\bADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/gi;
const DROP_COLUMN_CLAUSE_RE = /\bDROP\s+COLUMN\s+(?:IF\s+EXISTS\s+)?(\w+)/gi;

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

function extractColumnClauses(sql, clauseRegex) {
  const clean = stripSqlComments(sql);
  const results = [];
  let statement;

  ALTER_TABLE_STATEMENT_RE.lastIndex = 0;
  while ((statement = ALTER_TABLE_STATEMENT_RE.exec(clean)) !== null) {
    const table = statement[1].toLowerCase();
    const body = statement[2];
    let clause;
    clauseRegex.lastIndex = 0;
    while ((clause = clauseRegex.exec(body)) !== null) {
      results.push({ table, col: clause[1].toLowerCase() });
    }
  }

  return results;
}

function extractAddColumns(sql) {
  return extractColumnClauses(sql, ADD_COLUMN_CLAUSE_RE);
}

function extractDroppedColumns(sql) {
  return extractColumnClauses(sql, DROP_COLUMN_CLAUSE_RE);
}

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

function objectExistsInSchema(normalizedSchema, { kind, name }) {
  const re = kind === 'table'
    ? new RegExp(`create\\s+table\\s+(?:if\\s+not\\s+exists\\s+)?(?:public\\.)?${name}\\b`, 'i')
    : new RegExp(`create\\s+(?:or\\s+replace\\s+)?view\\s+(?:public\\.)?${name}\\b`, 'i');
  return re.test(normalizedSchema);
}

function columnExistsInSchema(normalizedSchema, table, col) {
  const tableRe = new RegExp(
    `create\\s+table\\s+(?:if\\s+not\\s+exists\\s+)?(?:public\\.)?${table}\\s*\\(([\\s\\S]*?)\\n\\);`,
    'i'
  );
  const tableMatch = tableRe.exec(normalizedSchema);
  if (!tableMatch) return false;
  return new RegExp(`(?:^|[,\\n])\\s*${col}\\s+`, 'i').test(tableMatch[1]);
}

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

function buildLifecycle(inScopeMigrations) {
  const objects = new Map();
  const columns = new Map();

  for (const migration of inScopeMigrations) {
    for (const { kind, name } of extractCreatedObjects(migration.sql)) {
      objects.set(`${kind}:${name}`, 'create');
    }
    for (const { kind, name } of extractDroppedObjects(migration.sql)) {
      objects.set(`${kind}:${name}`, 'drop');
    }
    for (const { table, col } of extractAddColumns(migration.sql)) {
      columns.set(`${table}:${col}`, 'create');
    }
    for (const { table, col } of extractDroppedColumns(migration.sql)) {
      columns.set(`${table}:${col}`, 'drop');
    }
  }

  return { objects, columns };
}

function evaluateFreshness({ schema, migrations, baselineFiles, requireAll = false }) {
  const normalizedSchema = schema.toLowerCase();
  const missing = [];
  const pending = [];

  const inScopeMigrations = migrations.filter((migration) => {
    const mustExistInDump = requireAll || baselineFiles === null || baselineFiles.has(migration.fname);
    if (!mustExistInDump) pending.push(migration.fname);
    return mustExistInDump;
  });

  const lifecycle = buildLifecycle(inScopeMigrations);

  for (const migration of inScopeMigrations) {
    for (const { table, col } of extractAddColumns(migration.sql)) {
      if (lifecycle.objects.get(`table:${table}`) === 'drop') continue;
      if (lifecycle.columns.get(`${table}:${col}`) === 'drop') continue;
      if (!columnExistsInSchema(normalizedSchema, table, col)) {
        missing.push({ fname: migration.fname, kind: 'column', table, col });
      }
    }

    for (const { kind, name } of extractCreatedObjects(migration.sql)) {
      if (lifecycle.objects.get(`${kind}:${name}`) === 'drop') continue;
      if (!objectExistsInSchema(normalizedSchema, { kind, name })) {
        missing.push({ fname: migration.fname, kind, name });
      }
    }
  }

  return { missing, pending: [...new Set(pending)] };
}

function main() {
  const schema = fs.readFileSync(SCHEMA_FILE, 'utf8');
  const migrations = listMigrations().map((fname) => ({
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
        ? '✅ Dump fraîchement extrait à jour — état final des colonnes, tables et vues conforme aux migrations.'
        : '✅ Dump cohérent avec sa baseline git — état final des colonnes, tables et vues conforme.'
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
  columnExistsInSchema,
  baselineFromDumpCommit,
  evaluateFreshness,
};
