'use strict';

/**
 * @komerce-arch
 * @role         governance-schema-intent-doc
 * @domain       infrastructure
 * @layer        tooling
 * @criticality  high
 * @purpose      Refuser avant merge une migration qui change le schéma sans
 *               intention documentée dans docs/SCHEMA.md. Les objets nouveaux
 *               non encore live doivent passer par un bloc schema-pending ;
 *               les colonnes ajoutées doivent être nommées dans la ligne/notice
 *               de leur table. Le live Railway reste contrôlé post-merge.
 * @inputs       git diff PR, migrations/*.sql, docs/SCHEMA.md, dump live
 * @outputs      exit_code
 * @depends      git
 * @used-by      .github/workflows/pr-enforcement.yml
 * @db-read      none
 * @db-write     none
 * @db-txn       none
 * @doctrine     KOMERCE_DB_SCHEMA_DOCTRINE
 * @impact-areas governance, ci, database-schema
 * @version      2026-09
 */

const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const ROOT = path.join(__dirname, '..');
const SCHEMA_MD = path.join(ROOT, 'docs', 'SCHEMA.md');
const LIVE_DUMP = path.join(ROOT, 'docs', 'db', 'railway-live-schema.sql');

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : null;
}

function stripSqlComments(sql) {
  return String(sql || '')
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('--');
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join('\n');
}

function extractCreatedObjects(sql) {
  const clean = stripSqlComments(sql);
  const out = [];
  let match;
  const tableRe = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?(\w+)/gi;
  const viewRe = /CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+(?:public\.)?(\w+)/gi;
  while ((match = tableRe.exec(clean)) !== null) out.push({ kind: 'table', name: match[1].toLowerCase() });
  while ((match = viewRe.exec(clean)) !== null) out.push({ kind: 'view', name: match[1].toLowerCase() });
  return out;
}

function extractAddedColumns(sql) {
  const clean = stripSqlComments(sql);
  const out = [];
  let match;
  const re = /ALTER\s+TABLE\s+(?:ONLY\s+)?(?:public\.)?(\w+)\s+ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/gi;
  while ((match = re.exec(clean)) !== null) {
    out.push({ table: match[1].toLowerCase(), column: match[2].toLowerCase() });
  }
  return out;
}

function changedMigrationFiles(base, head) {
  if (!base || !head) throw new Error('--base et --head sont obligatoires');
  const raw = cp.execFileSync(
    'git',
    ['diff', '--name-only', '--diff-filter=AMCR', base, head, '--', 'migrations/*.sql'],
    { cwd: ROOT, encoding: 'utf8' }
  );
  return raw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}

function pendingBlocks(schemaMd) {
  const blocks = [];
  const re = /<!--\s*schema-pending[\s\S]*?-->/gi;
  let match;
  while ((match = re.exec(schemaMd)) !== null) blocks.push(match[0].toLowerCase());
  return blocks;
}

function liveObjectExists(liveDump, { kind, name }) {
  const re = kind === 'table'
    ? new RegExp(`create\\s+table\\s+(?:if\\s+not\\s+exists\\s+)?(?:public\\.)?"?${name}"?\\b`, 'i')
    : new RegExp(`create\\s+(?:or\\s+replace\\s+)?view\\s+(?:public\\.)?"?${name}"?\\b`, 'i');
  return re.test(liveDump);
}

function schemaHasDocumentedObject(schemaMd, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^\\|\\s*\\\`${escaped}\\\`\\s*\\|`, 'mi').test(schemaMd);
}

function schemaHasColumnIntent(schemaMd, { table, column }) {
  const lines = schemaMd.split(/\r?\n/);
  const tableToken = `\`${table}\``;
  const columnToken = `\`${column}\``;
  return lines.some((line) => line.includes(tableToken) && line.includes(columnToken))
    || schemaMd.includes(`${table}.${column}`)
    || schemaMd.includes(columnToken);
}

function main() {
  const base = argValue('--base');
  const head = argValue('--head');
  const files = changedMigrationFiles(base, head);
  if (files.length === 0) {
    console.log('✅ Schema intent doc: aucune migration SQL changée.');
    return;
  }

  const schemaMd = fs.readFileSync(SCHEMA_MD, 'utf8');
  const liveDump = fs.existsSync(LIVE_DUMP) ? fs.readFileSync(LIVE_DUMP, 'utf8') : '';
  const pending = pendingBlocks(schemaMd);
  const failures = [];

  for (const rel of files) {
    const sql = fs.readFileSync(path.join(ROOT, rel), 'utf8');

    for (const object of extractCreatedObjects(sql)) {
      const live = liveObjectExists(liveDump, object);
      const documentedLive = schemaHasDocumentedObject(schemaMd, object.name);
      const documentedPending = pending.some((block) => block.includes(object.name));

      if (live) {
        if (!documentedLive) {
          failures.push(`${rel}: ${object.kind} live ${object.name} absente de docs/SCHEMA.md`);
        }
      } else if (!documentedPending) {
        failures.push(
          `${rel}: ${object.kind} nouvelle ${object.name} non live sans bloc <!-- schema-pending --> dans docs/SCHEMA.md`
        );
      }
    }

    for (const column of extractAddedColumns(sql)) {
      if (!schemaHasColumnIntent(schemaMd, column)) {
        failures.push(
          `${rel}: colonne ${column.table}.${column.column} sans intention documentée dans docs/SCHEMA.md`
        );
      }
    }
  }

  if (failures.length > 0) {
    console.error('❌ Schema intent documentation incomplète avant merge :');
    for (const failure of failures) console.error(`   - ${failure}`);
    console.error('\nCorriger docs/SCHEMA.md avant merge. Le contrôle Railway live restera post-merge.');
    process.exitCode = 1;
    return;
  }

  console.log(`✅ Schema intent doc: ${files.length} migration(s) changée(s), intention documentée.`);
}

if (require.main === module) main();

module.exports = {
  extractCreatedObjects,
  extractAddedColumns,
  pendingBlocks,
  liveObjectExists,
  schemaHasDocumentedObject,
  schemaHasColumnIntent,
};
