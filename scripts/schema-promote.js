'use strict';

/**
 * @komerce-arch
 * @role         governance-schema-promote
 * @domain       governance
 * @layer        tooling
 * @criticality  medium
 * @purpose      Promotion automatique post-deploy : les objets DB declares
 *               "vises par migration" dans SCHEMA.md (blocs schema-pending)
 *               deviennent des lignes de tableau des que le dump live les
 *               confirme. Les marqueurs column-level intended_migration_schema
 *               deviennent eux aussi verified_live_schema quand la migration
 *               et le dump prouvent la paire table+colonne.
 * @inputs       docs/SCHEMA.md, docs/db/railway-live-schema.sql,
 *               migrations/*.sql, scripts/lib/arch-drift-core.js
 * @outputs      stdout report, [--write] reecrit docs/SCHEMA.md, exit code
 * @depends      scripts/lib/arch-drift-core.js
 * @used-by      .github/workflows/schema-refresh.yml (apres regeneration dump)
 * @db-read      none
 * @db-write     none
 * @db-txn       none
 * @doctrine     KOMERCE_DB_SCHEMA_DOCTRINE
 * @impact-areas governance, ci
 * @version      2026-08
 *
 * Asymetrie volontaire (meme philosophie qu'arch-reconcile.js) :
 *   - PROMOUVOIR est automatique : un objet vise qui EXISTE dans le dump live
 *     passe du bloc schema-pending a une ligne de tableau SCHEMA.md ; un
 *     marqueur intended_migration_schema sur une table existante passe a
 *     verified_live_schema seulement si la migration associee designe cette
 *     table et si TOUTES les colonnes visees sont presentes sous cette table
 *     dans le CREATE TABLE du dump Railway.
 *   - DECLARER reste humain : ce script n'invente ni objet ni colonne, ne
 *     supprime jamais une ligne de tableau et ne devine jamais une migration
 *     ambigue. Attendre un deploiement n'est pas une dette.
 *
 * Garde-fou column-level : la preuve est table+colonne. Voir uniquement le nom
 * d'une colonne ailleurs dans le dump n'est jamais suffisant. Un numero de
 * migration qui correspond a 0 ou plusieurs fichiers racine est refuse pour
 * la promotion automatique (pas de choix arbitraire en cas de collision).
 *
 * Convention objet dans docs/SCHEMA.md :
 *
 *   <!-- schema-pending
 *   object: v_shipment_density
 *   kind: view
 *   migration: 095
 *   section: ## 5. Vues critiques
 *   role: Densite par shipment (W/M, fill_rate_pct, margin_kmf_per_m3).
 *   consumers: Admin logistique / calibration V-5
 *   -->
 *
 * Convention colonne : dans la ligne de la table deja documentee, le bloc
 * descriptif de migration porte :
 *   **Migration N (..., `intended_migration_schema` — non vérifié live)**
 * Le script retrouve migrations/N_*.sql, extrait les ADD COLUMN / COMMENT ON
 * COLUMN visant CETTE table, puis promeut le marqueur si ces colonnes sont
 * toutes presentes dans le dump live.
 *
 * Modes :
 *   node scripts/schema-promote.js            # dry-run : montre le plan
 *   node scripts/schema-promote.js --write    # applique a SCHEMA.md
 *   node scripts/schema-promote.js --check    # CI : exit 1 si une promotion
 *                                             #      est due et non appliquee
 */

const fs = require('fs');
const path = require('path');
const core = require('./lib/arch-drift-core');

const WRITE = process.argv.includes('--write');
const CHECK = process.argv.includes('--check');

const PENDING_RE = /<!--\s*schema-pending\n([\s\S]*?)-->\n?/g;
const INTENDED_MARKER_RE = /\*\*Migration\s+(\d+)\s+\(([^)]*?`intended_migration_schema`\s*[—-]\s*non vérifié live[^)]*)\)\*\*/g;

function parseBlock(body) {
  const out = {};
  for (const line of body.split('\n')) {
    const m = line.match(/^(\w+):\s*(.+)\s*$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function buildRow(b) {
  const promoNote = `**Migration ${b.migration} — promue le ${todayISO()} (schema-promote, dump live verifie).**`;
  return b.consumers
    ? `| \`${b.object}\` | ${b.role} ${promoNote} | ${b.consumers} |`
    : `| \`${b.object}\` | ${b.role} ${promoNote} |`;
}

/**
 * Insere une ligne a la fin du tableau markdown situe sous le heading donne.
 * Un tableau = suite contigue de lignes commencant par '|'. On insere apres
 * la derniere. Erreur explicite si le heading ou le tableau est introuvable.
 */
function insertRowUnderSection(md, sectionHeading, row) {
  const lines = md.split('\n');
  const hIdx = lines.findIndex(l => l.trim() === sectionHeading.trim());
  if (hIdx === -1) throw new Error(`Heading introuvable dans SCHEMA.md : "${sectionHeading}"`);

  let start = -1;
  for (let i = hIdx + 1; i < lines.length; i++) {
    if (/^#{1,6}\s/.test(lines[i])) break;
    if (lines[i].startsWith('|')) { start = i; break; }
  }
  if (start === -1) throw new Error(`Aucun tableau sous "${sectionHeading}"`);

  let end = start;
  while (end + 1 < lines.length && lines[end + 1].startsWith('|')) end++;

  lines.splice(end + 1, 0, row);
  return lines.join('\n');
}

function normalizeIdentifier(raw) {
  return String(raw || '')
    .trim()
    .replace(/^public\./i, '')
    .replace(/"/g, '')
    .toLowerCase();
}

/**
 * Extrait les colonnes par table depuis les CREATE TABLE du pg_dump.
 * La sortie est volontairement table-scoped : Map<table, Set<column>>.
 */
function parseLiveColumnsByTable(sql) {
  const out = new Map();
  const tableRe = /CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+(?:public\.)?"?([A-Za-z_][A-Za-z0-9_$]*)"?\s*\(\s*\n([\s\S]*?)\n\);/gi;
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
 * Colonnes qu'une migration associe explicitement a une table existante.
 * - ADD COLUMN prouve l'intention structurelle.
 * - COMMENT ON COLUMN couvre les migrations semantiques qui officialisent
 *   une colonne deja existante (ex. 096 products.fragility).
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
    const files = fs.readdirSync(migrationsDir)
      .filter(name => name.startsWith(prefix) && name.endsWith('.sql'))
      .sort();
    return files.map(name => ({
      name,
      sql: fs.readFileSync(path.join(migrationsDir, name), 'utf8'),
    }));
  };
}

/**
 * Planifie les promotions column-level sans modifier le markdown.
 * resolveMigration(number) -> [{ name, sql }]. Une seule migration racine est
 * exigee : en cas de collision de numero, le script refuse de choisir.
 */
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
        invalid.push({ ...base, reason: candidates.length === 0
          ? 'migration introuvable'
          : `numero ambigu (${candidates.map(c => c.name).join(', ')})` });
        continue;
      }

      const columns = [...extractMigrationColumnsForTable(candidates[0].sql, table)].sort();
      if (!columns.length) {
        invalid.push({ ...base, migrationFile: candidates[0].name, reason: 'aucune colonne table-scoped prouvable dans la migration' });
        continue;
      }

      const liveForTable = liveColumns.get(table) || new Set();
      const missing = columns.filter(column => !liveForTable.has(column));
      const planned = { ...base, migrationFile: candidates[0].name, columns, missing };
      if (missing.length) waiting.push(planned);
      else promotable.push(planned);
    }
  }

  return { promotable, waiting, invalid };
}

function applyIntendedColumnPromotions(md, promotions) {
  const lines = md.split('\n');
  for (const p of promotions) {
    const verified = p.raw.replace(
      /`intended_migration_schema`\s*[—-]\s*non vérifié live/,
      '`verified_live_schema` — vérifié live Railway'
    );
    lines[p.lineIndex] = lines[p.lineIndex].replace(p.raw, verified);
  }
  return lines.join('\n');
}

function main() {
  const P = core.paths();
  const liveSql = fs.readFileSync(P.liveSql, 'utf8');
  const live = core.parseLiveSchema(liveSql);
  let md = fs.readFileSync(P.schema, 'utf8');

  const pending = [];
  PENDING_RE.lastIndex = 0;
  let m;
  while ((m = PENDING_RE.exec(md)) !== null) {
    pending.push({ raw: m[0], ...parseBlock(m[1]) });
  }

  const objectPromotable = [];
  const objectWaiting = [];
  const objectInvalid = [];
  for (const b of pending) {
    if (!b.object || !b.section || !b.role || !b.migration) { objectInvalid.push(b); continue; }
    (live.all.has(b.object) ? objectPromotable : objectWaiting).push(b);
  }

  const migrationsDir = path.join(__dirname, '..', 'migrations');
  const columnPlan = planIntendedColumnPromotions(
    md,
    liveSql,
    migrationResolverFromDir(migrationsDir)
  );

  console.log('============================================================');
  console.log('SCHEMA-PROMOTE — declarations visees vs dump live');
  console.log(`Objets schema-pending   : ${pending.length}`);
  console.log(`Objets en attente       : ${objectWaiting.length}${objectWaiting.length ? ' (' + objectWaiting.map(b => b.object).join(', ') + ')' : ''}`);
  console.log(`Objets promouvables     : ${objectPromotable.length}${objectPromotable.length ? ' (' + objectPromotable.map(b => b.object).join(', ') + ')' : ''}`);
  console.log(`Colonnes intended       : ${columnPlan.promotable.length + columnPlan.waiting.length + columnPlan.invalid.length}`);
  console.log(`Colonnes en attente     : ${columnPlan.waiting.length}`);
  console.log(`Colonnes promouvables   : ${columnPlan.promotable.length}`);

  if (objectInvalid.length || columnPlan.invalid.length) {
    if (objectInvalid.length) {
      console.log(`🚫 Blocs schema-pending invalides : ${objectInvalid.length}`);
    }
    for (const p of columnPlan.invalid) {
      console.log(`🚫 ${p.table} / migration ${p.migration} : ${p.reason}`);
    }
    process.exit(1);
  }

  for (const p of columnPlan.waiting) {
    console.log(`   … ${p.table} / migration ${p.migration} attend : ${p.missing.join(', ')}`);
  }
  for (const p of columnPlan.promotable) {
    console.log(`   ↑ ${p.table} / migration ${p.migration} : ${p.columns.join(', ')}`);
  }

  const dueCount = objectPromotable.length + columnPlan.promotable.length;
  if (!dueCount) {
    console.log('✅ Rien a promouvoir (attendre est sain, pas une dette).');
    process.exit(0);
  }

  if (CHECK && !WRITE) {
    console.log(`🚫 ${dueCount} promotion(s) due(s) et non appliquee(s). Lancer : npm run schema:promote:write`);
    process.exit(1);
  }

  // Appliquer d'abord les marqueurs de colonnes : ils sont line-scoped sur le
  // markdown original. Les insertions/suppressions d'objets peuvent ensuite
  // faire varier les numeros de ligne sans rendre ces offsets obsoletes.
  md = applyIntendedColumnPromotions(md, columnPlan.promotable);

  for (const b of objectPromotable) {
    md = md.replace(b.raw, '');
    md = insertRowUnderSection(md, b.section, buildRow(b));
    console.log(`   ↑ ${b.object} → ligne de tableau sous "${b.section}"`);
  }

  if (WRITE) {
    fs.writeFileSync(P.schema, md);
    console.log(`✅ SCHEMA.md mis a jour : ${dueCount} promotion(s). Relancer gate:schema pour confirmer.`);
  } else {
    console.log('ℹ️  Dry-run : rien n\'a ete ecrit. Ajouter --write pour appliquer.');
  }
  process.exit(0);
}

module.exports = {
  normalizeIdentifier,
  parseLiveColumnsByTable,
  extractMigrationColumnsForTable,
  planIntendedColumnPromotions,
  applyIntendedColumnPromotions,
};

if (require.main === module) main();
