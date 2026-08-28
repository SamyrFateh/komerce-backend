'use strict';

/**
 * @komerce-arch
 * @role         governance-schema-column-promote
 * @domain       governance
 * @layer        tooling
 * @criticality  medium
 * @purpose      Promouvoir automatiquement les marqueurs column-level
 *               intended_migration_schema de SCHEMA.md lorsque la migration
 *               et le dump Railway prouvent la paire exacte table+colonne.
 * @inputs       docs/SCHEMA.md, docs/db/railway-live-schema.sql, migrations/*.sql
 * @outputs      stdout report, [--write] reecrit docs/SCHEMA.md, exit code
 * @depends      none
 * @used-by      scripts/schema-promote-all.js
 * @db-read      none
 * @db-write     none
 * @db-txn       none
 * @doctrine     KOMERCE_DB_SCHEMA_DOCTRINE
 * @impact-areas governance, ci
 * @version      2026-08
 *
 * Asymetrie volontaire : ce script ne declare jamais une colonne. Il ne fait
 * que remplacer un marqueur humain deja present quand la verite live est
 * prouvee. La preuve est strictement table+colonne ; voir le meme nom de
 * colonne sur une autre table ne suffit jamais.
 *
 * Une migration numerique doit resoudre vers exactement UN fichier racine
 * migrations/NNN_*.sql. En cas de collision de numero, la promotion echoue
 * fail-closed plutot que de choisir arbitrairement un fichier.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SCHEMA_MD = path.join(ROOT, 'docs', 'SCHEMA.md');
const LIVE_SQL = path.join(ROOT, 'docs', 'db', 'railway-live-schema.sql');
const MIGRATIONS_DIR = path.join(ROOT, 'migrations');

const WRITE = process.argv.includes('--write');
const CHECK = process.argv.includes('--check');

const INTENDED_MARKER_RE = /\*\*Migration\s+(\d+)\s+\(([^)]*?`intended_migration_schema`\s*[—-]\s*non vérifié live[^)]*)\)\*\*/g;

function normalizeIdentifier(raw) {
  return String(raw || '')
    .trim()
    .replace(/^public\./i, '')
    .replace(/"/g, '')
    .toLowerCase();
}

/**
 * Parse les CREATE TABLE du pg_dump en conservant la portee table.
 * [ \t] autour de '(' est volontaire : \s pourrait franchir une ligne et
 * absorber le CREATE TABLE suivant dans certains fixtures/DDL compacts.
 */
function parseLiveColumnsByTable(sql) {
  const out = new Map();
  const tableRe = /CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+(?:public\.)?"?([A-Za-z_][A-Za-z0-9_$]*)"?[ \t]*\([ \t]*\r?\n([\s\S]*?)\r?\n\);/gi;
  let tableMatch;

  while ((tableMatch = tableRe.exec(sql)) !== null) {
    const table = normalizeIdentifier(tableMatch[1]);
    const columns = new Set();

    for (const line of tableMatch[2].split(/\r?\n/)) {
      const m = line.match(/^\s{2,}"?([A-Za-z_][A-Za-z0-9_$]*)"?\s+/);
      if (!m) continue;
      const name = normalizeIdentifier(m[1]);
      if (['constraint', 'primary', 'foreign', 'unique', 'check', 'exclude'].includes(name)) continue;
      columns.add(name);
    }

    out.set(table, columns);
  }

  return out;
}

/**
 * Retourne uniquement les colonnes qu'une migration associe explicitement a
 * targetTable : ADD COLUMN structurel ou COMMENT ON COLUMN semantique.
 * Le second cas couvre par exemple migration 096 / products.fragility.
 */
function extractMigrationColumnsForTable(sql, targetTable) {
  const table = normalizeIdentifier(targetTable);
  const columns = new Set();

  const alterRe = /ALTER\s+TABLE(?:\s+ONLY)?(?:\s+IF\s+EXISTS)?\s+((?:public\.)?"?[A-Za-z_][A-Za-z0-9_$]*"?)\s+([\s\S]*?);/gi;
  let alterMatch;
  while ((alterMatch = alterRe.exec(sql)) !== null) {
    if (normalizeIdentifier(alterMatch[1]) !== table) continue;
    const addRe = /\bADD\s+COLUMN(?:\s+IF\s+NOT\s+EXISTS)?\s+"?([A-Za-z_][A-Za-z0-9_$]*)"?/gi;
    let addMatch;
    while ((addMatch = addRe.exec(alterMatch[2])) !== null) {
      columns.add(normalizeIdentifier(addMatch[1]));
    }
  }

  const commentRe = /COMMENT\s+ON\s+COLUMN\s+((?:public\.)?"?[A-Za-z_][A-Za-z0-9_$]*"?)\."?([A-Za-z_][A-Za-z0-9_$]*)"?\s+IS/gi;
  let commentMatch;
  while ((commentMatch = commentRe.exec(sql)) !== null) {
    if (normalizeIdentifier(commentMatch[1]) !== table) continue;
    columns.add(normalizeIdentifier(commentMatch[2]));
  }

  return columns;
}

function migrationResolverFromDir(migrationsDir) {
  return migrationNumber => {
    const prefix = `${migrationNumber}_`;
    return fs.readdirSync(migrationsDir)
      .filter(name => name.startsWith(prefix) && name.endsWith('.sql'))
      .sort()
      .map(name => ({
        name,
        sql: fs.readFileSync(path.join(migrationsDir, name), 'utf8'),
      }));
  };
}

function planIntendedColumnPromotions(md, liveSql, resolveMigration) {
  const liveColumns = parseLiveColumnsByTable(liveSql);
  const promotable = [];
  const waiting = [];
  const invalid = [];
  const lines = md.split('\n');

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];
    const tableMatch = line.match(/^\|\s*`([^`]+)`\s*\|/);
    if (!tableMatch) continue;
    const table = normalizeIdentifier(tableMatch[1]);

    INTENDED_MARKER_RE.lastIndex = 0;
    let marker;
    while ((marker = INTENDED_MARKER_RE.exec(line)) !== null) {
      const migration = marker[1];
      const candidates = resolveMigration(migration);
      const base = { lineIndex, table, migration, raw: marker[0] };

      if (candidates.length !== 1) {
        invalid.push({
          ...base,
          reason: candidates.length === 0
            ? 'migration introuvable'
            : `numero ambigu (${candidates.map(c => c.name).join(', ')})`,
        });
        continue;
      }

      const columns = [...extractMigrationColumnsForTable(candidates[0].sql, table)].sort();
      if (!columns.length) {
        invalid.push({
          ...base,
          migrationFile: candidates[0].name,
          reason: 'aucune colonne table-scoped prouvable dans la migration',
        });
        continue;
      }

      const liveForTable = liveColumns.get(table) || new Set();
      const missing = columns.filter(column => !liveForTable.has(column));
      const planned = {
        ...base,
        migrationFile: candidates[0].name,
        columns,
        missing,
      };

      if (missing.length) waiting.push(planned);
      else promotable.push(planned);
    }
  }

  return { promotable, waiting, invalid };
}

function applyIntendedColumnPromotions(md, promotions) {
  const lines = md.split('\n');

  for (const promotion of promotions) {
    const verified = promotion.raw.replace(
      /`intended_migration_schema`\s*[—-]\s*non vérifié live/,
      '`verified_live_schema` — vérifié live Railway'
    );
    lines[promotion.lineIndex] = lines[promotion.lineIndex].replace(promotion.raw, verified);
  }

  return lines.join('\n');
}

function main() {
  const md = fs.readFileSync(SCHEMA_MD, 'utf8');
  const liveSql = fs.readFileSync(LIVE_SQL, 'utf8');
  const plan = planIntendedColumnPromotions(
    md,
    liveSql,
    migrationResolverFromDir(MIGRATIONS_DIR)
  );

  console.log('============================================================');
  console.log('SCHEMA-PROMOTE-COLUMNS — intentions vs dump Railway live');
  console.log(`Promouvables : ${plan.promotable.length}`);
  console.log(`En attente   : ${plan.waiting.length}`);
  console.log(`Invalides    : ${plan.invalid.length}`);

  for (const item of plan.promotable) {
    console.log(`   ↑ ${item.table} / migration ${item.migration}: ${item.columns.join(', ')}`);
  }
  for (const item of plan.waiting) {
    console.log(`   … ${item.table} / migration ${item.migration} attend: ${item.missing.join(', ')}`);
  }
  for (const item of plan.invalid) {
    console.log(`   🚫 ${item.table} / migration ${item.migration}: ${item.reason}`);
  }

  if (plan.invalid.length) process.exit(1);

  if (CHECK && !WRITE && plan.promotable.length) {
    console.log(`🚫 ${plan.promotable.length} promotion(s) column-level due(s) et non appliquee(s).`);
    process.exit(1);
  }

  if (!plan.promotable.length) {
    console.log('✅ Aucun marqueur column-level a promouvoir.');
    process.exit(0);
  }

  if (WRITE) {
    const next = applyIntendedColumnPromotions(md, plan.promotable);
    fs.writeFileSync(SCHEMA_MD, next);
    console.log(`✅ SCHEMA.md mis a jour : ${plan.promotable.length} marqueur(s) column-level promu(s).`);
  } else {
    console.log('ℹ️  Dry-run : rien écrit. Ajouter --write pour appliquer.');
  }
}

module.exports = {
  normalizeIdentifier,
  parseLiveColumnsByTable,
  extractMigrationColumnsForTable,
  migrationResolverFromDir,
  planIntendedColumnPromotions,
  applyIntendedColumnPromotions,
};

if (require.main === module) main();
