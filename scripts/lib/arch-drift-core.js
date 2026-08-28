'use strict';

/**
 * @komerce-arch
 * @role         governance-arch-drift-core
 * @domain       governance
 * @layer        tooling
 * @criticality  high
 * @purpose      Noyau partage d'analyse de drift SCHEMA.md/headers <-> DB live.
 *               Source UNIQUE de la definition de "fiction / fantome / non-documente",
 *               consommee par arch-schema-drift-check.js (la porte) ET
 *               arch-reconcile.js (la reprise auto). Garantit qu'ils ne divergent jamais.
 * @inputs       docs/db/railway-live-schema.sql, docs/SCHEMA.md,
 *               docs/komerce-arch-header-graph.json, scripts/arch-debt-budget.json
 * @outputs      objets d'analyse (aucun effet de bord, aucun exit)
 * @depends      none
 * @used-by      scripts/arch-schema-drift-check.js, scripts/arch-reconcile.js
 * @db-read      none
 * @db-write     none
 * @db-txn       none
 * @doctrine     KOMERCE_DB_SCHEMA_DOCTRINE, KOMERCE_ARCH_GRAPH_DOCTRINE
 * @impact-areas governance, ci
 *
 * Dependency-free, pur (lecture seule). N'appelle jamais process.exit.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

function paths(root = REPO_ROOT) {
  return {
    root,
    liveSql: path.join(root, 'docs', 'db', 'railway-live-schema.sql'),
    schema: path.join(root, 'docs', 'SCHEMA.md'),
    graph: path.join(root, 'docs', 'komerce-arch-header-graph.json'),
    budget: path.join(root, 'scripts', 'arch-debt-budget.json')
  };
}

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

const PG_SYSTEM_RE = /^(pg_|information_schema$|columns$|age$)/;
const DOCTRINE_INVARIANTS = new Set(['resolve_before_behavior_change']);
const INFRA_TABLES = new Set(['schema_migrations']);

// Cherche un CREATE TABLE|VIEW <token> dans migrations/*.sql et
// migrations/scheduled/*.sql. Retourne le nom de fichier si trouve, sinon
// null. Volontairement simple (regex, pas de parseur SQL) : ce n'est qu'un
// indice de diagnostic pour le gate, jamais une source de verite.
function findLocalMigrationFor(token, root) {
  const dirs = [
    path.join(root, 'migrations'),
    path.join(root, 'migrations', 'scheduled')
  ];
  const re = new RegExp(
    `create\\s+(table|view)\\s+(if\\s+not\\s+exists\\s+)?(?:"?public"?\\.)?"?${token}"?\\b`,
    'i'
  );
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.sql')) continue;
      const full = path.join(dir, f);
      let content;
      try { content = fs.readFileSync(full, 'utf8'); } catch { continue; }
      if (re.test(content)) return path.relative(root, full);
    }
  }
  return null;
}

function readOrThrow(p, label) {
  if (!fs.existsSync(p)) {
    const err = new Error(`${label} absent (${p}).`);
    err.code = 'ENOENT_INPUT';
    throw err;
  }
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

/**
 * Variante lecture/ecriture de extractSqlTableRefs : meme scan (fichier entier,
 * commentaires retires, CTE exclus), mais separe les tables LUES (FROM/JOIN/USING)
 * des tables ECRITES (INSERT INTO / UPDATE / DELETE FROM). Source unique utilisee par
 * l'enrichisseur (pour remplir @db-read/@db-write) ET par le controle (union = refs).
 */
function extractSqlTableRefsRW(source) {
  let s = String(source);
  s = s.replace(/\/\*[\s\S]*?\*\//g, ' ');   // bloc JS (inclut le header)
  s = s.replace(/\/\/[^\n]*/g, ' ');          // ligne JS
  s = s.replace(/--[^\n]*/g, ' ');            // ligne SQL

  const cte = new Set();
  let m;
  const cteRe = /\b(?:with|,)\s+([a-z_][a-z0-9_]*)\s+as\s*\(/gi;
  while ((m = cteRe.exec(s)) !== null) cte.add(m[1].toLowerCase());

  const reads = new Set();
  const writes = new Set();
  const tbl = '"?(?:public\\.)?"?([a-z_][a-z0-9_]*)"?';
  const grab = (re, set) => {
    let mm;
    while ((mm = re.exec(s)) !== null) {
      const t = mm[1].toLowerCase();
      if (!cte.has(t)) set.add(t);
    }
  };
  grab(new RegExp(`\\bfrom\\s+${tbl}`, 'gi'), reads);
  grab(new RegExp(`\\bjoin\\s+${tbl}`, 'gi'), reads);
  grab(new RegExp(`\\busing\\s+${tbl}`, 'gi'), reads);
  grab(new RegExp(`\\binsert\\s+into\\s+${tbl}`, 'gi'), writes);
  grab(new RegExp(`\\bupdate\\s+(?:only\\s+)?${tbl}`, 'gi'), writes);
  grab(new RegExp(`\\bdelete\\s+from\\s+${tbl}`, 'gi'), writes);
  // DELETE FROM est aussi capture par le motif FROM -> retirer des reads ce qui est ecrit.
  for (const w of writes) reads.delete(w);
  return { reads, writes };
}

/**
 * Extrait les tables reellement referencees par le SQL STATIQUE d'un fichier source.
 * Union lecture+ecriture. Conservateur (commentaires/CTE retires) ; le consommateur
 * ANCRE ensuite sur les vraies tables live. SQL dynamique = @unknown assume.
 */
function extractSqlTableRefs(source) {
  const { reads, writes } = extractSqlTableRefsRW(source);
  return new Set([...reads, ...writes]);
}

/**
 * Sous-declaration : pour chaque fichier scanne, les tables LIVE reellement touchees
 * par son SQL statique doivent etre declarees dans @db-read / @db-write. Retourne les
 * manques (table touchee mais non declaree). Ancre sur les tables live -> tres peu de
 * faux positifs. Lecture seule, aucun exit.
 */
function analyzeHeaderSql(root = REPO_ROOT) {
  const P = paths(root);
  const live = parseLiveSchema(readOrThrow(P.liveSql, 'dump live'));
  const graph = JSON.parse(readOrThrow(P.graph, 'docs/komerce-arch-header-graph.json'));
  const nodes = (graph.nodes || []).filter(n => (n.type === 'file' || n.type === 'file-lite') && n.file);

  const findings = []; // { file, missing:[tables] }
  let totalUnder = 0;
  for (const n of nodes) {
    const abs = path.join(root, n.file);
    if (!fs.existsSync(abs)) continue;
    let src;
    try { src = fs.readFileSync(abs, 'utf8'); } catch { continue; }

    const declared = new Set([
      ...(n.dbRead || []),
      ...(n.dbWrite || [])
    ].map(t => String(t).toLowerCase().trim()));

    const refs = extractSqlTableRefs(src);
    const missing = [...refs]
      .filter(t => live.tables.has(t))   // ancrage : seulement de vraies tables live
      .filter(t => !declared.has(t))     // touchee par le code, absente du header
      .sort();

    if (missing.length) {
      findings.push({ file: n.file, missing });
      totalUnder += missing.length;
    }
  }
  findings.sort((a, b) => a.file.localeCompare(b.file));
  return { paths: P, findings, totalUnder };
}

/** Budget brut (objet complet, meta-cles comprises) — pour mutation par reconcile. */
function loadBudgetRaw(root = REPO_ROOT) {
  const p = paths(root).budget;
  if (!fs.existsSync(p)) return {};
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return {}; }
}

/** Allowlist normalisee (sans cles meta _*). */
function normalizeAllowlist(budgetRaw) {
  const out = {};
  for (const [k, v] of Object.entries((budgetRaw && budgetRaw.knownDriftAllowlist) || {})) {
    if (!k.startsWith('_')) out[k] = v;
  }
  return out;
}

/** Plafond cliquet courant (Infinity si non defini). */
function ratchetMaxOf(budgetRaw) {
  const r = budgetRaw && budgetRaw.ratchet && budgetRaw.ratchet.liveTablesUndocumented;
  return (typeof r === 'number') ? r : Infinity;
}

/**
 * Analyse complete, lecture seule. Retourne tout ce dont la porte et le
 * reconciliateur ont besoin. Ne lance jamais process.exit.
 */
function analyze(root = REPO_ROOT) {
  const P = paths(root);
  const live = parseLiveSchema(readOrThrow(P.liveSql, 'dump live'));
  const documented = parseDocumentedTokens(readOrThrow(P.schema, 'docs/SCHEMA.md'));
  const graph = JSON.parse(readOrThrow(P.graph, 'docs/komerce-arch-header-graph.json'));
  const headerTokens = parseHeaderTableTokens(graph);

  const budgetRaw = loadBudgetRaw(root);
  const allowlist = normalizeAllowlist(budgetRaw);
  const ratchetMax = ratchetMaxOf(budgetRaw);

  // FICTION : header nomme une table absente de TOUT objet live.
  const fiction = [];
  for (const [tok, files] of [...headerTokens.entries()].sort()) {
    if (!live.all.has(tok)) {
      fiction.push({
        token: tok,
        files: [...files].sort(),
        allowed: Object.prototype.hasOwnProperty.call(allowlist, tok)
      });
    }
  }
  const fictionTokens = new Set(fiction.map(f => f.token));
  // Une reference header vers une table creee par une migration locale mais
  // absente du dump live est une intention de deploiement (Mode B), pas une
  // fiction a masquer dans une allowlist. Elle reste visible dans le rapport
  // et schema-refresh alerte si le deploy tarde.
  const fictionMigrationHints = new Map();
  const fictionPendingMigration = [];
  const fictionUnlisted = [];
  for (const f of fiction.filter(f => !f.allowed)) {
    const hit = findLocalMigrationFor(f.token, root);
    if (hit) {
      fictionMigrationHints.set(f.token, hit);
      fictionPendingMigration.push(f);
    } else {
      fictionUnlisted.push(f);
    }
  }
  // Entrees d'allowlist qui ne correspondent plus a aucune fiction = RESOLUES.
  const allowlistResolved = Object.keys(allowlist).filter(tok => !fictionTokens.has(tok));

  // FANTOME : SCHEMA.md catalogue un nom absent de tout objet live.
  const ghosts = [...documented].filter(tok => !live.all.has(tok)).sort();

  // Aide au diagnostic : un fantome correspond-il a un CREATE TABLE/VIEW
  // trouvable dans une migration locale pas encore en live ? Si oui, c'est
  // tres probablement une declaration prematuree (ligne de tableau directe
  // au lieu d'un bloc <!-- schema-pending -->), pas une vraie derive.
  const ghostMigrationHints = new Map();
  for (const tok of ghosts) {
    const hit = findLocalMigrationFor(tok, root);
    if (hit) ghostMigrationHints.set(tok, hit);
  }

  // NON-DOCUMENTE : table BASE live hors catalogue SCHEMA.md (hors infra).
  const undocumented = [...live.tables]
    .filter(tbl => !documented.has(tbl) && !INFRA_TABLES.has(tbl))
    .sort();

  return {
    paths: P,
    live, documented, headerTokens,
    budgetRaw, allowlist, ratchetMax,
    fiction, fictionTokens, fictionUnlisted, fictionPendingMigration, fictionMigrationHints, allowlistResolved,
    ghosts, ghostMigrationHints, undocumented
  };
}

module.exports = {
  REPO_ROOT, paths,
  SQL_NOISE, PG_SYSTEM_RE, DOCTRINE_INVARIANTS, INFRA_TABLES,
  parseLiveSchema, parseDocumentedTokens, parseHeaderTableTokens,
  extractSqlTableRefs, extractSqlTableRefsRW, analyzeHeaderSql,
  loadBudgetRaw, normalizeAllowlist, ratchetMaxOf,
  analyze
};
