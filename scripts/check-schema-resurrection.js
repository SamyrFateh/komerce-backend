'use strict';

/**
 * @komerce-arch
 * @role         governance-schema-resurrection-check
 * @domain       governance
 * @layer        tooling
 * @criticality  high
 * @purpose      Gate anti-resurrection : detecte un objet (table ou type) que
 *               les migrations numerotees ont deliberement DROPPE, mais qui
 *               est quand meme present dans le dump live. Symetrique de
 *               check-schema-freshness.js (qui ne verifie que le sens
 *               "ajoute mais absent du dump"), il couvre le sens inverse
 *               jamais couvert avant migration 099 : "supprime mais
 *               resuscite hors du runner de migrations" (cf. incident
 *               RECONCILIATION_PROD.sql, juillet 2026 — shared_cart_commitments
 *               ressuscitee par un script rejoue a la main, invisible de
 *               schema_migrations).
 * @inputs       migrations/*.sql, docs/db/railway-live-schema.sql
 * @outputs      stdout report, exit code
 * @depends      none
 * @used-by      npm run arch:gate (local + CI), .github/workflows/ci.yml (standalone step)
 * @db-read      none
 * @db-write     none
 * @db-txn       none
 * @doctrine     KOMERCE_DB_SCHEMA_DOCTRINE
 * @impact-areas governance, ci
 * @version      2026-07
 *
 * Principe :
 *   Pour chaque objet (table ou type), on rejoue sa timeline a travers les
 *   migrations numerotees dans l'ordre : chaque CREATE (ou CREATE ... IF NOT
 *   EXISTS) et chaque DROP (ou DROP ... IF EXISTS) est un evenement horode
 *   par le numero de migration qui le contient. Le dernier evenement de la
 *   timeline fait foi.
 *
 *   Si le dernier evenement est un DROP et que l'objet est neanmoins present
 *   dans le dump live -> RESURRECTION. La migration qui a droppe l'objet a
 *   reussi (sinon le dump ne contiendrait pas de trace d'un DROP applique
 *   sans etre suivi d'un CREATE posterieur), donc sa presence ne peut venir
 *   que d'un chemin hors migrations (psql manuel, script de reconciliation
 *   rejoue, etc).
 *
 * Limites assumees (heuristique, pas un parseur SQL complet) :
 *   - Ne suit pas les renommages (ALTER TABLE ... RENAME TO).
 *   - Un DROP/CREATE a l'interieur d'un bloc conditionnel (DO $$ ... IF ...)
 *     est compte comme un evenement ferme, meme si sa condition ne se
 *     declenche pas toujours en pratique (accepte : mieux vaut un faux
 *     positif occasionnel qu'un angle mort).
 *
 * Usage :
 *   node scripts/check-schema-resurrection.js        # exit 1 si resurrection
 *   node scripts/check-schema-resurrection.js --warn # exit 0 mais affiche
 *
 * Integration ci.yml :
 *   - name: Check schema resurrection (anti drift hors-migrations)
 *     run: node scripts/check-schema-resurrection.js
 */

const fs   = require('fs');
const path = require('path');
const core = require('./lib/arch-drift-core');

const WARN_ONLY = process.argv.includes('--warn');

const P = core.paths();
const MIGRATIONS_DIR = path.join(P.root, 'migrations');

const MIGRATION_FILE_RE = /^\d+[a-z]?_.*\.sql$/i;

const DROP_TABLE_RE   = /DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(?:public\.)?"?([a-zA-Z_][a-zA-Z0-9_]*)"?/gi;
const DROP_TYPE_RE    = /DROP\s+TYPE\s+(?:IF\s+EXISTS\s+)?(?:public\.)?"?([a-zA-Z_][a-zA-Z0-9_]*)"?/gi;
const CREATE_TABLE_RE = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?"?([a-zA-Z_][a-zA-Z0-9_]*)"?/gi;
const CREATE_TYPE_RE  = /CREATE\s+TYPE\s+(?:public\.)?"?([a-zA-Z_][a-zA-Z0-9_]*)"?/gi;
const ALTER_TYPE_RENAME_RE = /ALTER\s+TYPE\s+(?:public\.)?"?([a-zA-Z_][a-zA-Z0-9_]*)"?\s+RENAME\s+TO\s+"?([a-zA-Z_][a-zA-Z0-9_]*)"?/gi;

function parseMigrationNumber(filename) {
  const m = filename.match(/^(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

function listMigrations() {
  return fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => MIGRATION_FILE_RE.test(f))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
}

/**
 * Retire les commentaires SQL avant tout scan. Sans ca, un texte comme
 * "-- Rollback : DROP TABLE IF EXISTS carriers;" (documentation, jamais
 * execute) est compte comme un vrai DROP -- faux positif constate sur
 * 065_carriers.sql lors de la mise au point de ce gate.
 */
function stripSqlComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')  // blocs /* ... */
    .replace(/--[^\n]*/g, ' ');         // lignes -- ...
}

function collectFileEvents(sql, re, kind, eventType, out) {
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(sql)) !== null) {
    out.push({ index: m.index, kind, eventType, name: m[1].toLowerCase() });
  }
}

function collectTypeRenameEvents(sql, out) {
  ALTER_TYPE_RENAME_RE.lastIndex = 0;
  let m;

  while ((m = ALTER_TYPE_RENAME_RE.exec(sql)) !== null) {
    out.push({
      index: m.index,
      order: 0,
      kind: 'type',
      eventType: 'drop',
      name: m[1].toLowerCase(),
    });

    out.push({
      index: m.index,
      order: 1,
      kind: 'type',
      eventType: 'create',
      name: m[2].toLowerCase(),
    });
  }
}

/**
 * Applique les evenements d'un fichier au timeline global, dans l'ordre
 * TEXTUEL reel (m.index), pas dans l'ordre d'appel des regex -- au cas ou
 * un meme fichier contiendrait un DROP suivi d'un CREATE (recreation) ou
 * l'inverse, l'ordre d'ecriture doit trancher, pas l'ordre de scan.
 */
function applyFileEvents(fileEvents, fname, num, timeline) {
  fileEvents.sort((a, b) =>
    (a.index - b.index) || ((a.order || 0) - (b.order || 0))
  );
  for (const ev of fileEvents) {
    const key = `${ev.kind}:${ev.name}`;
    timeline.set(key, { num, fname, eventType: ev.eventType, kind: ev.kind, name: ev.name });
  }
}

function main() {
  const migrations = listMigrations();
  const timeline = new Map(); // "table:foo" -> { num, fname, eventType, kind, name }

  for (const fname of migrations) {
    const num = parseMigrationNumber(fname);
    if (num === null) continue;
    const rawSql = fs.readFileSync(path.join(MIGRATIONS_DIR, fname), 'utf8');
    const sql = stripSqlComments(rawSql);

    const fileEvents = [];
    collectFileEvents(sql, CREATE_TABLE_RE, 'table', 'create', fileEvents);
    collectFileEvents(sql, DROP_TABLE_RE,   'table', 'drop',   fileEvents);
    collectFileEvents(sql, CREATE_TYPE_RE,  'type',  'create', fileEvents);
    collectFileEvents(sql, DROP_TYPE_RE,    'type',  'drop',   fileEvents);
    collectTypeRenameEvents(sql, fileEvents);
    applyFileEvents(fileEvents, fname, num, timeline);
  }

  const dropped = [...timeline.values()].filter(e => e.eventType === 'drop');
  if (!dropped.length) {
    console.log('✅ check-schema-resurrection : aucun objet droppe par les migrations, rien a verifier.');
    process.exit(0);
  }

  const liveSql = fs.readFileSync(P.liveSql, 'utf8');
  const live = core.parseLiveSchema(liveSql);

  const resurrected = dropped.filter(e => {
    const set = e.kind === 'table' ? live.tables : live.types;
    return set.has(e.name);
  });

  if (!resurrected.length) {
    console.log(`✅ check-schema-resurrection : ${dropped.length} objet(s) droppe(s) par les migrations, aucun ressuscite dans le dump live.`);
    process.exit(0);
  }

  console.error(`\n❌ RESURRECTION detectee — ${resurrected.length} objet(s) droppe(s) par une migration mais present(s) dans le dump live :\n`);
  for (const e of resurrected) {
    console.error(`   [${e.kind}] ${e.name}  — droppe par ${e.fname}, mais toujours dans ${path.relative(P.root, P.liveSql)}`);
  }
  console.error(`
Cause probable : un script hors runner (psql manuel, ancien script de
reconciliation, etc.) a recree cet objet APRES que la migration l'a
droppe, sans passer par schema_migrations. La migration elle-meme est
correcte -- c'est un DROP hors bande qu'il faut corriger.

Action requise :
   1. Ecrire une nouvelle migration numerotee qui re-drop l'objet (garde-fou
      anti-donnees-actives si c'est une table).
   2. Identifier et archiver (migrations/_superseded/) le script qui a
      cause la resurrection, pour qu'il ne soit plus jamais rejoue.
`);

  process.exit(WARN_ONLY ? 0 : 1);
}

if (require.main === module) main();

module.exports = {
  applyFileEvents,
  collectTypeRenameEvents,
};
