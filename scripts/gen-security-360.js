#!/usr/bin/env node
'use strict';
/**
 * @komerce-arch
 * @role          security-360-cartography
 * @domain        governance
 * @layer         tooling
 * @purpose       Carte de couverture sécurité. HYBRIDE : introspection runtime
 *                pour l'inventaire COMPLET des routes montées, analyse STATIQUE
 *                des chaînes de gardes pour récupérer authn + rôles (les gardes
 *                sont des factories `requireRole([...])` dont l'argument est
 *                invisible au runtime). Toute route que le statique ne couvre pas
 *                est marquée UNKNOWN (à auditer), jamais silencieusement "OK".
 * @outputs       docs/SECURITY_360.{json,md}, scripts/.security-360-baseline.json
 * @doctrine      cliquet ; jamais de faux négatif silencieux
 * @version       2026-06
 *
 * Usage: node scripts/gen-security-360.js [--check|--save]
 */
const fs = require('fs');
const path = require('path');
const express = require('express');

const MODE = process.argv.includes('--check') ? 'check'
           : process.argv.includes('--save') ? 'save' : 'gen';
const ROOT = path.join(__dirname, '..');
const DOCS = path.join(ROOT, 'docs');
const BASELINE = path.join(__dirname, '.security-360-baseline.json');
const { DISPOSITIONS, getDisposition, validateDispositions } = require('./security-360-dispositions');

const PUBLIC_OK = [
  /^\/api\/health$/, /^\/api\/public\//,
  /^\/api\/auth\/(login|register|refresh|forgot|reset|verify|logout|me)/,
  /^\/api\/auth\/passkey\/login\/(options|verify)$/,
  /\/stripe\/webhook/, /\/webhook(s)?(\/|$)/, /verify-qr/,
];
const norm = p => ('/' + p.split('/').filter(Boolean).join('/'))
  .replace(/:([A-Za-z0-9_]+)/g, '{$1}').replace(/\/+$/, '') || '/';
const read = f => { try { return fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch { return null; } };

// ── analyse STATIQUE des gardes (récupère authn + rôles) ─────────────────────
function tokens(s) {
  const out = { authn: false, roles: new Set(), admin: false };
  if (/\b(authenticate|softAuthenticate|requireInternalKey|authenticateOrCreateGuest)\b/.test(s)) out.authn = true;
  if (/\b(requireAdmin|requireAdminOrFounder)\b/.test(s)) { out.admin = true; out.authn = true; out.roles.add('admin'); }
  for (const r of s.matchAll(/requireRole\(\s*\[([^\]]*)\]/g)) {
    out.authn = true;
    r[1].split(',').forEach(x => { const v = x.trim().replace(/['"`]/g, ''); if (v) out.roles.add(v); });
  }
  return out;
}
function mergeInto(t, a) { t.authn = t.authn || a.authn; t.admin = t.admin || a.admin; a.roles.forEach(r => t.roles.add(r)); }


function cloneGuards(source) {
  return {
    authn: Boolean(source && source.authn),
    roles: new Set(source && source.roles ? source.roles : []),
    admin: Boolean(source && source.admin),
  };
}

function mergeAliasRefs(target, source, aliases) {
  for (const name of Object.keys(aliases)) {
    if (new RegExp('\\b' + name + '\\b').test(source)) mergeInto(target, aliases[name]);
  }
}

function parseGuardAliases(src) {
  const aliases = {};
  for (const m of src.matchAll(/(?:const|let)\s+(\w+)\s*=\s*\[([\s\S]*?)\]\s*;/g)) {
    const parsed = tokens(m[2]);
    if (parsed.authn || parsed.admin || parsed.roles.size) aliases[m[1]] = parsed;
  }
  for (const m of src.matchAll(/(?:const|let)\s+(\w+)\s*=\s*(requireRole\(\s*\[[\s\S]*?\]\s*\))\s*;/g)) {
    aliases[m[1]] = tokens(m[2]);
  }
  return aliases;
}

function findMatchingParen(src, openIndex) {
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let i = openIndex; i < src.length; i += 1) {
    const ch = src[i];
    if (quote) {
      if (escaped) { escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function collectRouterGuardUses(src, vEsc, aliases) {
  const uses = [];
  const re = new RegExp('\\b' + vEsc + '\\.use\\s*\\(', 'g');
  let match;
  while ((match = re.exec(src))) {
    const openIndex = src.indexOf('(', match.index);
    const closeIndex = findMatchingParen(src, openIndex);
    if (closeIndex < 0) break;
    const body = src.slice(openIndex + 1, closeIndex);
    const scoped = body.match(/^\s*(['"`])([^'"`]+)\1\s*,/);
    const scope = scoped ? norm(scoped[2]) : null;
    const chain = scoped ? body.slice(scoped[0].length) : body;
    const guard = tokens(chain);
    mergeAliasRefs(guard, chain, aliases);
    if (guard.authn || guard.admin || guard.roles.size) uses.push({ index: match.index, scope, guard });
    re.lastIndex = closeIndex + 1;
  }
  return uses;
}

function applyRouterUses(inherited, uses, routePath, sourceIndex) {
  const out = cloneGuards(inherited);
  const route = norm(routePath);
  for (const use of uses) {
    if (use.index >= sourceIndex) continue;
    if (use.scope && route !== use.scope && !route.startsWith(use.scope + '/')) continue;
    mergeInto(out, use.guard);
  }
  return out;
}

// renvoie {method, route} → guards, en suivant router.use sous-routeurs
// `varName` : nom de la variable routeur à analyser dans ce fichier (par défaut
// 'router'). Nécessaire car certains fichiers exportent plusieurs routeurs
// (router + adminRouter) avec des routes disjointes — analyser sous le mauvais
// nom revient à ne rien trouver (les regex étaient codées en dur sur 'router').
function staticGuards(routeFile, prefix, seen, acc, inherited, varName) {
  seen = seen || new Set(); acc = acc || [];
  inherited = inherited || { authn: false, roles: new Set(), admin: false };
  varName = varName || 'router';
  const vEsc = varName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (seen.has(routeFile + '@' + prefix + '@' + varName)) return acc; seen.add(routeFile + '@' + prefix + '@' + varName);
  const src = read(routeFile); if (!src) return acc;
  // re-export : module.exports = require('./x') → suivre
  const reexp = src.match(/module\.exports\s*=\s*require\(\s*['"]([^'"]+)['"]\s*\)/);
  if (reexp && /\.\//.test(reexp[1]) && !/router|express/.test(src.slice(0, reexp.index))) {
    let p = reexp[1].replace(/^\.\//, '');
    let sf = /^routes\//.test(p) ? p : path.normalize(path.join(path.dirname(routeFile), reexp[1])).replace(/\\/g, '/');
    if (!sf.endsWith('.js')) sf += '.js';
    return staticGuards(sf, prefix, seen, acc, inherited, varName);
  }
  const alias = parseGuardAliases(src);
  const routerGuardUses = collectRouterGuardUses(src, vEsc, alias);
  const inheritedBase = cloneGuards(inherited);
  const guardsAt = (routePath, sourceIndex) => applyRouterUses(inheritedBase, routerGuardUses, routePath, sourceIndex);

  // Le groupe de gardes (entre la route et le handler) est lazy/borné à 400 car.
  // S'il ne trouve pas de handler inline sur CETTE route (ex: handler nommé,
  // `router.post('/x', mw, namedHandler)`), il continue d'avancer et peut
  // engloutir la DÉCLARATION SUIVANTE jusqu'à atteindre son handler inline —
  // ce qui fait disparaître la route suivante du résultat. On interdit donc à
  // la fenêtre de traverser un autre `vEsc.<méthode>(`.
  const guardGap = '(?:(?!\\b' + vEsc + '\\.(?:get|post|put|delete|patch)\\b)[\\s\\S]){0,400}?';
  const seenRoutes = new Set(); // method+route déjà capturés par la passe inline, pour éviter les doublons avec la passe "handler nommé"
  for (const m of src.matchAll(new RegExp('\\b' + vEsc + '\\.(get|post|put|delete|patch)\\s*\\(\\s*[\'"`]([^\'"`]+)[\'"`]\\s*,?(' + guardGap + ')(async\\s*\\(\\s*[_A-Za-z$][\\w$]*|\\(\\s*[_A-Za-z$][\\w$]*|function\\s*\\()', 'g'))) {
    const chain = m[3] || '';
    const t = guardsAt(m[2], m.index);
    mergeInto(t, tokens(chain));
    for (const name of Object.keys(alias)) if (new RegExp('\\b' + name + '\\b').test(chain)) mergeInto(t, alias[name]);
    const route = norm(prefix + '/' + m[2]);
    seenRoutes.add(m[1].toUpperCase() + ' ' + route);
    acc.push({ method: m[1].toUpperCase(), route, authn: t.authn, admin: t.admin || t.roles.has('admin'), roles: [...t.roles] });
  }
  // Passe complémentaire : routes avec un HANDLER NOMMÉ plutôt qu'inline, ex.
  // `router.get('/x', authenticate, requireAdmin, namedHandler);` — le pattern
  // ci-dessus exige un handler inline et ne peut structurellement pas matcher
  // ces lignes. On capture toute la chaîne jusqu'au `;` de fin de l'appel.
  for (const m of src.matchAll(new RegExp('\\b' + vEsc + '\\.(get|post|put|delete|patch)\\s*\\(\\s*[\'"`]([^\'"`]+)[\'"`]\\s*,([^\\n;]*)\\)\\s*;', 'g'))) {
    const route = norm(prefix + '/' + m[2]);
    const key = m[1].toUpperCase() + ' ' + route;
    if (seenRoutes.has(key)) continue; // déjà capturée par la passe inline
    seenRoutes.add(key);
    const chain = m[3] || '';
    const t = guardsAt(m[2], m.index);
    mergeInto(t, tokens(chain));
    for (const name of Object.keys(alias)) if (new RegExp('\\b' + name + '\\b').test(chain)) mergeInto(t, alias[name]);
    acc.push({ method: m[1].toUpperCase(), route, authn: t.authn, admin: t.admin || t.roles.has('admin'), roles: [...t.roles] });
  }
  // sous-routeurs (héritent fileBase)
  const v2spec = {};
  for (const m of src.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*require\(\s*['"]([^'"]+)['"]\s*\)/g)) v2spec[m[1]] = m[2];
  for (const m of src.matchAll(new RegExp('\\b' + vEsc + '\\.use\\(\\s*(?:([\'"`])([^\'"`]+)\\1\\s*,\\s*)?([^\\n;]+)', 'g'))) {
    const sub = m[2] || ''; const arg = (m[3] || '').trim();
    let spec = null; const inl = arg.match(/require\(\s*['"]([^'"]+)['"]\s*\)/);
    if (inl) spec = inl[1]; else { const vn = arg.split(/[\s,(]/)[0]; if (v2spec[vn]) spec = v2spec[vn]; }
    if (spec && /routes|\.\//.test(spec)) {
      let p = spec.replace(/^\.\//, '').replace(/^\.\.\//, '');
      let sf = /^routes\//.test(p) ? p : path.normalize(path.join(path.dirname(routeFile), spec)).replace(/\\/g, '/');
      if (!sf.endsWith('.js')) sf += '.js';
      staticGuards(sf, norm(prefix + '/' + sub), seen, acc, guardsAt(sub || '/', m.index + 1), varName);
    }
  }
  return acc;
}

// prefix → fichier (pour mapper l'inventaire runtime aux fichiers + monter les gardes)
// `exportName` : certains fichiers exportent PLUSIEURS routeurs (ex: shared-cart.js
// exporte { router, adminRouter }, montés sur 2 préfixes différents avec des routes
// différentes). On garde le nom de variable réellement monté (ex: 'adminRouter')
// pour que staticGuards analyse le BON routeur, pas toujours le littéral 'router'.
function buildMounts() {
  const mounts = [];
  for (const f of ['bootstrap/api-routes.js', 'server.js']) {
    const src = read(f); if (!src) continue;
    const v2f = {};
    for (const m of src.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*require\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      const mm = m[2].match(/routes\/([\w/-]+)/); if (mm) v2f[m[1]] = 'routes/' + mm[1].replace(/\.js$/, '') + '.js';
    }
    // Regex étendue à tout préfixe (pas seulement /api) : couvre /health, /webhook, etc.
    for (const m of src.matchAll(/app\.use\(\s*['"](\/[^'"]*)['"]\s*,\s*([^\n;]+)/g)) {
      const prefix = norm(m[1]); const arg = m[2].trim(); let file = null;
      const inl = arg.match(/require\(\s*['"][^'"]*routes\/([\w/-]+)['"]/);
      if (inl) file = 'routes/' + inl[1].replace(/\.js$/, '') + '.js';
      else { const vn = arg.split(/[\s,().]/)[0]; if (v2f[vn]) file = v2f[vn]; }
      // nom de l'export monté : 'sharedCart.adminRouter' → 'adminRouter' ; 'router' → 'router'
      const dotMatch = arg.match(/^\w+\.(\w+)/);
      const exportName = dotMatch ? dotMatch[1] : 'router';
      if (file) mounts.push({ prefix, file, exportName });
    }
  }
  return mounts;
}

// ── inventaire COMPLET au runtime ────────────────────────────────────────────
function extractMountPath(layer) {
  if (layer.path) return layer.path;
  const src = layer.regexp && layer.regexp.source;
  if (!src || /^\^\\\/\?(\(\?=|\$)/.test(src)) return '';
  let m = src.replace(/^\^/, '').replace(/\\\/\?\(\?=\\\/\|\$\)$/, '').replace(/\$$/, '').replace(/\\\//g, '/');
  if (layer.keys && layer.keys.length) { let i = 0; m = m.replace(/\(\[\^\\\/\]\+\?\)/g, () => ':' + (layer.keys[i++]?.name || 'id')); }
  return m === '/' ? '' : m;
}
// ── dérive les mounts /api/* présents UNIQUEMENT dans server.js (pas dans
//    bootstrap/api-routes.js) — ex: les blocs "Stripe-owned" montés directement
//    dans server.js. Évite le whack-a-mole du hardcode : au prochain mount ajouté
//    dans server.js, il est vu automatiquement, sans toucher ce script.
//    Garde-fou : chaque mount est requis dans son PROPRE try/catch (un require qui
//    échoue ne doit jamais faire disparaître silencieusement les autres mounts).
function deriveServerJsOnlyMounts() {
  const src = read('server.js'); if (!src) return [];
  const v2spec = {};
  for (const m of src.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*require\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    v2spec[m[1]] = m[2];
  }
  const out = [];
  for (const m of src.matchAll(/app\.use\(\s*['"](\/api[^'"]*)['"]\s*,\s*([^\n;]+)/g)) {
    const prefix = m[1]; const arg = m[2].trim();
    // require('...') inline, éventuellement suivi de .exportName
    let inl = arg.match(/require\(\s*['"]([^'"]+)['"]\s*\)\s*(?:\.(\w+))?/);
    let modulePath, exportName;
    if (inl) { modulePath = inl[1]; exportName = inl[2] || null; }
    else {
      // variable.exportName où la variable a été require()-ée plus haut
      const dot = arg.match(/^(\w+)(?:\.(\w+))?/);
      if (dot && v2spec[dot[1]]) { modulePath = v2spec[dot[1]]; exportName = dot[2] || null; }
    }
    if (modulePath) out.push({ prefix, modulePath, exportName });
  }
  return out;
}

function runtimeInventory() {
  const app = express();
  const ar = require('../bootstrap/api-routes');
  ar.mountApiRoutesBeforeStripeOwnedBlocks(app); ar.mountApiRoutesAfterStripeOwnedBlocks(app);
  for (const { prefix, modulePath, exportName } of deriveServerJsOnlyMounts()) {
    // Seuls les fichiers locaux (chemins relatifs) sont des routeurs candidats —
    // exclut le bruit comme 'express.raw' (middleware body-parser, pas un routeur).
    if (!modulePath.startsWith('.')) continue;
    try {
      // modulePath vient d'un require() écrit DANS server.js (à ROOT) — résoudre
      // contre ROOT, pas contre __dirname (scripts/), sinon require() cherche au
      // mauvais endroit pour tout chemin relatif ('./routes/x', '../x').
      const resolved = path.join(ROOT, modulePath);
      const mod = require(resolved);
      const handler = exportName ? mod[exportName] : (mod.router || mod);
      if (handler) app.use(prefix, handler);
    } catch (_) { /* un mount qui échoue ne doit pas tuer le scan */ }
  }
  const stack = (app._router || app.router).stack; const out = [];
  (function walk(layers, prefix) {
    for (const l of layers) {
      if (l.route) { const fp = norm((prefix + l.route.path).replace(/\/+/g, '/'));
        for (const mt of Object.keys(l.route.methods)) if (l.route.methods[mt]) out.push({ method: mt.toUpperCase(), path: fp }); }
      else if (l.handle && l.handle.stack) walk(l.handle.stack, prefix + extractMountPath(l));
    }
  })(stack, ''); return out;
}

// ── jointure inventaire ↔ gardes statiques (par suffixe) ─────────────────────
// Deux choses peuvent faire qu'un préfixe seul ne suffit pas à trouver la garde :
// 1. Plusieurs fichiers montés sur le MÊME préfixe (ex: deux routers sur
//    /api/admin/sourcing, trois sur /api/hub) → il faut les gardes de TOUS.
// 2. Express teste les mounts dans l'ORDRE DE DÉCLARATION, pas seulement le
//    préfixe le plus spécifique : si /api/admin/dashboard (mount le plus long)
//    n'a pas de route pour le tail demandé, Express passe au mount suivant qui
//    matche, même plus court (ex: /api/admin, dont la route interne /dashboard
//    répond). Donc on garde TOUS les mounts dont le préfixe matche, du plus
//    long au plus court, et `classify` essaie dans cet ordre.
const mounts = buildMounts().sort((a, b) => b.prefix.length - a.prefix.length);
const mountsFor = p => mounts.filter(m => p === m.prefix || p.startsWith(m.prefix + '/'));

const guardCache = {};
function guardsForFile(f, exportName) {
  const cacheKey = f + '@' + (exportName || 'router');
  if (!(cacheKey in guardCache)) guardCache[cacheKey] = f ? staticGuards(f, '', null, null, null, exportName) : [];
  return guardCache[cacheKey];
}

function classify(method, p) {
  const mts = mountsFor(p);
  let best = null;
  for (const mt of mts) {
    const tail = norm(p.slice(mt.prefix.length));
    for (const g of guardsForFile(mt.file, mt.exportName)) {
      if (g.method !== method) continue;
      if (g.route === tail || tail.endsWith(g.route) || g.route.endsWith(tail)) {
        if (!best || g.route.length > best.route.length) best = g;
      }
    }
  }
  const isAdminPath = /^\/api\/admin(\/|$)/.test(p);
  const isPublicOk = PUBLIC_OK.some(re => re.test(p));
  const disposition = getDisposition(method + ' ' + p);
  if (!best) {
    if (disposition) return { method, path: p, level: 'PUBLIC', severity: 'ok', roles: [], authn: null, disposition };
    return { method, path: p, level: 'UNKNOWN', severity: 'audit', roles: [], authn: null, disposition: null };
  }
  let level = 'PROTECTED', severity = 'ok', appliedDisposition = null;
  if (isAdminPath && !best.admin) { level = 'ADMIN_NO_GUARD'; severity = 'high'; }
  else if (!best.authn && disposition) { level = 'PUBLIC'; severity = 'ok'; appliedDisposition = disposition; }
  else if (!best.authn && !isPublicOk) { level = 'UNPROTECTED'; severity = 'medium'; }
  else if (!best.authn && isPublicOk) { level = 'PUBLIC'; severity = 'ok'; }
  return { method, path: p, level, severity, roles: best.roles, authn: best.authn, disposition: appliedDisposition };
}

const dispositionErrors = validateDispositions();
if (dispositionErrors.length) {
  console.error('✖ Security 360 : registre de dispositions invalide');
  dispositionErrors.forEach(e => console.error('   - ' + e));
  process.exit(1);
}

const routes = runtimeInventory().map(r => classify(r.method, r.path));
routes.sort((a, b) => (a.path + a.method).localeCompare(b.path + b.method));
const key = r => `${r.method} ${r.path}`;
const runtimeKeys = new Set(routes.map(key));
const missingDispositionRoutes = Object.keys(DISPOSITIONS).filter(k => !runtimeKeys.has(k));
const appliedDispositionKeys = new Set(routes.filter(r => r.disposition).map(key));
const staleDispositions = Object.keys(DISPOSITIONS).filter(k => runtimeKeys.has(k) && !appliedDispositionKeys.has(k));
if (missingDispositionRoutes.length || staleDispositions.length) {
  console.error('✖ Security 360 : dispositions périmées ou sans route runtime');
  missingDispositionRoutes.forEach(k => console.error('   - route absente : ' + k));
  staleDispositions.forEach(k => console.error('   - disposition devenue inutile : ' + k));
  process.exit(1);
}
const flagged = routes.filter(r => r.severity !== 'ok');
const disposed = routes.filter(r => r.disposition);
const summary = {
  total: routes.length,
  protected: routes.filter(r => r.level === 'PROTECTED').length,
  public: routes.filter(r => r.level === 'PUBLIC').length,
  unprotected: routes.filter(r => r.level === 'UNPROTECTED').length,
  admin_no_guard: routes.filter(r => r.level === 'ADMIN_NO_GUARD').length,
  unknown: routes.filter(r => r.level === 'UNKNOWN').length,
};
const report = {
  generatedAt: new Date().toISOString(),
  source: 'hybrid: runtime inventory + static guard analysis + exact route dispositions',
  summary,
  flagged: flagged.map(r => ({ key: key(r), level: r.level, severity: r.severity, roles: r.roles })),
  dispositions: disposed.map(r => ({ key: key(r), kind: r.disposition.kind, evidence: r.disposition.evidence, rationale: r.disposition.rationale })),
};
const projection = {
  source: report.source,
  summary: report.summary,
  flagged: report.flagged,
  dispositions: report.dispositions,
  routes: routes.map(r => ({ key: key(r), level: r.level, roles: r.roles })),
};
function renderMarkdown(generatedAt) {
  return ['# Security 360 — couverture des gardes (hybride runtime + statique)', '',
    `> ${generatedAt} — ${summary.total} endpoints`, '',
    '| Niveau | Compte |', '|---|---|',
    `| 🟢 PROTECTED | ${summary.protected} |`, `| ⚪ PUBLIC (légitime) | ${summary.public} |`,
    `| 🟠 UNPROTECTED | ${summary.unprotected} |`, `| 🔴 ADMIN_NO_GUARD | ${summary.admin_no_guard} |`,
    `| ❔ UNKNOWN (statique n'a pas atteint — à auditer) | ${summary.unknown} |`, '',
    '## Flaggés', '', ...(flagged.length ? flagged.map(r => `- ${r.severity === 'high' ? '🔴' : r.severity === 'audit' ? '❔' : '🟠'} \`${key(r)}\` — ${r.level}${r.roles.length ? ' (rôles: ' + r.roles.join(',') + ')' : ''}`) : ['_Aucun._'])].join('\n');
}

function comparableProjection(doc) {
  if (!doc) return null;
  return { source: doc.source, summary: doc.summary, flagged: doc.flagged, dispositions: doc.dispositions, routes: doc.routes };
}
const current = flagged.map(key).sort();
if (MODE === 'check') {
  let base = { flagged: [] }; try { base = JSON.parse(fs.readFileSync(BASELINE, 'utf8')); } catch (_) {}
  const known = new Set(base.flagged || []); const novel = current.filter(k => !known.has(k));
  const resolvedButStillBaselined = [...known].filter(k => !current.includes(k));
  if (resolvedButStillBaselined.length) {
    console.error(`\x1b[31m\x1b[1m✖ ${resolvedButStillBaselined.length} signal(aux) résolu(s) encore présent(s) dans la baseline :\x1b[0m`);
    resolvedButStillBaselined.forEach(k => console.error('   ↓ ' + k));
    console.error('   Lance npm run security:360:save pour rembourser la baseline.');
    process.exit(1);
  }
  if (novel.length) {
    console.error(`\x1b[31m\x1b[1m✖ ${novel.length} nouvelle(s) anomalie(s) sécu :\x1b[0m`);
    novel.forEach(k => { const r = flagged.find(f => key(f) === k); console.error(`   ↑ ${r.severity === 'high' ? '🔴' : r.severity === 'audit' ? '❔' : '🟠'} ${k} — ${r.level}`); });
    console.error('   (ajoute une garde, ou si légitime : npm run security:360:save)');
    process.exit(1);
  }
  let committedJson = null;
  try { committedJson = JSON.parse(fs.readFileSync(path.join(DOCS, 'SECURITY_360.json'), 'utf8')); } catch (_) {}
  if (!committedJson || JSON.stringify(comparableProjection(committedJson)) !== JSON.stringify(projection)) {
    console.error('\x1b[31m\x1b[1m✖ SECURITY_360.json est périmé.\x1b[0m');
    console.error('   Lance npm run security:360 puis commite docs/SECURITY_360.{json,md}.');
    process.exit(1);
  }
  let committedMd = null;
  try { committedMd = fs.readFileSync(path.join(DOCS, 'SECURITY_360.md'), 'utf8'); } catch (_) {}
  const expectedMd = renderMarkdown(committedJson.generatedAt) + '\n';
  if (committedMd !== expectedMd) {
    console.error('\x1b[31m\x1b[1m✖ SECURITY_360.md est périmé ou désynchronisé du JSON.\x1b[0m');
    console.error('   Lance npm run security:360 puis commite docs/SECURITY_360.{json,md}.');
    process.exit(1);
  }
  console.log(`\x1b[32m✔ Security 360 : projection fraîche, aucune nouvelle anomalie (${current.length} connus).\x1b[0m`);
  process.exit(0);
}

if (!fs.existsSync(DOCS)) fs.mkdirSync(DOCS, { recursive: true });
fs.writeFileSync(path.join(DOCS, 'SECURITY_360.json'), JSON.stringify({ generatedAt: report.generatedAt, ...projection }, null, 2) + '\n');
fs.writeFileSync(path.join(DOCS, 'SECURITY_360.md'), renderMarkdown(report.generatedAt) + '\n');

if (MODE === 'save') {
  fs.writeFileSync(BASELINE, JSON.stringify({ flagged: current }, null, 2) + '\n');
  console.log(`\x1b[32m\x1b[1m✔ Baseline security-360 figée\x1b[0m (🔴 ${summary.admin_no_guard} · 🟠 ${summary.unprotected} · ❔ ${summary.unknown}).`);
  process.exit(0);
}
console.log(`Security 360 · ${summary.total} routes · 🟢 ${summary.protected} · ⚪ ${summary.public} · 🟠 ${summary.unprotected} · 🔴 ${summary.admin_no_guard} · ❔ ${summary.unknown}`);
process.exit(0);
