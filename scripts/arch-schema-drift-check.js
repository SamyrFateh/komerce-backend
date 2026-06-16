'use strict';

/**
 * @komerce-arch
 * @role         governance-schema-drift-check
 * @domain       governance
 * @layer        tooling
 * @criticality  high
 * @purpose      Porte SCHEMA.md <-> DB vivante. Confronte ce que le code/les headers
 *               PRETENDENT toucher en base a ce qui EXISTE reellement dans le dump live.
 *               Comble l'angle mort §2.6 de l'audit : jusqu'ici rien ne comparait
 *               docs/SCHEMA.md ni les headers @db-* a la base reelle.
 * @inputs       docs/db/railway-live-schema.sql (pg_dump --schema-only),
 *               docs/SCHEMA.md, docs/komerce-arch-header-graph.json,
 *               scripts/arch-debt-budget.json
 * @outputs      stdout report, process exit code
 * @depends      scripts/generate-komerce-arch-graph.js
 * @used-by      .github/workflows/governance.yml
 * @db-read      none
 * @db-write     none
 * @db-txn       none
 * @doctrine     KOMERCE_DB_SCHEMA_DOCTRINE, KOMERCE_ARCH_GRAPH_DOCTRINE
 * @impact-areas governance, ci
 *
 * Dependency-free. Ne touche aucun comportement applicatif.
 *
 * Trois constats, par tier :
 *   FICTION (bloquant)  : un header @db-read/@db-write nomme une table qui n'existe
 *                         comme AUCUN objet live (ni table, ni vue, ni type, ni
 *                         fonction, ni trigger). C'est une ecriture/lecture vers le
 *                         vide => bug latent. Seules les entrees nommees dans
 *                         budget.knownDriftAllowlist sont tolerees (et figees) ; toute
 *                         fiction hors liste fait echouer. La liste ne peut que diminuer.
 *   FANTOME (bloquant)  : SCHEMA.md catalogue une table (ligne `| `nom` |`) absente de
 *                         tout objet live => doc qui sur-declare. Cible : 0.
 *   NON-DOCUMENTE (cliquet) : une table BASE live absente du catalogue SCHEMA.md
 *                         (hors meta-infra). Dette de doc reelle, plafond budget.ratchet.
 *
 * Usage :
 *   node scripts/arch-schema-drift-check.js          # bloque (fiction hors liste / fantome / cliquet depasse)
 *   node scripts/arch-schema-drift-check.js --report # observe : sort toujours 0
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const LIVE_SQL = path.join(ROOT, 'docs', 'db', 'railway-live-schema.sql');
const SCHEMA_PATH = path.join(ROOT, 'docs', 'SCHEMA.md');
const GRAPH_PATH = path.join(ROOT, 'docs', 'komerce-arch-header-graph.json');
const BUDGET_PATH = path.join(__dirname, 'arch-debt-budget.json');

const REPORT_ONLY = process.argv.includes('--report');

// Mots SQL traites a tort comme des tables par un parser naif.
const SQL_NOISE = new Set([
  'select', 'insert', 'update', 'delete', 'set', 'from', 'where', 'into',
  'values', 'and', 'or', 'on', 'of', 'now', 'avg', 'sum', 'count', 'min',
  'max', 'lateral', 'rollback', 'commit', 'begin', 'returning', 'join',
  'left', 'right', 'inner', 'outer', 'full', 'cross', 'null', 'true', 'false',
  'distinct', 'group', 'order', 'limit', 'offset', 'union', 'with', 'case',
  'when', 'then', 'else', 'end', 'coalesce', 'exists', 'in', 'not', 'as',
  'using', 'having', 'asc', 'desc', 'by', 'all', 'any', 'between', 'like'
]);

// Catalogues systeme PostgreSQL (information_schema / pg_catalog) interroges au
// demarrage : ce ne sont pas des tables applicatives.
const PG_SYSTEM_RE = /^(pg_|information_schema$|columns$|age$)/;

// Invariants doctrine qui peuvent apparaitre en @db-txn et ne doivent jamais etre
// traites comme des tables. Liste EXPLICITE (pas un heuristique de longueur : des
// tables reelles ont 4+ segments, ex. order_item_real_cost_allocations). Si une de
// ces valeurs fuit dans @db-read/@db-write, la laisser remonter en fiction est le
// comportement voulu (c'est une erreur de header).
const DOCTRINE_INVARIANTS = new Set(['resolve_before_behavior_change']);

// Meta-infra qui n'a pas vocation a etre cataloguee comme table de domaine.
const INFRA_TABLES = new Set(['schema_migrations']);

function die(msg, code) {
  console.error(msg);
  process.exit(code == null ? 2 : code);
}

function read(p, label) {
  if (!fs.existsSync(p)) die(`FATAL: ${label} absent (${path.relative(ROOT, p)}).`, 2);
  return fs.readFileSync(p, 'utf8');
}

/** Extrait les objets du dump live, par type, en minuscules. */
function parseLiveSchema(sql) {
  const grab = (re) => {
    const out = new Set();
    let m;
    while ((m = re.exec(sql)) !== null) out.add(m[1].toLowerCase());
    return out;
  };
  const tables    = grab(/CREATE TABLE (?:IF NOT EXISTS )?(?:public\.)?"?([a-zA-Z_][a-zA-Z0-9_]*)"?/gi);
  const views     = grab(/CREATE (?:OR REPLACE )?VIEW (?:public\.)?"?([a-zA-Z_][a-zA-Z0-9_]*)"?/gi);
  const types     = grab(/CREATE TYPE (?:public\.)?"?([a-zA-Z_][a-zA-Z0-9_]*)"?/gi);
  const functions = grab(/CREATE (?:OR REPLACE )?FUNCTION (?:public\.)?"?([a-zA-Z_][a-zA-Z0-9_]*)"?/gi);
  const triggers  = grab(/CREATE (?:CONSTRAINT )?TRIGGER "?([a-zA-Z_][a-zA-Z0-9_]*)"?/gi);
  // Contraintes nommees (CHECK / FK) referencees par nom dans SCHEMA.md.
  const constraints = grab(/CONSTRAINT "?([a-zA-Z_][a-zA-Z0-9_]*)"?/gi);
  const all = new Set([...tables, ...views, ...types, ...functions, ...triggers, ...constraints]);
  return { tables, views, types, functions, triggers, constraints, all };
}

/** Tokens type-table cites dans SCHEMA.md (1re cellule backtickee des tableaux). */
function parseDocumentedTokens(md) {
  const names = new Set();
  for (const line of md.split(/\r?\n/)) {
    const t = line.trim();
    if (!t.startsWith('|')) continue;
    const first = t.replace(/^\|/, '').split('|')[0].trim();
    const m = first.match(/^`([a-z_][a-z0-9_]*)`$/);
    if (m) names.add(m[1].toLowerCase());
  }
  return names;
}

/** Tokens de table reellement declares par les headers @db-read / @db-write. */
function parseHeaderTableTokens(graph) {
  const nodes = (graph.nodes || []).filter(n => n.type === 'file' || n.type === 'file-lite');
  const byToken = new Map(); // token -> Set(files)
  for (const n of nodes) {
    for (const raw of [...(n.dbRead || []), ...(n.dbWrite || [])]) {
      const tok = String(raw).toLowerCase().trim();
      if (!tok || tok === '@unknown' || DOCTRINE_INVARIANTS.has(tok)) continue;
      if (SQL_NOISE.has(tok) || PG_SYSTEM_RE.test(tok)) continue;
      if (!byToken.has(tok)) byToken.set(tok, new Set());
      byToken.get(tok).add(n.file);
    }
  }
  return byToken;
}

function loadBudget() {
  const fallback = { knownDriftAllowlist: {}, ratchet: { liveTablesUndocumented: Infinity } };
  if (!fs.existsSync(BUDGET_PATH)) return fallback;
  try {
    const b = JSON.parse(fs.readFileSync(BUDGET_PATH, 'utf8'));
    return {
      knownDriftAllowlist: (b.knownDriftAllowlist) || {},
      ratchet: Object.assign({ liveTablesUndocumented: Infinity }, b.ratchet || {})
    };
  } catch {
    return fallback;
  }
}

function main() {
  const live = parseLiveSchema(read(LIVE_SQL, 'dump live'));
  const documented = parseDocumentedTokens(read(SCHEMA_PATH, 'docs/SCHEMA.md'));
  const graph = JSON.parse(read(GRAPH_PATH, 'docs/komerce-arch-header-graph.json'));
  const headerTokens = parseHeaderTableTokens(graph);
  const budget = loadBudget();
  // Les cles meta (_role, _note...) ne sont pas des entrees d'allowlist.
  const allowlist = {};
  for (const [k, v] of Object.entries(budget.knownDriftAllowlist || {})) {
    if (!k.startsWith('_')) allowlist[k] = v;
  }

  // ---- FICTION : header nomme une table absente de TOUT objet live ----
  const fiction = [];
  for (const [tok, files] of [...headerTokens.entries()].sort()) {
    if (!live.all.has(tok)) {
      fiction.push({ token: tok, files: [...files].sort(), allowed: Object.prototype.hasOwnProperty.call(allowlist, tok) });
    }
  }
  const fictionUnlisted = fiction.filter(f => !f.allowed);
  const allowlistStale = Object.keys(allowlist).filter(tok => !fiction.some(f => f.token === tok));

  // ---- FANTOME : SCHEMA.md catalogue un nom absent de tout objet live ----
  const ghosts = [...documented].filter(tok => !live.all.has(tok)).sort();

  // ---- NON-DOCUMENTE : table BASE live hors catalogue SCHEMA.md (hors infra) ----
  const undocumented = [...live.tables]
    .filter(tbl => !documented.has(tbl) && !INFRA_TABLES.has(tbl))
    .sort();
  const ratchetMax = budget.ratchet.liveTablesUndocumented;
  const ratchetOver = undocumented.length > ratchetMax;

  // ---- Rapport ----
  console.log('============================================================');
  console.log(' KOMERCE - Porte SCHEMA.md <-> DB vivante (drift)');
  console.log('============================================================');
  console.log(`Mode                    : ${REPORT_ONLY ? '--report (non bloquant)' : 'bloquant'}`);
  console.log(`Dump live               : docs/db/railway-live-schema.sql`);
  console.log(`Objets live             : ${live.tables.size} tables, ${live.views.size} vues, ${live.types.size} types, ${live.functions.size} fn, ${live.triggers.size} triggers`);
  console.log(`Tokens table (headers)  : ${headerTokens.size}`);
  console.log('');
  console.log('--- TIER BLOQUANT ---');
  console.log(`Fiction (hors liste)    : ${fictionUnlisted.length}`);
  console.log(`Fiction (figee/connue)  : ${fiction.length - fictionUnlisted.length}`);
  console.log(`Fantomes SCHEMA.md      : ${ghosts.length}`);
  console.log('');
  console.log('--- CLIQUET ---');
  const ratchetTag = ratchetMax === Infinity ? '(plafond non defini)' : ratchetOver ? `REGRESSION > ${ratchetMax}` : `OK (<= ${ratchetMax})`;
  console.log(`Tables live non doc.    : ${String(undocumented.length).padStart(3)}   ${ratchetTag}`);
  console.log('');

  const blockers = [];

  if (fiction.length) {
    console.log('--- FICTION (header -> table inexistante en base) ---');
    for (const f of fiction) {
      const flag = f.allowed ? 'FIGEE ' : 'HORS-LISTE ';
      console.log(`  [${flag}] ${f.token}`);
      console.log(`            <- ${f.files.slice(0, 6).join(', ')}${f.files.length > 6 ? ', ...' : ''}`);
      if (f.allowed && allowlist[f.token]) console.log(`            note: ${allowlist[f.token]}`);
    }
    console.log('');
  }
  if (fictionUnlisted.length) {
    blockers.push(`Fiction hors liste blanche: ${fictionUnlisted.length} (${fictionUnlisted.map(f => f.token).join(', ')})`);
  }
  if (allowlistStale.length) {
    // Une entree de liste blanche qui ne correspond plus a aucune fiction = a retirer.
    // Bloquant : la liste ne doit jamais sur-couvrir (sinon elle cache une re-introduction future).
    blockers.push(`Liste blanche perimee (a retirer): ${allowlistStale.join(', ')}`);
  }
  if (ghosts.length) {
    console.log('--- FANTOMES (SCHEMA.md -> objet inexistant en base) ---');
    for (const g of ghosts) console.log(`  ${g}`);
    console.log('');
    blockers.push(`Fantomes dans SCHEMA.md: ${ghosts.length} (${ghosts.join(', ')})`);
  }
  if (undocumented.length) {
    console.log('--- TABLES LIVE NON DOCUMENTEES (cliquet) ---');
    for (const u of undocumented) console.log(`  ${u}`);
    console.log('');
  }
  if (ratchetOver) {
    blockers.push(`Tables live non documentees: ${undocumented.length} > cliquet ${ratchetMax}`);
  }

  console.log('============================================================');
  if (blockers.length) {
    for (const b of blockers) console.error('🚫 ' + b);
    if (REPORT_ONLY) {
      console.log(`MODE --report : ${blockers.length} blocage(s) detecte(s), sortie non bloquante.`);
      process.exit(0);
    }
    console.error(`ECHEC: ${blockers.length} blocage(s) de drift.`);
    process.exit(1);
  }
  console.log('✅ Aucun drift bloquant. SCHEMA.md et headers concordent avec la DB live.');
  process.exit(0);
}

main();
