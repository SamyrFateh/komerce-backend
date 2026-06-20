#!/usr/bin/env node
'use strict';

/**
 * gen-dashboards-360.js — Carte 360 des dashboards admin (pendant front du graphe backend).
 *
 *   Le graphe backend (KOMERCE_ARCH_HEADER_GRAPH) raisonne en imports + tables + routes.
 *   La boutique se couple par un BUS D'ÉVÉNEMENTS (cf. gen-boutique-360.js).
 *   Les dashboards admin se couplent ENCORE AUTREMENT : ni bus, ni imports profonds.
 *   Leur système nerveux est une chaîne à 3 maillons :
 *
 *     ROUTE (app.js)  →  VUE (views/*.js)  →  KmcApi.method()  →  api-client.js  →  endpoint backend
 *                                                                                          ↓
 *                                                                     docs/contract/openapi.json
 *                                                                     (PROVEN si couvert par un test,
 *                                                                      UNKNOWN sinon — jamais inventé)
 *
 *   Ce générateur trace cette chaîne de bout en bout et produit une carte FRONT-NATIVE qui fusionne :
 *     • le routeur SPA (quelle vue sur quel path, pour quels rôles/shell) ;
 *     • les modules JS (header @komerce-arch : rôle, domaine, couche, criticité, doctrine) ;
 *     • le graphe d'appel vue → KmcApi.method() ;
 *     • le contrat API.client → endpoint backend réel ;
 *     • le statut de preuve de chaque endpoint (PROVEN / UNKNOWN), lu dans le contrat OpenAPI backend.
 *
 *   Sorties :
 *     docs/DASHBOARDS_360.json   ← carte machine (pour tooling)
 *     docs/DASHBOARDS_360.md     ← carte lisible (tables + diagramme Mermaid)
 *
 * Modes :
 *   node scripts/gen-dashboards-360.js            → (re)génère les deux fichiers
 *   node scripts/gen-dashboards-360.js --check    → vérifie les invariants (cliquet), exit 1 si régression
 *   node scripts/gen-dashboards-360.js --save     → fige l'état courant comme baseline
 *
 * Invariants (cliquet sur .dashboards-360-baseline.json) :
 *   • route orpheline     : une route déclare une `view` dont le fichier n'existe pas ;
 *   • méthode API morte   : exportée par KmcApi, appelée par aucune vue ;
 *   • méthode API absente : appelée par une vue mais non exportée par KmcApi (= crash JS garanti) ;
 *   • doctrine violée     : fichier qui déclare `@doctrine kmc_api_only` mais contient un fetch() brut ;
 *   • contrat non prouvé  : endpoint appelé dont openapi.json dit UNKNOWN (signal, pas une erreur dure).
 *   Les cas pré-existants sont gelés ; seules les NOUVELLES occurrences bloquent (sauf contrat non prouvé,
 *   toujours juste informatif — voir §2).
 */

const fs   = require('fs');
const path = require('path');

const ROOT          = path.resolve(__dirname, '..');
const JS_DIR         = path.join(ROOT, 'dashboards/admin/js');
const VIEWS_DIR       = path.join(JS_DIR, 'views');
const APP_FILE        = path.join(JS_DIR, 'app.js');
const API_CLIENT_FILE = path.join(JS_DIR, 'api-client.js');
const OPENAPI_FILE    = path.join(ROOT, 'docs/contract/openapi.json');
const DOCS            = path.join(ROOT, 'docs');
const OUT_JSON         = path.join(DOCS, 'DASHBOARDS_360.json');
const OUT_MD           = path.join(DOCS, 'DASHBOARDS_360.md');
const BASELINE         = path.join(__dirname, '.dashboards-360-baseline.json');

const args  = process.argv.slice(2);
const CHECK = args.includes('--check');
const SAVE  = args.includes('--save');

const RED='\x1b[31m', GRN='\x1b[32m', YLW='\x1b[33m', CYN='\x1b[36m', MAG='\x1b[35m', BLD='\x1b[1m', DIM='\x1b[2m', R='\x1b[0m';

// ── Helpers communs (mêmes conventions que gen-boutique-360.js) ─────────────
function stripBlockComments(s) { return s.replace(/\/\*[\s\S]*?\*\//g, ''); }

function headerField(header, field) {
  const re = new RegExp('@' + field + '\\s+([^\\n]+)');
  const m = header.match(re);
  if (!m) return null;
  const val = m[1].trim();
  return val === '@unknown' ? null : val;
}
function headerList(header, field) {
  const v = headerField(header, field);
  if (!v) return [];
  return v.split(',').map(s => s.trim()).filter(Boolean);
}

function walk(dir, acc) {
  if (!fs.existsSync(dir)) return acc;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'dist' || e.name === 'node_modules') continue;
      walk(full, acc);
    } else if (e.name.endsWith('.js') && !e.name.endsWith('.test.js')) {
      acc.push(full);
    }
  }
  return acc;
}

// ── 1. Collecte des modules JS (headers + doctrine + fetch brut) ────────────
function collectModules() {
  const files = walk(JS_DIR, []);
  const modules = [];
  for (const f of files) {
    const rel  = path.relative(JS_DIR, f).replace(/\\/g, '/');
    const raw  = fs.readFileSync(f, 'utf8');
    const code = stripBlockComments(raw);
    const hmFull = raw.match(/@komerce-arch\b[\s\S]*?\*\//);
    const hmLite = raw.match(/@komerce-arch-lite\b[\s\S]*?\*\//);
    const header = hmFull ? hmFull[0] : (hmLite ? hmLite[0] : '');
    const isLite = !!hmLite && !hmFull;

    // appels KmcApi.xxx( dans le corps du fichier
    const apiCalls = [...code.matchAll(/KmcApi\.(\w+)\s*\(/g)].map(m => m[1]);

    // fetch() brut hors api-client.js lui-même (les vues ne devraient jamais le faire)
    const rawFetches = rel === 'api-client.js' ? [] : [...code.matchAll(/\bfetch\s*\(/g)];

    modules.push({
      file: rel,
      id: path.basename(rel).replace(/\.js$/, ''),
      hasHeader:   !!header,
      isLite,
      role:        header ? headerField(header, 'role') : null,
      domain:      header ? headerField(header, 'domain') : null,
      layer:       header ? headerField(header, 'layer') : null,
      criticality: header ? headerField(header, 'criticality') : null,
      owner:       header ? headerField(header, 'owner') : null,
      doctrine:    header ? headerList(header, 'doctrine') : [],
      depends:     header ? headerList(header, 'depends') : [],
      usedBy:      header ? headerList(header, 'used-by') : [],
      apiCalls:    [...new Set(apiCalls)],
      rawFetchCount: rawFetches.length,
    });
  }
  return modules.sort((a, b) => a.file.localeCompare(b.file));
}

// ── 2. Collecte du routeur SPA (app.js → table ROUTES) ───────────────────────
function parseRoutes() {
  if (!fs.existsSync(APP_FILE)) return [];
  const raw = fs.readFileSync(APP_FILE, 'utf8');
  const routes = [];
  // { path: '/admin/x', view: 'XView', label: '...', icon: '...', shell: 'ct'|'bo', section: '...', roles: [...] }
  const re = /\{\s*path:\s*'([^']+)'\s*,\s*view:\s*'([^']+)'[^}]*?shell:\s*'([^']+)'[^}]*?\}/g;
  let m;
  while ((m = re.exec(raw)) !== null) {
    const block = m[0];
    const rolesMatch = block.match(/roles:\s*\[([^\]]*)\]/);
    const roles = rolesMatch
      ? rolesMatch[1].split(',').map(s => s.trim().replace(/['"]/g, '')).filter(Boolean)
      : null; // null = tous les rôles du shell
    routes.push({ path: m[1], view: m[2], shell: m[3], roles });
  }
  return routes;
}

// ── 3. Collecte des méthodes KmcApi exportées + résolution d'URL ────────────
// Couvre aussi les patches dynamiques post-chargement (ex: api-client-unsold.js
// fait `global.KmcApi.getUnsoldStats = async function () {...}` après coup —
// cf. carte-360-dashboards.md, faux positif déjà identifié manuellement sur ce cas).
function parsePatchFiles() {
  const patched = [];
  const files = walk(JS_DIR, []).filter(f => path.basename(f) !== 'api-client.js');
  for (const f of files) {
    const raw = fs.readFileSync(f, 'utf8');
    for (const m of raw.matchAll(/global\.KmcApi\.(\w+)\s*=/g)) patched.push(m[1]);
  }
  return [...new Set(patched)];
}

// Noms exportés par KmcApi qui ne sont pas des appels d'endpoint (utilitaires/classes)
// — ne doivent jamais être comptés comme "méthode API morte".
const NON_API_EXPORTS = new Set(['ApiError', 'clearCache']);

function parseApiClient() {
  if (!fs.existsSync(API_CLIENT_FILE)) return { methods: {}, exportedNames: [] };
  const raw = fs.readFileSync(API_CLIENT_FILE, 'utf8');

  // bases d'URL : const BASE_X = '/api/...'
  const bases = {};
  for (const m of raw.matchAll(/const\s+(BASE_\w+)\s*=\s*'([^']+)'/g)) bases[m[1]] = m[2];

  // helpers d'URL : function xUrl(endpoint, ...) { ... return `${BASE_Y}/${endpoint}...` }
  // on associe nom de helper -> base utilisée, par recherche du ${BASE_X} dans son corps
  const helperBase = {};
  for (const m of raw.matchAll(/function\s+(\w*[Uu]rl)\s*\([^)]*\)\s*\{([\s\S]*?)\n\s{2}\}/g)) {
    const [, name, body] = m;
    const baseRef = body.match(/\$\{(BASE_\w+)\}/);
    if (baseRef && bases[baseRef[1]]) helperBase[name] = bases[baseRef[1]];
  }

  // déclarations de fonctions : une ligne (`function f() { ... }` sur une seule ligne — ~moitié
  // du fichier réel) ou multi-lignes (corps jusqu'à la première `  }` en fin de ligne, indentation
  // de fermeture à 2 espaces = niveau module). Les deux formes coexistent en nombre significatif ;
  // un seul regex hybride sur les deux échoue silencieusement sur l'une des deux (vécu : un match
  // multi-lignes "mangeait" le one-liner suivant et lui volait son corps).
  const methods = {};
  const lines = raw.split('\n');
  const fnStartRe = /^\s*function\s+(\w+)\s*\(([^)]*)\)\s*\{(.*)$/;
  for (let i = 0; i < lines.length; i++) {
    const startMatch = lines[i].match(fnStartRe);
    if (!startMatch) continue;
    const [, name, , restOfLine] = startMatch;
    let body;
    if (/\}\s*$/.test(restOfLine)) {
      // one-liner : corps entier sur cette ligne
      body = restOfLine;
    } else {
      // multi-lignes : accumule jusqu'à la fermeture au niveau module (exactement "  }")
      const bodyLines = [restOfLine];
      let j = i + 1;
      while (j < lines.length && !/^\s{2}\}\s*$/.test(lines[j])) {
        bodyLines.push(lines[j]);
        j++;
      }
      body = bodyLines.join('\n');
    }

    let route = null;
    let dynamic = false; // route construite par concaténation (id, paramètre…) — segment fixe seul, non comparable tel quel au contrat
    const callMatch = body.match(/(\w*[Uu]rl)\(\s*'([^']*)'\s*([,)+])/);
    if (callMatch) {
      const [, helperName, literalSeg, sep] = callMatch;
      const base = helperBase[helperName];
      if (base) {
        route = `${base}/${literalSeg}`.replace(/\/{2,}/g, '/').replace(/\/$/, '') || `${base}`;
        if (sep === '+') dynamic = true;
      }
    } else {
      const apiUrlMatch = body.match(/apiUrl\(\s*'([^']*)'\s*([,)+])/);
      if (apiUrlMatch && bases.BASE_API) {
        const [, literalSeg, sep] = apiUrlMatch;
        route = `${bases.BASE_API}${literalSeg}`.replace(/\/{2,}/g, '/');
        if (sep === '+') dynamic = true;
      }
    }
    const httpMethodMatch = body.match(/fetchMutation\([^,]+,\s*'(\w+)'/);
    methods[name] = {
      route, dynamic,
      httpMethod: httpMethodMatch ? httpMethodMatch[1] : 'GET',
    };
  }

  // bloc d'export effectif : global.KmcApi = { a, b, c, ... }
  const exportBlockMatch = raw.match(/global\.KmcApi\s*=\s*\{([\s\S]*?)\n\s{2}\};/);
  const exportedNames = [];
  if (exportBlockMatch) {
    for (const line of exportBlockMatch[1].split('\n')) {
      const cleaned = line.replace(/\/\/.*$/, '').trim().replace(/,$/, '');
      if (cleaned && /^\w+$/.test(cleaned)) exportedNames.push(cleaned);
    }
  }

  const patchedNames = parsePatchFiles();
  const exportedAll = [...new Set([...exportedNames, ...patchedNames])];

  return { methods, exportedNames: exportedAll, patchedNames };
}

// ── 4. Lecture du contrat OpenAPI backend (statut de preuve par endpoint) ───
function parseOpenApiContract() {
  if (!fs.existsSync(OPENAPI_FILE)) return {};
  try {
    const doc = JSON.parse(fs.readFileSync(OPENAPI_FILE, 'utf8'));
    const status = {};
    for (const [route, methodsObj] of Object.entries(doc.paths || {})) {
      for (const [httpMethod, def] of Object.entries(methodsObj)) {
        const key = `${httpMethod.toUpperCase()} ${route}`;
        status[key] = def['x-contract-status'] || 'UNKNOWN';
      }
    }
    return status;
  } catch {
    return {};
  }
}

// ── Construction du modèle ───────────────────────────────────────────────────
function build() {
  const modules     = collectModules();
  const routes      = parseRoutes();
  const apiClient    = parseApiClient();
  const contract      = parseOpenApiContract();

  const viewsById = {};
  for (const mod of modules) {
    if (mod.file.startsWith('views/')) viewsById[mod.id] = mod;
  }

  // ── Diagnostic 1 : routes orphelines (view déclarée, fichier absent) ──────
  const orphanRoutes = [];
  for (const r of routes) {
    if (!viewsById[r.view]) orphanRoutes.push(r.path + ' → ' + r.view);
  }

  // ── Diagnostic 2/3 : méthodes API mortes / absentes ────────────────────────
  const calledMethods = new Set();
  for (const mod of modules) mod.apiCalls.forEach(c => calledMethods.add(c));

  const deadApiMethods = apiClient.exportedNames.filter(n => !calledMethods.has(n) && !NON_API_EXPORTS.has(n));
  const missingApiMethods = [...calledMethods].filter(n => !apiClient.exportedNames.includes(n));

  // qui appelle quoi exactement (pour la table de cohérence et pour le diagramme)
  const callEdges = []; // { view, method, route, httpMethod, contractStatus }
  for (const mod of modules) {
    if (!mod.file.startsWith('views/')) continue;
    for (const methodName of mod.apiCalls) {
      const def = apiClient.methods[methodName];
      const route = def ? def.route : null;
      const httpMethod = def ? def.httpMethod : null;
      const isDynamic = def ? def.dynamic : false;
      let contractStatus;
      if (!route) {
        contractStatus = 'UNRESOLVED';
      } else if (isDynamic) {
        // route construite par concaténation (ex: '/admin/signals/' + id + '/acknowledge') :
        // le segment capturé est un préfixe fixe, pas le chemin réel — on ne le compare pas
        // au contrat (faux NOT_FOUND garanti), on le signale comme tel à la place.
        contractStatus = 'DYNAMIC';
      } else {
        contractStatus = contract[`${httpMethod} ${route}`] || 'NOT_FOUND';
      }
      callEdges.push({
        view: mod.id,
        method: methodName,
        defined: apiClient.exportedNames.includes(methodName),
        route, httpMethod, dynamic: isDynamic, contractStatus,
      });
    }
  }

  // ── Diagnostic 4 : doctrine kmc_api_only violée (fetch brut + doctrine déclarée) ──
  const doctrineViolations = modules
    .filter(m => m.doctrine.includes('kmc_api_only') && m.rawFetchCount > 0)
    .map(m => `${m.file} (${m.rawFetchCount} fetch() brut)`);

  // dette connue : fetch() brut SANS déclarer la doctrine (pas une violation au sens strict,
  // mais un écart au standard global — reporté séparément, jamais dans le cliquet bloquant)
  const rawFetchDebt = modules
    .filter(m => !m.doctrine.includes('kmc_api_only') && m.rawFetchCount > 0)
    .map(m => `${m.file} (${m.rawFetchCount} fetch() brut)`);

  // ── Diagnostic 5 : contrats non prouvés réellement utilisés ────────────────
  const unprovenContracts = [...new Set(
    callEdges.filter(e => e.contractStatus === 'UNKNOWN').map(e => `${e.httpMethod} ${e.route}`)
  )].sort();
  const notFoundContracts = [...new Set(
    callEdges.filter(e => e.contractStatus === 'NOT_FOUND' && e.route).map(e => `${e.httpMethod} ${e.route}`)
  )].sort();
  const unresolvedRoutes = [...new Set(
    callEdges.filter(e => e.contractStatus === 'UNRESOLVED').map(e => e.method)
  )].sort();
  const dynamicRoutes = [...new Set(
    callEdges.filter(e => e.contractStatus === 'DYNAMIC').map(e => `${e.method} (préfixe: ${e.httpMethod} ${e.route}/…)`)
  )].sort();

  const headerCoverage = {
    total: modules.length,
    full: modules.filter(m => m.hasHeader && !m.isLite).length,
    lite: modules.filter(m => m.isLite).length,
    missing: modules.filter(m => !m.hasHeader).length,
  };
  const liteMissingOwner = modules.filter(m => m.isLite && !m.owner).map(m => m.file);

  const byDomain = {};
  modules.forEach(m => { const d = m.domain || '(non typé)'; (byDomain[d] = byDomain[d] || []).push(m.file); });

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      modules: modules.length,
      routes: routes.length,
      apiMethodsExported: apiClient.exportedNames.length,
      apiMethodsCalled: calledMethods.size,
      orphanRoutes: orphanRoutes.length,
      deadApiMethods: deadApiMethods.length,
      missingApiMethods: missingApiMethods.length,
      doctrineViolations: doctrineViolations.length,
      unprovenContracts: unprovenContracts.length,
    },
    modules, routes, callEdges,
    headerCoverage, liteMissingOwner,
    diagnostics: {
      orphanRoutes: orphanRoutes.sort(),
      deadApiMethods: deadApiMethods.sort(),
      missingApiMethods: missingApiMethods.sort(),
      doctrineViolations: doctrineViolations.sort(),
      rawFetchDebt: rawFetchDebt.sort(),
      unprovenContracts,
      notFoundContracts,
      unresolvedRoutes,
      dynamicRoutes,
    },
    byDomain,
  };
}

// ── Rendu Markdown ───────────────────────────────────────────────────────────
function renderMermaid(model) {
  const lines = ['```mermaid', 'graph LR'];
  const safe = s => s.replace(/[^\w]/g, '_');
  const seen = new Set();
  for (const r of model.routes) {
    const key = `route|${r.path}|${r.view}`;
    if (seen.has(key)) continue; seen.add(key);
    lines.push(`  ${safe(r.path)}["${r.path}"] --> ${safe(r.view)}["${r.view}"]`);
  }
  for (const e of model.callEdges) {
    if (!e.route) continue;
    const key = `api|${e.view}|${e.method}`;
    if (seen.has(key)) continue; seen.add(key);
    const mark = e.contractStatus === 'UNKNOWN' ? '❓' : (e.defined ? '' : '🟡');
    lines.push(`  ${safe(e.view)} -->|${e.method}${mark}| ${safe(e.route)}["${e.route}"]`);
  }
  lines.push('```');
  return lines.join('\n');
}

function renderMd(model) {
  const s = model.summary;
  const L = [];
  L.push('# Dashboards 360 — carte d\'architecture admin (générée)');
  L.push('');
  L.push('> ⚠️ Fichier **généré** par `scripts/gen-dashboards-360.js`. Ne pas éditer à la main.');
  L.push(`> Régénéré le ${model.generatedAt}.`);
  L.push('> Pendant front du graphe backend : les dashboards se couplent par la chaîne **route → vue → KmcApi → endpoint → contrat**, pas par un bus ni par les imports.');
  L.push('');
  L.push('## Synthèse');
  L.push('');
  L.push(`- Modules JS : **${s.modules}** (${model.headerCoverage.full} header complet, ${model.headerCoverage.lite} lite, **${model.headerCoverage.missing} sans header**)`);
  L.push(`- Routes SPA : **${s.routes}**`);
  L.push(`- Méthodes \`KmcApi\` : **${s.apiMethodsExported}** exportées, ${s.apiMethodsCalled} appelées par au moins une vue`);
  L.push(`- Santé chaîne : ${s.orphanRoutes} route(s) orpheline(s), ${s.deadApiMethods} méthode(s) API morte(s), ${s.missingApiMethods} méthode(s) API absente(s) (crash garanti), ${s.doctrineViolations} violation(s) de doctrine`);
  L.push(`- Contrats non prouvés réellement appelés : **${s.unprovenContracts}** (signal de risque, cf. bug \`getOps()\`/\`.orders\`)`);
  L.push('');

  L.push('## 1. Routeur SPA → Vues');
  L.push('');
  L.push('| Route | Vue | Shell | Rôles | Fichier trouvé |');
  L.push('|---|---|---|---|---|');
  for (const r of model.routes) {
    const found = model.modules.some(m => m.file === `views/${r.view}.js`);
    L.push(`| \`${r.path}\` | ${r.view} | ${r.shell} | ${r.roles ? r.roles.join(', ') : 'tous'} | ${found ? '✅' : '🔴 manquant'} |`);
  }
  L.push('');

  L.push('## 2. Chaîne Vue → KmcApi → Endpoint → Contrat');
  L.push('');
  L.push('| Vue | Méthode appelée | Définie ? | Endpoint résolu | Statut contrat |');
  L.push('|---|---|---|---|---|');
  const sortedEdges = [...model.callEdges].sort((a, b) => a.view.localeCompare(b.view) || a.method.localeCompare(b.method));
  for (const e of sortedEdges) {
    const statusIcon = {
      PROVEN: '🟢 prouvé',
      UNKNOWN: '⚪ non prouvé',
      NOT_FOUND: '🔴 endpoint introuvable',
      UNRESOLVED: '❓ url non résolue',
      DYNAMIC: '🔵 url dynamique (non comparable)',
    }[e.contractStatus] || e.contractStatus;
    const routeDisplay = e.route ? '`' + e.httpMethod + ' ' + e.route + (e.dynamic ? '/…' : '') + '`' : '—';
    L.push(`| ${e.view} | \`${e.method}\` | ${e.defined ? '✅' : '🔴 NON — crash garanti'} | ${routeDisplay} | ${statusIcon} |`);
  }
  L.push('');
  L.push('### Diagramme');
  L.push('');
  L.push(renderMermaid(model));
  L.push('');

  const d = model.diagnostics;
  if (d.orphanRoutes.length || d.deadApiMethods.length || d.missingApiMethods.length || d.doctrineViolations.length) {
    L.push('## 3. Anomalies bloquantes (cliquet)');
    L.push('');
    if (d.orphanRoutes.length)      L.push(`- 🔴 **Routes orphelines** (vue introuvable) : ${d.orphanRoutes.map(e => '`'+e+'`').join(', ')}`);
    if (d.missingApiMethods.length) L.push(`- 🟡 **Méthodes API absentes** (appelées, non exportées — crash JS garanti) : ${d.missingApiMethods.map(e => '`'+e+'`').join(', ')}`);
    if (d.deadApiMethods.length)    L.push(`- 🟠 **Méthodes API mortes** (exportées, jamais appelées) : ${d.deadApiMethods.map(e => '`'+e+'`').join(', ')}`);
    if (d.doctrineViolations.length) L.push(`- 🟣 **Violations de doctrine \`kmc_api_only\`** (fetch() brut malgré la doctrine déclarée) : ${d.doctrineViolations.map(e => '`'+e+'`').join(', ')}`);
    L.push('');
  }

  if (d.unprovenContracts.length || d.notFoundContracts.length || d.unresolvedRoutes.length || d.dynamicRoutes.length || d.rawFetchDebt.length) {
    L.push('## 4. Signaux informatifs (non bloquants)');
    L.push('');
    if (d.unprovenContracts.length)  L.push(`- ⚪ **Contrats appelés mais non prouvés** (\`UNKNOWN\` dans openapi.json — aucun test d'intégration ne couvre la forme de réponse) : ${d.unprovenContracts.map(e => '`'+e+'`').join(', ')}`);
    if (d.notFoundContracts.length)  L.push(`- ❔ **Endpoints résolus mais absents du contrat OpenAPI** (à vérifier — route peut-être non montée ou contrat backend pas régénéré) : ${d.notFoundContracts.map(e => '`'+e+'`').join(', ')}`);
    if (d.dynamicRoutes.length)      L.push(`- 🔵 **URLs construites dynamiquement** (segment avec id/paramètre concaténé — non comparables au contrat tel quel, à vérifier à la main si besoin) : ${d.dynamicRoutes.map(e => '`'+e+'`').join(', ')}`);
    if (d.unresolvedRoutes.length)   L.push(`- ❓ **Méthodes API dont l'URL n'a pas pu être résolue statiquement** (à vérifier à la main) : ${d.unresolvedRoutes.map(e => '`'+e+'`').join(', ')}`);
    if (d.rawFetchDebt.length)       L.push(`- ⚠️ **fetch() brut sans doctrine déclarée** (écart au standard, pas une violation formelle) : ${d.rawFetchDebt.map(e => '`'+e+'`').join(', ')}`);
    L.push('');
  }

  L.push('## 5. Couverture des headers');
  L.push('');
  L.push(`Complet : **${model.headerCoverage.full}** · Lite : **${model.headerCoverage.lite}** · Sans header : **${model.headerCoverage.missing}**`);
  L.push('');
  if (model.headerCoverage.missing) {
    const missing = model.modules.filter(m => !m.hasHeader).map(m => m.file);
    L.push(`Fichiers sans header : ${missing.map(f => '`'+f+'`').join(', ')}`);
    L.push('');
  }
  if (model.liteMissingOwner.length) {
    L.push(`🔴 **Headers lite sans \`@owner\`** (non conforme à la doctrine) : ${model.liteMissingOwner.map(f => '`'+f+'`').join(', ')}`);
    L.push('');
  }

  L.push('## 6. Modules par domaine');
  L.push('');
  for (const dom of Object.keys(model.byDomain).sort()) {
    L.push(`### ${dom}`);
    L.push('');
    L.push('| Module | Rôle | Couche | Criticité | Doctrine |');
    L.push('|---|---|---|---|---|');
    for (const f of model.byDomain[dom]) {
      const m = model.modules.find(x => x.file === f);
      L.push(`| \`${m.file}\` | ${m.role || '—'} | ${m.layer || '—'} | ${m.criticality || '—'} | ${m.doctrine.join(', ') || '—'} |`);
    }
    L.push('');
  }

  L.push('---');
  L.push('*Carte vérifiée en pre-commit par `check:dashboards-360` (cliquet sur les anomalies bloquantes ; les signaux informatifs ne bloquent jamais).*');
  return L.join('\n') + '\n';
}

// ── Cliquet (même mécanique que gen-boutique-360.js) ─────────────────────────
function loadBaseline() { try { return JSON.parse(fs.readFileSync(BASELINE, 'utf8')); } catch { return null; } }

const RATCHET_KEYS = ['orphanRoutes', 'deadApiMethods', 'missingApiMethods', 'doctrineViolations'];

function runCheck(model) {
  const base = loadBaseline();
  if (!base) {
    console.error(`${RED}${BLD}✖ Aucune baseline 360.${R} Lance d'abord : node scripts/gen-dashboards-360.js --save`);
    return 1;
  }
  const d = model.diagnostics;
  const news = [];
  const diff = (key, label) => {
    const set = new Set(base[key] || []);
    for (const x of d[key]) if (!set.has(x)) news.push(`${label} : ${x}`);
  };
  diff('orphanRoutes',      '🔴 nouvelle route orpheline');
  diff('missingApiMethods', '🟡 nouvelle méthode API absente');
  diff('deadApiMethods',    '🟠 nouvelle méthode API morte');
  diff('doctrineViolations','🟣 nouvelle violation de doctrine');

  const drops = [];
  for (const key of RATCHET_KEYS) {
    const now = new Set(d[key]);
    for (const x of (base[key] || [])) if (!now.has(x)) drops.push(`${key} : ${x}`);
  }

  console.log(`${BLD}Dashboards 360 — ${model.summary.modules} modules, ${model.summary.routes} routes, ${model.summary.apiMethodsExported} méthodes API${R}`);
  if (model.summary.unprovenContracts) {
    console.log(`${DIM}  ⚪ ${model.summary.unprovenContracts} contrat(s) appelé(s) non prouvé(s) — informatif, voir §4 du rapport.${R}`);
  }
  if (drops.length) {
    console.log(`${DIM}  Anomalies résolues depuis la baseline (fige-les avec --save) :${R}`);
    drops.forEach(x => console.log(`${GRN}   ↓ ${x}${R}`));
  }
  if (news.length === 0) {
    console.log(`${GRN}${BLD}✔ Aucune nouvelle anomalie bloquante hors baseline.${R}`);
    return 0;
  }
  console.log(`${RED}${BLD}✖ ${news.length} nouvelle(s) anomalie(s) bloquante(s) :${R}`);
  news.forEach(x => console.log(`${RED}   ↑ ${x}${R}`));
  console.log(`${DIM}  Corrige (relie la chaîne route/vue/API, ou ajoute le header manquant),${R}`);
  console.log(`${DIM}  ou — si c'est légitime — fige : node scripts/gen-dashboards-360.js --save${R}`);
  return 1;
}

// ── Main ─────────────────────────────────────────────────────────────────────
const model = build();

if (SAVE) {
  const d = model.diagnostics;
  const baselineData = {};
  for (const key of RATCHET_KEYS) baselineData[key] = d[key];
  baselineData.savedAt = new Date().toISOString();
  fs.writeFileSync(BASELINE, JSON.stringify(baselineData, null, 2));
  if (!fs.existsSync(DOCS)) fs.mkdirSync(DOCS, { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify(model, null, 2));
  fs.writeFileSync(OUT_MD, renderMd(model));
  console.log(`${GRN}${BLD}✔ Baseline Dashboards 360 figée${R} (${d.orphanRoutes.length} route(s) orpheline(s), ${d.missingApiMethods.length} méthode(s) absente(s), ${d.deadApiMethods.length} méthode(s) morte(s), ${d.doctrineViolations.length} violation(s) doctrine).`);
  process.exit(0);
}

if (CHECK) {
  const code = runCheck(model);
  process.exit(code);
}

// génération
if (!fs.existsSync(DOCS)) fs.mkdirSync(DOCS, { recursive: true });
fs.writeFileSync(OUT_JSON, JSON.stringify(model, null, 2));
fs.writeFileSync(OUT_MD, renderMd(model));
console.log(`${GRN}${BLD}✔ DASHBOARDS_360 généré${R} ${DIM}(${model.summary.modules} modules, ${model.summary.routes} routes, ${model.summary.apiMethodsExported} méthodes API)${R}`);
console.log(`${CYN}  docs/DASHBOARDS_360.md${R}  +  ${CYN}docs/DASHBOARDS_360.json${R}`);
if (model.summary.orphanRoutes || model.summary.missingApiMethods || model.summary.deadApiMethods || model.summary.doctrineViolations) {
  console.log(`${YLW}  ⚠ ${model.summary.orphanRoutes} route(s) orpheline(s), ${model.summary.missingApiMethods} méthode(s) absente(s), ${model.summary.deadApiMethods} méthode(s) morte(s), ${model.summary.doctrineViolations} violation(s) doctrine — voir §3.${R}`);
}
if (model.summary.unprovenContracts) {
  console.log(`${MAG}  ⚪ ${model.summary.unprovenContracts} contrat(s) non prouvé(s) réellement appelé(s) — voir §4.${R}`);
}
