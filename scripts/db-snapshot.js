'use strict';

/**
 * @komerce-arch
 * @role         governance-db-snapshot
 * @domain       governance
 * @layer        tooling
 * @criticality  high
 * @purpose      Rafraichit le dump de schema live (docs/db/railway-live-schema.sql) depuis
 *               DATABASE_URL via pg_dump --schema-only. Ferme la boucle : DB reelle ->
 *               dump -> reconcile -> portes. C'est la seule etape qui lit la vraie base.
 * @inputs       process.env.DATABASE_URL, binaire pg_dump
 * @outputs      docs/db/railway-live-schema.sql (ecrit atomiquement), stdout diff, exit code
 * @depends      scripts/lib/arch-drift-core.js
 * @used-by      package.json (db:snapshot, db:sync)
 * @db-read      none
 * @db-write     none
 * @db-txn       none
 * @doctrine     KOMERCE_DB_SCHEMA_DOCTRINE
 * @impact-areas governance, ci
 *
 * Garde-fous :
 *   - neutralise les jetons aleatoires \restrict/\unrestrict de pg_dump >= 18
 *     (sinon chaque snapshot produit un diff parasite) ;
 *   - REFUSE d'ecraser le dump committe si le nouveau contient moins de MIN_TABLES
 *     tables (protege contre un dump partiel / une connexion qui echoue a mi-chemin) ;
 *   - ecriture atomique (temp + rename) ;
 *   - ne logge jamais DATABASE_URL.
 *
 * Usage :
 *   node scripts/db-snapshot.js                 # rafraichit le dump
 *   node scripts/db-snapshot.js --dry-run        # montre le diff, n'ecrit pas
 *   node scripts/db-snapshot.js --input fix.sql  # (test/offline) lit un fichier au lieu de pg_dump
 *   MIN_TABLES=40 node scripts/db-snapshot.js     # ajuste le seuil de securite
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const core = require('./lib/arch-drift-core');

const DRY_RUN = process.argv.includes('--dry-run');
const inputIdx = process.argv.indexOf('--input');
const INPUT_FILE = inputIdx >= 0 ? process.argv[inputIdx + 1] : null;
const MIN_TABLES = Number(process.env.MIN_TABLES || 50);

const OUT = core.paths().liveSql;

function loadDotenvIfPresent() {
  try { require('dotenv').config(); } catch { /* dotenv optionnel */ }
}

/** Retire les jetons aleatoires \restrict/\unrestrict (pg_dump >= 18). */
function neutralizeRandomTokens(sql) {
  return sql
    .split(/\r?\n/)
    .filter(line => !/^\\(restrict|unrestrict)\b/.test(line))
    .join('\n');
}

function runPgDump(databaseUrl) {
  const args = ['--schema-only', '--no-owner', '--no-privileges', `--dbname=${databaseUrl}`];
  const res = spawnSync('pg_dump', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (res.error) {
    if (res.error.code === 'ENOENT') {
      throw new Error('pg_dump introuvable sur le PATH. Installe les client tools PostgreSQL (postgresql-client).');
    }
    throw res.error;
  }
  // pg_dump emet des warnings benins sur stderr (ex. mismatch de version). On ne
  // traite comme fatal que le code de sortie non nul.
  if (res.status !== 0) {
    const err = (res.stderr || '').trim();
    throw new Error(`pg_dump a echoue (code ${res.status})${err ? ' : ' + err.split('\n')[0] : ''}`);
  }
  return res.stdout;
}

function tableSet(sql) {
  return core.parseLiveSchema(sql).tables; // Set de noms de tables base
}

function main() {
  loadDotenvIfPresent();

  let raw;
  if (INPUT_FILE) {
    const p = path.resolve(INPUT_FILE);
    if (!fs.existsSync(p)) { console.error(`FATAL: --input ${INPUT_FILE} introuvable.`); process.exit(2); }
    raw = fs.readFileSync(p, 'utf8');
    console.log(`(mode --input : lecture de ${INPUT_FILE}, pg_dump non appele)`);
  } else {
    const url = process.env.DATABASE_URL;
    if (!url) {
      console.error('FATAL: DATABASE_URL absent. Definis-le (ou .env) avant de lancer le snapshot.');
      process.exit(2);
    }
    try {
      raw = runPgDump(url);
    } catch (e) {
      console.error('FATAL: ' + e.message);
      process.exit(2);
    }
  }

  const cleaned = neutralizeRandomTokens(raw).replace(/\s*$/, '') + '\n';
  const newTables = tableSet(cleaned);

  // ---- Garde-fou : ne pas ecraser un bon dump par un dump suspect ----
  if (newTables.size < MIN_TABLES) {
    console.error(`FATAL: le nouveau dump ne contient que ${newTables.size} tables (< seuil ${MIN_TABLES}).`);
    console.error('       Dump partiel ou connexion incomplete : le dump committe N\'EST PAS ecrase.');
    console.error('       (Ajuste le seuil avec MIN_TABLES=... si la base est volontairement petite.)');
    process.exit(2);
  }

  // ---- Diff vs dump committe ----
  const oldTables = fs.existsSync(OUT) ? tableSet(fs.readFileSync(OUT, 'utf8')) : new Set();
  const added = [...newTables].filter(t => !oldTables.has(t)).sort();
  const removed = [...oldTables].filter(t => !newTables.has(t)).sort();
  const identical = fs.existsSync(OUT) && fs.readFileSync(OUT, 'utf8') === cleaned;

  console.log('============================================================');
  console.log(' KOMERCE - Snapshot du schema live');
  console.log('============================================================');
  console.log(`Cible                   : docs/db/railway-live-schema.sql`);
  console.log(`Tables (live)           : ${newTables.size}  (avant: ${oldTables.size})`);
  console.log(`Mode                    : ${DRY_RUN ? '--dry-run (aucune ecriture)' : 'ecriture'}`);
  console.log('');
  if (added.length)   { console.log(`Tables AJOUTEES (${added.length}) :`);   for (const t of added) console.log(`  + ${t}`); }
  if (removed.length) { console.log(`Tables RETIREES (${removed.length}) :`); for (const t of removed) console.log(`  - ${t}`); }
  if (!added.length && !removed.length) console.log('Aucun changement de table (le contenu detaille peut tout de meme differer).');
  console.log('');

  if (DRY_RUN) {
    console.log('DRY-RUN : dump non ecrit. Relance sans --dry-run pour appliquer.');
    process.exit(0);
  }
  if (identical) {
    console.log('✅ Dump deja a jour (identique). Rien a ecrire.');
    process.exit(0);
  }

  // ---- Ecriture atomique ----
  const tmp = OUT + '.tmp';
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(tmp, cleaned, 'utf8');
  fs.renameSync(tmp, OUT);

  console.log('✅ Dump rafraichi.');
  console.log('   Boucle : npm run arch:reconcile -- --write   puis   npm run arch:gate');
  console.log('   (ou directement : npm run db:sync)');
  process.exit(0);
}

main();
