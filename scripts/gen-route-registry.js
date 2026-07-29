#!/usr/bin/env node
'use strict';

/**
 * gen-route-registry.js — Registre des routes Express réellement montées.
 *
 * Problème résolu (AUDIT_FEATURE_FIRST_2026-07-06.md, §2c) : le checker
 * `interface` de feature-audit.js ne lisait que le contenu littéral des
 * fichiers routes/ possédés par une feature. Il ne savait pas qu'un chemin
 * complet se compose en traversant plusieurs fichiers :
 *   bootstrap/api-routes.js  → app.use('/api/hub-dash', hubDashRouter)
 *   routes/hub-dashboard.js  → router.get('/dashboard', ...)
 *   chemin réel              → GET /api/hub-dash/dashboard
 *
 * Le problème est en réalité plus profond qu'un seul niveau : certains
 * fichiers routes/ montent eux-mêmes des sous-routers (routes/admin/index.js,
 * routes/orders.js, routes/dashboard.js, routes/parcel-api-v2/index.js), et
 * certains fichiers exportent PLUSIEURS routers distincts montés à des
 * préfixes différents (routes/shared-cart.js exporte {router, adminRouter}
 * — adminRouter est monté à /api/admin/shared-carts, router à /api/shared-carts).
 *
 * Ce générateur résout la composition complète, récursivement, à partir des
 * deux points d'entrée réels de montage (server.js, bootstrap/api-routes.js),
 * et produit docs/_generated/route-registry.json : la table de vérité que
 * feature-audit.js consulte au lieu de faire une recherche de sous-chaîne
 * locale au fichier.
 *
 * Limites connues (documentées, pas cachées) :
 *   - Résolution par regex, pas par AST. Suffisant pour la convention du
 *     repo (router.VERB('/path', ...), router.use('/prefix', require(...))),
 *     mais un style d'écriture inhabituel (chemin construit dynamiquement,
 *     require() conditionnel) ne sera pas résolu — la route sera absente du
 *     registre plutôt que mal résolue (fail-safe : on préfère un faux négatif
 *     silencieux à un faux positif qui redonnerait un faux vert).
 *   - Les middlewares génériques (express.static, error handlers, rate
 *     limiters) ne sont pas des routers et sont ignorés silencieusement.
 *
 * Usage :
 *   node scripts/gen-route-registry.js [--root DIR] [--out FILE]
 */

const fs   = require('fs');
const path = require('path');

const args = process.argv.slice(2);
function argVal(flag, def) { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : def; }

const ROOT   = path.resolve(argVal('--root', process.cwd()));
const OUT    = path.resolve(ROOT, argVal('--out', 'docs/_generated/route-registry.json'));

const ENTRY_POINTS = [
  { file: 'server.js',               fnFilter: null },
  { file: 'bootstrap/api-routes.js', fnFilter: null },
];

const fileCache = new Map(); // absPath -> parsed

function readSafe(abs) {
  try { return fs.readFileSync(abs, 'utf8'); } catch (e) { return null; }
}

// Résout un chemin require() ('./foo', '../routes/bar') en chemin absolu de
// fichier .js réel (gère les index.js de dossier).
function resolveRequire(fromFileAbs, reqPath) {
  if (!reqPath.startsWith('.')) return null; // on ignore les paquets npm
  const base = path.resolve(path.dirname(fromFileAbs), reqPath);
  const candidates = [base + '.js', path.join(base, 'index.js'), base];
  for (const c of candidates) if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  return null;
}

// ── Parse un fichier de routes : routers déclarés, verbes câblés par
//    variable, montages imbriqués (router.use), et table d'export. ─────────
function parseRouteFile(abs) {
  if (fileCache.has(abs)) return fileCache.get(abs);
  const rawSrc = readSafe(abs);
  const parsed = { routerVars: new Set(), routes: [], nested: [], exportsMap: {} };
  if (rawSrc == null) { fileCache.set(abs, parsed); return parsed; }

  // Anti faux-positifs (audit 2026-07-06, §axe1-bug1) : un commentaire qui
  // MENTIONNE du code (ex: "// insérer avant router.get('/x', ...)") était
  // lu par les regex ci-dessous comme une vraie route câblée. On neutralise
  // les commentaires ligne (// ...) et bloc (/* ... */) avant tout regex de
  // détection, en préservant la longueur du fichier (remplacement par des
  // espaces, jamais par suppression) pour ne pas décaler les offsets.
  const src = rawSrc
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, pre) => pre + ' '.repeat(m.length - pre.length));

  // Variables de router : const X = express.Router();
  const routerDeclRe = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*express\.Router\s*\(\s*\)/g;
  let m;
  while ((m = routerDeclRe.exec(src))) parsed.routerVars.add(m[1]);
  if (parsed.routerVars.size === 0) parsed.routerVars.add('router'); // convention par défaut

  // Verbes câblés : X.get/post/put/patch/delete('/path', ...)
  // NB (audit 2026-07-06, §axe1-bug2) : les verbes câblés directement sur
  // `app` (app.get/app.post/...) sont désormais CAPTURÉS (pas ignorés) —
  // voir collectTopLevelMounts() et build() pour leur intégration au
  // registre final. Le `continue` précédent les rendait invisibles alors
  // que ce sont de vraies routes montées (ex: GET /api/public/config).
  const verbRe = /\b([A-Za-z_$][\w$]*)\.(get|post|put|patch|delete)\s*\(\s*(['"`])((?:(?!\3).)*)\3/g;
  while ((m = verbRe.exec(src))) {
    const [, varName, method, , localPath] = m;
    parsed.routes.push({ routerVar: varName, method: method.toUpperCase(), localPath });
  }

  // Montages imbriqués : X.use('/sub', require('./other')[.prop]) ou X.use(require('./other'))
  const nestedRe = /\b([A-Za-z_$][\w$]*)\.use\(\s*(?:(['"`])((?:(?!\2).)*)\2\s*,\s*)?require\(\s*(['"`])(\.[^'"`]+)\4\s*\)(?:\.([A-Za-z_$][\w$]*))?/g;
  while ((m = nestedRe.exec(src))) {
    const [, varName, , subPrefix, , reqPath, prop] = m;
    if (varName === 'app') continue;
    parsed.nested.push({ routerVar: varName, subPrefix: subPrefix || '', reqPath, prop: prop || null });
  }

  // module.exports = require('./other')[.prop];  → façade de ré-export pur
  // (ex: routes/admin.js = require('./admin/index')). Le fichier lui-même ne
  // déclare ni router ni route : c'est un passe-plat transparent vers un
  // autre fichier, qu'il faut suivre plutôt que traiter comme terminal.
  const passthroughRe = /module\.exports\s*=\s*require\(\s*(['"`])(\.[^'"`]+)\1\s*\)(?:\.([A-Za-z_$][\w$]*))?\s*;/;
  const passthroughMatch = passthroughRe.exec(src);
  if (passthroughMatch) {
    parsed.passthrough = { reqPath: passthroughMatch[2], prop: passthroughMatch[3] || null };
  }

  // module.exports = { router, adminRouter: foo, ... }  |  module.exports = router;
  const objExportRe = /module\.exports\s*=\s*\{([^}]*)\}/;
  const objMatch = passthroughMatch ? null : objExportRe.exec(src);
  if (objMatch) {
    const body = objMatch[1];
    const entryRe = /([A-Za-z_$][\w$]*)\s*(?::\s*([A-Za-z_$][\w$]*))?/g;
    let em;
    while ((em = entryRe.exec(body))) {
      const key = em[1];
      const val = em[2] || em[1];
      if (key) parsed.exportsMap[key] = val;
    }
  } else {
    const directRe = /module\.exports\s*=\s*([A-Za-z_$][\w$]*)\s*;/;
    const dm = directRe.exec(src);
    if (dm) parsed.exportsMap['default'] = dm[1];
    else if (parsed.routerVars.has('router')) parsed.exportsMap['default'] = 'router';
  }

  fileCache.set(abs, parsed);
  return parsed;
}

function joinPath(prefix, local) {
  let full = (prefix || '') + '/' + (local || '');
  full = full.replace(/\/{2,}/g, '/');
  if (full.length > 1 && full.endsWith('/')) full = full.slice(0, -1);
  return full || '/';
}

// ── Résolution récursive à partir d'un montage (fichier + var exportée) ────
function resolveMount(fileAbs, prop, prefix, mountedFromChain, out, visiting) {
  const key = `${fileAbs}::${prop || 'default'}::${prefix}`;
  if (visiting.has(key)) return; // anti-boucle
  visiting.add(key);

  const parsed = parseRouteFile(fileAbs);

  if (parsed.passthrough) {
    const nextAbs = resolveRequire(fileAbs, parsed.passthrough.reqPath);
    if (nextAbs) {
      resolveMount(nextAbs, parsed.passthrough.prop || prop, prefix, mountedFromChain.concat(fileAbs), out, visiting);
    }
    return;
  }

  const targetVar = prop ? (parsed.exportsMap[prop] || prop) : (parsed.exportsMap['default'] || 'router');

  for (const r of parsed.routes) {
    if (r.routerVar !== targetVar) continue;
    out.push({
      method:      r.method,
      fullPath:    joinPath(prefix, r.localPath),
      mountPrefix: prefix,
      localPath:   r.localPath,
      routeFile:   path.relative(ROOT, fileAbs).split(path.sep).join('/'),
      mountedFrom: mountedFromChain.map(f => path.relative(ROOT, f).split(path.sep).join('/')),
    });
  }

  for (const n of parsed.nested) {
    if (n.routerVar !== targetVar) continue;
    const nextAbs = resolveRequire(fileAbs, n.reqPath);
    if (!nextAbs) continue;
    resolveMount(nextAbs, n.prop, joinPath(prefix, n.subPrefix).replace(/\/$/, '') || '', mountedFromChain.concat(fileAbs), out, visiting);
  }
}

// ── Point d'entrée : parcourir server.js / bootstrap/api-routes.js pour les
//    app.use('/prefix', X) et les require() qui alimentent X. ──────────────
function collectTopLevelMounts(entryAbs) {
  const src = readSafe(entryAbs);
  const mounts = [];
  if (src == null) return mounts;

  // const X = require('../routes/foo')[.prop];
  const reqAssignRe = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\(\s*(['"`])(\.[^'"`]+)\2\s*\)(?:\.([A-Za-z_$][\w$]*))?/g;
  const varToReq = {};
  let m;
  while ((m = reqAssignRe.exec(src))) {
    const [, varName, , reqPath, prop] = m;
    varToReq[varName] = { reqPath, prop: prop || null };
  }

  // app.use('/prefix', EXPR) où EXPR = ident | ident.prop | require('...')[.prop]
  const appUseRe = /\bapp\.use\(\s*(['"`])((?:(?!\1).)*)\1\s*,\s*([^)]*?)\)/g;
  while ((m = appUseRe.exec(src))) {
    const prefix = m[2];
    const exprRaw = m[3].trim();

    let reqPath = null, prop = null;
    const inlineReq = /^require\(\s*(['"`])(\.[^'"`]+)\1\s*\)(?:\.([A-Za-z_$][\w$]*))?$/.exec(exprRaw);
    if (inlineReq) {
      reqPath = inlineReq[2]; prop = inlineReq[3] || null;
    } else {
      const identMatch = /^([A-Za-z_$][\w$]*)(?:\.([A-Za-z_$][\w$]*))?$/.exec(exprRaw);
      if (identMatch && varToReq[identMatch[1]]) {
        reqPath = varToReq[identMatch[1]].reqPath;
        prop = identMatch[2] || varToReq[identMatch[1]].prop;
      }
    }
    if (!reqPath) continue; // pas un montage de router résoluble (middleware, static, handler inline...)

    const abs = resolveRequire(entryAbs, reqPath);
    if (!abs) continue;
    mounts.push({ prefix, abs, prop });
  }

  // app.use(EXPR) sans préfixe (ex: metaWhatsAppRoutes)
  const appUseNoPrefixRe = /\bapp\.use\(\s*([A-Za-z_$][\w$]*)\s*\)/g;
  while ((m = appUseNoPrefixRe.exec(src))) {
    const varName = m[1];
    if (varToReq[varName]) {
      const abs = resolveRequire(entryAbs, varToReq[varName].reqPath);
      if (abs) mounts.push({ prefix: '', abs, prop: varToReq[varName].prop });
    }
  }

  return mounts;
}

function build() {
  const registry = [];
  const visiting = new Set();
  const seenMountKeys = new Set();

  for (const ep of ENTRY_POINTS) {
    const entryAbs = path.join(ROOT, ep.file);
    if (!fs.existsSync(entryAbs)) continue;

    // Routes câblées directement sur `app` dans ce fichier d'entrée lui-même
    // (audit 2026-07-06, §axe1-bug2). Ex: server.js: app.get('/api/health', ...).
    // Ces routes ne sont montées via aucun require() donc resolveMount() ne
    // les verrait jamais — on les ajoute ici en direct, prefix vide (chemin
    // déjà complet tel qu'écrit dans le code).
    const entryParsed = parseRouteFile(entryAbs);
    for (const r of entryParsed.routes) {
      if (r.routerVar !== 'app') continue;
      registry.push({
        method:      r.method.toUpperCase(),
        fullPath:    joinPath('', r.localPath),
        mountPrefix: '',
        localPath:   r.localPath,
        routeFile:   path.relative(ROOT, entryAbs).split(path.sep).join('/'),
        mountedFrom: [],
      });
    }

    const mounts = collectTopLevelMounts(entryAbs);
    for (const mnt of mounts) {
      const dedupeKey = `${entryAbs}::${mnt.prefix}::${mnt.abs}::${mnt.prop}`;
      if (seenMountKeys.has(dedupeKey)) continue;
      seenMountKeys.add(dedupeKey);
      resolveMount(mnt.abs, mnt.prop, mnt.prefix, [entryAbs], registry, visiting);
    }
  }

  registry.sort((a, b) => a.fullPath.localeCompare(b.fullPath) || a.method.localeCompare(b.method));
  return registry;
}

const registry = build();
fs.mkdirSync(path.dirname(OUT), { recursive: true });

const semantic = {
  generator: 'scripts/gen-route-registry.js',
  count: registry.length,
  routes: registry,
};

let generatedAt = process.env.SOURCE_DATE_EPOCH
  ? new Date(Number(process.env.SOURCE_DATE_EPOCH) * 1000).toISOString()
  : new Date().toISOString();

// Idempotence : une régénération sans changement sémantique ne doit pas
// produire un diff uniquement parce que l'horloge a avancé.
try {
  const previous = JSON.parse(fs.readFileSync(OUT, 'utf8'));
  const previousSemantic = {
    generator: previous.generator,
    count: previous.count,
    routes: previous.routes,
  };
  if (JSON.stringify(previousSemantic) === JSON.stringify(semantic)
      && typeof previous.generatedAt === 'string') {
    generatedAt = previous.generatedAt;
  }
} catch { /* première génération ou artefact illisible */ }

fs.writeFileSync(OUT, JSON.stringify({ generatedAt, ...semantic }, null, 2));

console.log(`route-registry: ${registry.length} route(s) résolue(s) → ${path.relative(ROOT, OUT)}`);
