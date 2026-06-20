#!/usr/bin/env node
'use strict';

/**
 * gen-meta-graph.js — Méta-graphe des COUTURES entre les 3 territoires.
 *
 *   Coud les 3 cartes générées (frères) autour de la clé de voûte = le contrat OpenAPI :
 *     • Backend   : docs/komerce-arch-header-graph.json  (routes → services → tables)
 *     • Boutique  : docs/BOUTIQUE_360.json                (modules → endpoints)
 *     • Dashboards: docs/DASHBOARDS_360.json              (vues → KmcApi → endpoints)
 *
 *   Pour chaque endpoint consommé, on remonte la chaîne complète grâce à `x-route-file`
 *   du contrat : endpoint → route backend → services (depends) → tables (dbRead/dbWrite).
 *   On obtient le rayon de casse réel : « si je touche cette table / cette route / cet
 *   endpoint, QUI casse — backend, boutique, dashboards ? ».
 *
 *   Sorties : docs/META_GRAPH.json + docs/META_GRAPH.md
 *
 * Modes : (défaut) génère · --check (cliquet) · --save (fige baseline)
 *
 * Invariants (cliquet sur .meta-graph-baseline.json) :
 *   • couture fantôme : un front appelle un endpoint absent du contrat (NOT_FOUND).
 *   Pré-existants gelés ; nouvelle couture fantôme = exit 1. Le reste est informatif
 *   (endpoints partagés = rayon de casse amplifié, signalé mais jamais bloquant).
 */

const fs   = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DOCS = path.join(ROOT, 'docs');
const F_BACKEND = path.join(DOCS, 'komerce-arch-header-graph.json');
const F_BTQ     = path.join(DOCS, 'BOUTIQUE_360.json');
const F_DASH    = path.join(DOCS, 'DASHBOARDS_360.json');
const F_OPENAPI = path.join(DOCS, 'contract', 'openapi.json');
const OUT_JSON  = path.join(DOCS, 'META_GRAPH.json');
const OUT_MD    = path.join(DOCS, 'META_GRAPH.md');
const BASELINE  = path.join(__dirname, '.meta-graph-baseline.json');

const args = process.argv.slice(2);
const CHECK = args.includes('--check'), SAVE = args.includes('--save');
const RED='\x1b[31m',GRN='\x1b[32m',YLW='\x1b[33m',CYN='\x1b[36m',BLD='\x1b[1m',DIM='\x1b[2m',R='\x1b[0m';

const norm = p => p.replace(/[?#].*$/,'').replace(/\$\{[^}]+\}/g,'{id}').replace(/\{[^}]+\}/g,'{id}').replace(/\/+$/,'') || '/';

function load(f, label) {
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); }
  catch { console.error(`${RED}✖ Carte manquante : ${label} (${path.relative(ROOT,f)}). Régénère-la d'abord.${R}`); process.exit(2); }
}

function build() {
  const backend = load(F_BACKEND, 'backend');
  const btq     = load(F_BTQ, 'boutique');
  const dash    = load(F_DASH, 'dashboards');
  const openapi = load(F_OPENAPI, 'contrat OpenAPI');

  // ── Index backend : route-file -> node (services + tables en profondeur) ──
  const nodeByFile = {};
  backend.nodes.forEach(n => { nodeByFile[n.file] = n; });
  const routeDepth = (routeFile) => {
    const n = nodeByFile[routeFile];
    if (!n) return { services: [], tables: [] };
    const services = (n.depends || []).filter(d => /^services\//.test(d));
    const tables = [...new Set([...(n.dbRead || []), ...(n.dbWrite || [])])];
    return { services, tables, domain: n.domain, criticality: n.criticality };
  };

  // ── Contrat : endpoint normalisé -> { routeFile, status } ──
  const contractByPath = {};   // path -> { routeFile, statuses:Set }
  for (const [route, methods] of Object.entries(openapi.paths || {})) {
    const np = norm(route);
    for (const def of Object.values(methods || {})) {
      const e = contractByPath[np] = contractByPath[np] || { routeFile: null, status: 'UNKNOWN' };
      if (def && def['x-route-file']) e.routeFile = def['x-route-file'];
      if (def && def['x-contract-status'] === 'PROVEN') e.status = 'PROVEN';
    }
  }

  // ── Coutures front → endpoint ──
  const endpoints = {};   // path -> { boutique:Set, dashboards:Set, status, routeFile }
  const ep = p => (endpoints[p] = endpoints[p] || { boutique: new Set(), dashboards: new Set(), inContract: false, routeFile: null, status: 'NOT_FOUND' });

  (btq.callEdges || []).filter(e => !e.dynamic).forEach(e => {
    const p = norm(e.route); const x = ep(p); x.boutique.add(e.module);
  });
  (dash.callEdges || []).filter(e => !e.dynamic && e.route).forEach(e => {
    const p = norm(e.route); const x = ep(p); x.dashboards.add(e.view || e.module);
  });
  // statut + profondeur depuis le contrat
  for (const [p, x] of Object.entries(endpoints)) {
    const c = contractByPath[p];
    if (c) { x.inContract = true; x.routeFile = c.routeFile; x.status = c.status; }
    else   { x.inContract = false; x.status = 'NOT_FOUND'; }
  }

  // ── Diagnostics de couture ──
  const shared = [];     // appelés par les 2 fronts
  const phantom = [];    // appelés par un front, absents du contrat
  for (const [p, x] of Object.entries(endpoints)) {
    if (x.boutique.size && x.dashboards.size) shared.push(p);
    if (!x.inContract) phantom.push(p);
  }
  shared.sort(); phantom.sort();

  // ── Rayon de casse : table -> fronts/routes qui la touchent ──
  const tableBlast = {};   // table -> { routes:Set, boutique:Set, dashboards:Set }
  for (const [p, x] of Object.entries(endpoints)) {
    if (!x.routeFile) continue;
    const { tables } = routeDepth(x.routeFile);
    tables.forEach(t => {
      const b = tableBlast[t] = tableBlast[t] || { routes: new Set(), boutique: new Set(), dashboards: new Set() };
      b.routes.add(x.routeFile);
      x.boutique.forEach(m => b.boutique.add(m));
      x.dashboards.forEach(v => b.dashboards.add(v));
    });
  }
  // tables touchées par les DEUX fronts = rayon maximal
  const sharedTables = Object.entries(tableBlast)
    .filter(([, b]) => b.boutique.size && b.dashboards.size)
    .map(([t]) => t).sort();

  const serialEndpoints = {};
  for (const [p, x] of Object.entries(endpoints)) {
    const d = x.routeFile ? routeDepth(x.routeFile) : { services: [], tables: [] };
    serialEndpoints[p] = {
      boutique: [...x.boutique].sort(), dashboards: [...x.dashboards].sort(),
      inContract: x.inContract, status: x.status, routeFile: x.routeFile,
      services: d.services, tables: d.tables,
    };
  }

  return {
    generatedAt: new Date().toISOString(),
    sources: {
      backend: { nodes: backend.nodes.length },
      boutique: { modules: btq.summary.modules, endpoints: btq.summary.endpoints },
      dashboards: { modules: dash.summary.modules, callEdges: (dash.callEdges || []).length },
      contract: { endpoints: Object.keys(openapi.paths || {}).length },
    },
    summary: {
      endpointsConsumed: Object.keys(endpoints).length,
      sharedEndpoints: shared.length,
      phantomSeams: phantom.length,
      sharedTables: sharedTables.length,
    },
    endpoints: serialEndpoints,
    diagnostics: { sharedEndpoints: shared, phantomSeams: phantom, sharedTables },
    tableBlast: Object.fromEntries(Object.entries(tableBlast).map(([t, b]) => [t, {
      routes: [...b.routes].sort(), boutique: [...b.boutique].sort(), dashboards: [...b.dashboards].sort(),
    }])),
  };
}

function renderMermaid(m) {
  const L = ['```mermaid', 'graph TD', '  subgraph FRONTS', '    direction LR'];
  const safe = s => s.replace(/[^\w]/g, '_');
  // on ne montre que le sous-ensemble à fort signal : endpoints partagés + fantômes
  const show = new Set([...m.diagnostics.sharedEndpoints, ...m.diagnostics.phantomSeams]);
  L.push('  end');
  for (const p of show) {
    const e = m.endpoints[p];
    const epNode = safe('ep_' + p);
    const label = e.inContract ? p : (p + ' ❌');
    if (e.routeFile) L.push(`  ${epNode}["${label}"] --> ${safe('rt_' + e.routeFile)}["${e.routeFile}"]`);
    else L.push(`  ${epNode}["${label}"]:::phantom`);
    if (e.boutique.length) L.push(`  BTQ((boutique)) -->|${e.boutique.length}| ${epNode}`);
    if (e.dashboards.length) L.push(`  DASH((dashboards)) -->|${e.dashboards.length}| ${epNode}`);
  }
  L.push('  classDef phantom fill:#fdd,stroke:#c00;');
  L.push('```');
  return L.join('\n');
}

function renderMd(m) {
  const s = m.summary, src = m.sources, L = [];
  L.push('# Méta-graphe des coutures — les 3 territoires');
  L.push('');
  L.push('> ⚠️ Généré par `scripts/gen-meta-graph.js`. Ne pas éditer à la main.');
  L.push(`> Régénéré le ${m.generatedAt}.`);
  L.push('> Clé de voûte : le contrat OpenAPI. Chaque endpoint consommé est remonté');
  L.push('> jusqu\'à sa route backend → services → tables (`x-route-file`).');
  L.push('');
  L.push('## Sources cousues');
  L.push('');
  L.push(`- Backend : **${src.backend.nodes}** nœuds · Contrat : **${src.contract.endpoints}** endpoints`);
  L.push(`- Boutique : **${src.boutique.modules}** modules, ${src.boutique.endpoints} endpoints`);
  L.push(`- Dashboards : **${src.dashboards.modules}** modules, ${src.dashboards.callEdges} arêtes d'appel`);
  L.push('');
  L.push('## Synthèse des coutures');
  L.push('');
  L.push(`- Endpoints consommés par au moins un front : **${s.endpointsConsumed}**`);
  L.push(`- 🔗 Endpoints **partagés** (boutique + dashboards) : **${s.sharedEndpoints}** — rayon de casse amplifié`);
  L.push(`- 🔴 Coutures **fantômes** (front → hors contrat) : **${s.phantomSeams}**`);
  L.push(`- ⚠️ Tables touchées par **les deux** fronts : **${s.sharedTables}**`);
  L.push('');
  L.push('## 1. Endpoints partagés — toucher = casse double');
  L.push('');
  L.push('| Endpoint | Route backend | Boutique | Dashboards | Tables |');
  L.push('|---|---|---|---|---|');
  for (const p of m.diagnostics.sharedEndpoints) {
    const e = m.endpoints[p];
    L.push(`| \`${p}\` | ${e.routeFile ? '`'+e.routeFile+'`' : '—'} | ${e.boutique.join(', ')} | ${e.dashboards.join(', ')} | ${e.tables.map(t=>'`'+t+'`').join(', ') || '—'} |`);
  }
  L.push('');
  if (m.diagnostics.phantomSeams.length) {
    L.push('## 2. Coutures fantômes (à trancher)');
    L.push('');
    L.push('Endpoints appelés par un front mais absents du contrat backend — route legacy non nettoyée, ou bug qui couve (classe `.orders` / `getCosting`).');
    L.push('');
    L.push('| Endpoint | Appelé par |');
    L.push('|---|---|');
    for (const p of m.diagnostics.phantomSeams) {
      const e = m.endpoints[p];
      const who = [...e.boutique.map(x=>'boutique:'+x), ...e.dashboards.map(x=>'dashboards:'+x)].join(', ');
      L.push(`| \`${p}\` ❌ | ${who} |`);
    }
    L.push('');
  }
  if (m.diagnostics.sharedTables.length) {
    L.push('## 3. Tables à rayon de casse maximal (lues/écrites pour les 2 fronts)');
    L.push('');
    L.push('| Table | Routes | Modules boutique | Vues dashboards |');
    L.push('|---|---|---|---|');
    for (const t of m.diagnostics.sharedTables) {
      const b = m.tableBlast[t];
      L.push(`| \`${t}\` | ${b.routes.length} | ${b.boutique.length} | ${b.dashboards.length} |`);
    }
    L.push('');
  }
  L.push('## 4. Carte des coutures (partagés + fantômes)');
  L.push('');
  L.push(renderMermaid(m));
  L.push('');
  L.push('---');
  L.push('*Vérifié en pre-commit par `meta:graph:check` (cliquet sur les coutures fantômes).*');
  return L.join('\n') + '\n';
}

function loadBaseline() { try { return JSON.parse(fs.readFileSync(BASELINE, 'utf8')); } catch { return null; } }

function runCheck(m) {
  const base = loadBaseline();
  if (!base) { console.error(`${RED}${BLD}✖ Aucune baseline méta.${R} Lance : node scripts/gen-meta-graph.js --save`); return 1; }
  const set = new Set(base.phantomSeams || []);
  const news = m.diagnostics.phantomSeams.filter(p => !set.has(p));
  const drops = (base.phantomSeams || []).filter(p => !m.diagnostics.phantomSeams.includes(p));
  console.log(`${BLD}Méta — ${m.summary.endpointsConsumed} endpoints, ${m.summary.sharedEndpoints} partagés, ${m.summary.phantomSeams} fantômes${R}`);
  if (drops.length) { console.log(`${DIM}  Coutures fantômes résolues (fige avec --save) :${R}`); drops.forEach(p=>console.log(`${GRN}   ↓ ${p}${R}`)); }
  if (news.length === 0) { console.log(`${GRN}${BLD}✔ Aucune nouvelle couture fantôme.${R}`); return 0; }
  console.log(`${RED}${BLD}✖ ${news.length} nouvelle(s) couture(s) fantôme(s) :${R}`);
  news.forEach(p=>console.log(`${RED}   ↑ ${p} (front → endpoint absent du contrat)${R}`));
  console.log(`${DIM}  Ajoute l'endpoint au contrat / corrige l'appel, ou fige : npm run meta:graph:save${R}`);
  return 1;
}

const model = build();
if (SAVE) {
  fs.writeFileSync(BASELINE, JSON.stringify({ phantomSeams: model.diagnostics.phantomSeams, sharedEndpoints: model.diagnostics.sharedEndpoints, savedAt: new Date().toISOString() }, null, 2));
  fs.writeFileSync(OUT_JSON, JSON.stringify(model, null, 2)); fs.writeFileSync(OUT_MD, renderMd(model));
  console.log(`${GRN}${BLD}✔ Baseline méta figée${R} (${model.diagnostics.phantomSeams.length} couture(s) fantôme(s), ${model.diagnostics.sharedEndpoints.length} partagé(s)).`);
  process.exit(0);
}
if (CHECK) process.exit(runCheck(model));
fs.writeFileSync(OUT_JSON, JSON.stringify(model, null, 2)); fs.writeFileSync(OUT_MD, renderMd(model));
console.log(`${GRN}${BLD}✔ META_GRAPH généré${R} ${DIM}(${model.summary.endpointsConsumed} endpoints, ${model.summary.sharedEndpoints} partagés, ${model.summary.phantomSeams} fantômes, ${model.summary.sharedTables} tables 2-fronts)${R}`);
console.log(`${CYN}  docs/META_GRAPH.md${R} + ${CYN}docs/META_GRAPH.json${R}`);
