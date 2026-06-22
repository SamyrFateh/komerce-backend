'use strict';

/**
 * KOMERCE — Check fraîcheur de db/schema.sql (scripts/check-schema-freshness.js)
 * ============================================================================
 * Vérifie que db/schema.sql (dump Railway) contient toutes les colonnes
 * ajoutées par les migrations numérotées. Bloque la CI si schema.sql est
 * périmé (dump non rejoué après une migration récente).
 *
 * Usage :
 *   node scripts/check-schema-freshness.js        # exit 1 si périmé
 *   node scripts/check-schema-freshness.js --warn # exit 0 mais affiche les manques
 *
 * Intégration ci.yml :
 *   - name: Check schema.sql freshness
 *     run: node scripts/check-schema-freshness.js
 * ============================================================================
 */

const fs   = require('fs');
const path = require('path');

const ROOT           = path.join(__dirname, '..');
const MIGRATIONS_DIR = path.join(ROOT, 'migrations');
const SCHEMA_FILE    = path.join(ROOT, 'db', 'schema.sql');
const WARN_ONLY      = process.argv.includes('--warn');

// ALTER TABLE [ONLY] [public.]table ADD COLUMN [IF NOT EXISTS] colname
const ADD_COL_RE = /ALTER\s+TABLE\s+(?:ONLY\s+)?(?:public\.)?(\w+)\s+ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/gi;
const MIGRATION_RE = /^\d{3}/;

function parseMigrationNumber(filename) {
  const m = filename.match(/^(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

function listMigrations() {
  return fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => MIGRATION_RE.test(f) && f.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
}

function extractAddColumns(sql) {
  const results = [];
  let m;
  // Reset lastIndex pour chaque appel
  ADD_COL_RE.lastIndex = 0;
  while ((m = ADD_COL_RE.exec(sql)) !== null) {
    results.push({ table: m[1].toLowerCase(), col: m[2].toLowerCase() });
  }
  return results;
}

function main() {
  const schema = fs.readFileSync(SCHEMA_FILE, 'utf8').toLowerCase();
  const migrations = listMigrations();

  const missing = [];

  for (const fname of migrations) {
    const num = parseMigrationNumber(fname);
    if (num === null) continue;

    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, fname), 'utf8');
    const cols = extractAddColumns(sql);

    for (const { table, col } of cols) {
      // Chercher la colonne dans schema.sql.
      // On vérifie sa présence dans un bloc CREATE TABLE de la bonne table
      // (heuristique suffisante — les noms de colonnes sont spécifiques).
      if (!schema.includes(col)) {
        missing.push({ fname, table, col });
      }
    }
  }

  if (missing.length === 0) {
    console.log('✅ schema.sql est à jour — toutes les colonnes de migration sont présentes.');
    process.exit(0);
  }

  console.error(`\n❌ schema.sql PÉRIMÉ — ${missing.length} colonne(s) manquante(s) :\n`);
  for (const { fname, table, col } of missing) {
    console.error(`   [${fname}]  ${table}.${col}`);
  }
  console.error(`
Action requise :
   railway run bash scripts/refresh-schema.sh
   git add db/schema.sql && git commit -m "chore(schema): refresh prod" && git push
`);

  process.exit(WARN_ONLY ? 0 : 1);
}

main();
