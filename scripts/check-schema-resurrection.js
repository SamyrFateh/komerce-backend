'use strict';

/**
 * @komerce-arch
 * @role         governance-schema-resurrection-check
 * @domain       governance
 * @layer        tooling
 * @criticality  high
 * @purpose      Gate anti-resurrection : detecte un objet (table ou type) que
 *               les migrations numerotees ont deliberement DROPPE, mais qui
 *               est quand meme present dans le dump live. Suit aussi les
 *               remplacements atomiques de types via ALTER TYPE ... RENAME TO.
 * @inputs       migrations/*.sql, docs/db/railway-live-schema.sql
 * @outputs      stdout report, exit code
 * @depends      none
 * @used-by      npm run arch:gate (local + CI), .github/workflows/ci.yml (standalone step)
 * @db-read      none
 * @db-write     none
 * @db-txn       none
 * @doctrine     KOMERCE_DB_SCHEMA_DOCTRINE
 * @impact-areas governance, ci
 * @version      2026-08
 *
 * Principe :
 *   Pour chaque objet (table ou type), on rejoue sa timeline a travers les
 *   migrations numerotees dans l'ordre textuel. Le dernier evenement fait foi.
 *
 *   Un remplacement d'ENUM utilise couramment :
 *     CREATE TYPE foo_new ...;
 *     DROP TYPE foo;
 *     ALTER TYPE foo_new RENAME TO foo;
 *   Le renommage final est un evenement de creation du nom canonique `foo`,
 *   pas une resurrection hors migrations.
 */

const fs = require('fs');
const path = require('path');
const core = require('./lib/arch-drift-core');

const WARN_ONLY = process.argv.includes('--warn');

const P = core.paths();
const MIGRATIONS_DIR = path.join(P.root, 'migrations');

const MIGRATION_FILE_RE = /^\d+[a-z]?_.*\.sql$/i;

const DROP_TABLE_RE = /DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(?:public\.)?"?([a-zA-Z_][a-zA-Z0-9_]*)"?/gi;
const DROP_TYPE_RE = /DROP\s+TYPE\s+(?:IF\s+EXISTS\s+)?(?:public\.)?"?([a-zA-Z_][a-zA-Z0-9_]*)"?/gi;
const CREATE_TABLE_RE = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?"?([a-zA-Z_][a-zA-Z0-9_]*)"?/gi;
const CREATE_TYPE_RE = /CREATE\s+TYPE\s+(?:public\.)?"?([a-zA-Z_][a-zA-Z0-9_]*)"?/gi;
const RENAME_TYPE_RE = /ALTER\s+TYPE\s+(?:public\.)?"?([a-zA-Z_][a-zA-Z0-9_]*)"?\s+RENAME\s+TO\s+"?([a-zA-Z_][a-zA-Z0-9_]*)"?/gi;

function parseMigrationNumber(filename) {
  const match = filename.match(/^(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

function listMigrations() {
  return fs.readdirSync(MIGRATIONS_DIR)
    .filter((filename) => MIGRATION_FILE_RE.test(filename))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
}

function stripSqlComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ');
}

function collectFileEvents(sql, regex, kind, eventType, out) {
  regex.lastIndex = 0;
  let match;
  while ((match = regex.exec(sql)) !== null) {
    out.push({
      index: match.index,
      kind,
      eventType,
      name: match[1].toLowerCase(),
    });
  }
}

function collectRenameTypeEvents(sql, out) {
  RENAME_TYPE_RE.lastIndex = 0;
  let match;
  while ((match = RENAME_TYPE_RE.exec(sql)) !== null) {
    out.push({
      index: match.index,
      kind: 'type',
      eventType: 'rename',
      fromName: match[1].toLowerCase(),
      name: match[2].toLowerCase(),
    });
  }
}

function applyFileEvents(fileEvents, fname, num, timeline) {
  fileEvents.sort((a, b) => a.index - b.index);

  for (const event of fileEvents) {
    if (event.eventType === 'rename') {
      const sourceKey = `${event.kind}:${event.fromName}`;
      const targetKey = `${event.kind}:${event.name}`;
      timeline.delete(sourceKey);
      timeline.set(targetKey, {
        num,
        fname,
        eventType: 'create',
        kind: event.kind,
        name: event.name,
        renamedFrom: event.fromName,
      });
      continue;
    }

    const key = `${event.kind}:${event.name}`;
    timeline.set(key, {
      num,
      fname,
      eventType: event.eventType,
      kind: event.kind,
      name: event.name,
    });
  }
}

function buildTimeline(migrationFiles = listMigrations()) {
  const timeline = new Map();

  for (const fname of migrationFiles) {
    const num = parseMigrationNumber(fname);
    if (num === null) continue;

    const rawSql = fs.readFileSync(path.join(MIGRATIONS_DIR, fname), 'utf8');
    const sql = stripSqlComments(rawSql);
    const fileEvents = [];

    collectFileEvents(sql, CREATE_TABLE_RE, 'table', 'create', fileEvents);
    collectFileEvents(sql, DROP_TABLE_RE, 'table', 'drop', fileEvents);
    collectFileEvents(sql, CREATE_TYPE_RE, 'type', 'create', fileEvents);
    collectFileEvents(sql, DROP_TYPE_RE, 'type', 'drop', fileEvents);
    collectRenameTypeEvents(sql, fileEvents);
    applyFileEvents(fileEvents, fname, num, timeline);
  }

  return timeline;
}

function main() {
  const timeline = buildTimeline();
  const dropped = [...timeline.values()].filter((event) => event.eventType === 'drop');

  if (!dropped.length) {
    console.log('✅ check-schema-resurrection : aucun objet droppe par les migrations, rien a verifier.');
    process.exit(0);
  }

  const liveSql = fs.readFileSync(P.liveSql, 'utf8');
  const live = core.parseLiveSchema(liveSql);

  const resurrected = dropped.filter((event) => {
    const set = event.kind === 'table' ? live.tables : live.types;
    return set.has(event.name);
  });

  if (!resurrected.length) {
    console.log(`✅ check-schema-resurrection : ${dropped.length} objet(s) droppe(s) par les migrations, aucun ressuscite dans le dump live.`);
    process.exit(0);
  }

  console.error(`\n❌ RESURRECTION detectee — ${resurrected.length} objet(s) droppe(s) par une migration mais present(s) dans le dump live :\n`);
  for (const event of resurrected) {
    console.error(`   [${event.kind}] ${event.name}  — droppe par ${event.fname}, mais toujours dans ${path.relative(P.root, P.liveSql)}`);
  }
  console.error(`
Cause probable : un script hors runner (psql manuel, ancien script de
reconciliation, etc.) a recree cet objet APRES que la migration l'a
droppe, sans passer par schema_migrations.

Action requise :
   1. Ecrire une nouvelle migration numerotee qui re-drop l'objet.
   2. Identifier et archiver le script hors runner responsable.
`);

  process.exit(WARN_ONLY ? 0 : 1);
}

if (require.main === module) main();

module.exports = {
  stripSqlComments,
  collectFileEvents,
  collectRenameTypeEvents,
  applyFileEvents,
  buildTimeline,
};
