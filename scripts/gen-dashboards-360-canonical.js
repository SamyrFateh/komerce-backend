#!/usr/bin/env node
'use strict';

/**
 * gen-dashboards-360-canonical.js — Carte 360 du portail Canonical (decision-first).
 *
 *   Contrepartie de scripts/gen-dashboards-360.js (Legacy 1), pour l'AUTRE
 *   système nerveux : le portail Canonical n'a ni registre de routes serveur
 *   (app.js Legacy) ni api-client.js centralisé. Sa chaîne de preuve réelle est :
 *
 *     NAVIGATION (navigation.js, DOMAINS/spaces, roles)
 *           │  hrefFor(item, user) — peut dévier par rôle (ex: Catalogue/Marchés
 *           │  redirigent market_operator vers une page HTML différente)
 *           ▼
 *     SURFACE (app.js::surfaceForPath, ou navigation.js::surfaceForPath pour
 *              les pages HTML autonomes /dashboards/canonical/*.html)
 *           │
 *           ▼
 *     MODULE (renderXxx() dans app.js → global.KomerceCanonicalXxx.mount(),
 *              résolu au fichier qui fait `root.KomerceCanonicalXxx = api`)
 *           │  fetch() littéraux extraits du module
 *           ▼
 *     ENDPOINT BACKEND (normalisé en template `{param}`, comparé au MÊME
 *              contrat OpenAPI que Legacy — docs/contract/openapi.json,
 *              statut x-contract-status : PROVEN / UNKNOWN / jamais inventé)
 *
 *   Ce générateur ne réécrit PAS le générateur Legacy et ne fusionne PAS les
 *   deux registres — Legacy reste sa propre preuve tant qu'il existe en
 *   rollback (`?legacy=1`, cf. bootstrap/html-routes.js).
 *
 *   Sorties :
 *     docs/DASHBOARDS_360_CANONICAL.json
 *     docs/DASHBOARDS_360_CANONICAL.md
 *
 * Modes :
 *   node scripts/gen-dashboards-360-canonical.js            → génère les deux fichiers
 *   node scripts/gen-dashboards-360-canonical.js --check    → cliquet, exit 1 si régression
 *   node scripts/gen-dashboards-360-canonical.js --save     → fige la baseline courante
 *
 * Principe de preuve (identique à Legacy, jamais dérogé) :
 *   Un statut n'est écrit que s'il est observé dans le code. Aucun cas non
 *   résolu n'est classé PROVEN par défaut — il reste UNRESOLVED/UNKNOWN et
 *   est listé comme signal informatif, jamais comme anomalie inventée.
 *   La baseline --save fige fidèlement ce qui est trouvé au moment du save,
 *   y compris les écarts réels : elle sert à empêcher une NOUVELLE dette
 *   silencieuse, pas à masquer la dette déjà connue (qui reste visible en
 *   intégralité dans le .md, jamais retirée du rapport).
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CANON_DIR = path.join(ROOT, 'public/dashboards/canonical');
const JS_DIR = path.join(CANON_DIR, 'js');
const APP_FILE = path.join(JS_DIR, 'app.js');
const NAV_FILE = path.join(JS_DIR, 'navigation.js');
const OPENAPI_FILE = path.join(ROOT, 'docs/contract/openapi.json');
const HTML_ROUTES_FILE = path.join(ROOT, 'bootstrap/html-routes.js');
const DOCS = path.join(ROOT, 'docs');
const OUT_JSON = path.join(DOCS, 'DASHBOARDS_360_CANONICAL.json');
const OUT_MD = path.join(DOCS, 'DASHBOARDS_360_CANONICAL.md');
const BASELINE = path.join(__dirname, '.dashboards-360-canonical-baseline.json');

const args = process.argv.slice(2);
const CHECK = args.includes('--check');
const SAVE = args.includes('--save');

const RED = '\x1b[31m', GRN = '\x1b[32m', YLW = '\x1b[33m', CYN = '\x1b[36m', MAG = '\x1b[35m', BLD = '\x1b[1m', DIM = '\x1b[2m', R = '\x1b[0m';

const ALL_ROLES = ['admin', 'market_operator', 'finance', 'sourcing', 'agent_hub', 'agent_relais', 'agent_transitaire', 'support'];

// Pages HTML autonomes (hors dispatch app.js) — cf. bootstrap/html-routes.js.
const STANDALONE_HTML_SURFACES = Object.freeze({
  '/dashboards/canonical/access.html': 'market-access',
  '/dashboards/canonical/market-autonomy.html': 'market-autonomy',
  '/dashboards/canonical/market-catalog.html': 'market-catalog',
});

function stripBlockComments(s) { return s.replace(/\/\*[\s\S]*?\*\//g, ''); }
function stripLineComments(s) { return s.replace(/(^|[^:])\/\/.*$/gm, '$1'); }

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
      if (e.name === 'node_modules') continue;
      walk(full, acc);
    } else if (e.name.endsWith('.js') && !e.name.endsWith('.test.js')) {
      acc.push(full);
    }
  }
  return acc;
}

// ── 1. Collecte des modules JS Canonical (headers + exports globaux + fetch()) ──

// Tokens dont la présence dans un fichier Canonical trahit une dépendance
// silencieuse au portail Legacy 1 (jamais déclarée par la doctrine
// `canonical_admin_no_legacy_imports` de app.js).
const LEGACY_TOKENS = [
  '/dashboards/admin/',
  'admin-legacy',
  'ct-views-',
  'PricingView',
  'EconomicFlowView',
  'ControlTowerView',
  'portal-pilotage',
];

// Heuristique doctrine `client_market_id_never_authority` (navigation.js) —
// jamais une preuve formelle de faille (le serveur rejette de toute façon,
// cf. rejectBrowserAuthority côté Action Center), mais un signal fort si le
// navigateur construit lui-même une clé market_id/marketId à envoyer.
const CLIENT_MARKET_AUTHORITY_RE = /[?&](market_id|marketId)=|['"](market_id|marketId)['"]\s*:/;

// ── Résolution des URLs d'API par fichier ───────────────────────────────────
// Les modules Canonical n'appellent quasiment jamais `fetch('/api/...')` en
// clair : ils déclarent une constante base (`const ENDPOINT = '/api/...'`),
// parfois un helper (`function endpointFor(ctx) { return \`${ENDPOINT}/market/${...}\`; }`),
// puis appellent un wrapper local `jsonRequest(fetchFn, url, options)` — motif
// identique dans 22 des ~30 modules qui parlent au backend (vérifié : mêmes
// 4 lignes de signature dans action-center.js, pricing-workspace.js,
// catalog-workspace.js, operations-workspace.js, etc.). Une poignée de
// modules (les pages HTML autonomes : market-autonomy.js, market-catalog.js,
// market-team.js, market-cash-control.js, markets-decision-bootstrap.js,
// settings-workspace.js, team-invite.js) appellent `fetch()`/`options.fetch()`
// directement sans ce wrapper.
function resolveUrlExpressionsForFile(code) {
  // 1) Constantes littérales base : const NAME = '/api/...' ou `...`
  const constMap = {};
  for (const m of code.matchAll(/const\s+(\w+)\s*=\s*(`[^`]*`|'[^']*'|"[^"]*")\s*;/g)) {
    const val = m[2].slice(1, -1);
    if (/^\/api\//.test(val)) constMap[m[1]] = val;
  }

  // Substitue une seule fois les ${CONST} connues dans un template ; laisse
  // intactes les autres interpolations (segments réellement dynamiques,
  // normalisés en {param} plus tard).
  function substConsts(template) {
    return template.replace(/\$\{(\w+)\}/g, (whole, name) => (constMap[name] !== undefined ? constMap[name] : whole));
  }

  // Certains modules construisent l'URL par CONCATÉNATION plutôt que par
  // template literal (ex: shipping-customs-workspace.js::endpointFor() —
  // `return ENDPOINT_PREFIX + encodeURIComponent(code) + tail;`). On
  // convertit une expression additive en template équivalent : chaque terme
  // littéral/constante connu s'insère tel quel, chaque terme dynamique
  // (appel de fonction, variable inconnue) devient `${param}` — jamais
  // inventé, juste rendu comparable à la même normalisation que les
  // templates littéraux.
  function resolveConcatExpression(exprText) {
    const terms = splitTopLevelPlus(exprText);
    if (terms.length < 2) return null; // pas une concaténation — rien à faire ici
    let out = '';
    let sawApiRoot = false;
    for (const term of terms) {
      const t = term.trim();
      const str = t.match(/^'([^']*)'$|^"([^"]*)"$/);
      const tpl = t.match(/^`([^`]*)`$/);
      if (str) { out += (str[1] || str[2] || ''); if (/^\//.test(str[1] || str[2] || '')) sawApiRoot = sawApiRoot || /^\/api\//.test(out); }
      else if (tpl) { out += substConsts(tpl[1]); }
      else if (/^\w+$/.test(t) && constMap[t] !== undefined) { out += constMap[t]; }
      else { out += '${param}'; }
    }
    if (!/^\/api\//.test(out)) return null;
    return out;
  }

  // Découpe une expression sur les `+` de profondeur 0 uniquement (ignore
  // les `+` à l'intérieur de parenthèses/template literals imbriqués).
  function splitTopLevelPlus(expr) {
    const parts = [];
    let depth = 0, current = '', inTemplate = false;
    for (let i = 0; i < expr.length; i++) {
      const ch = expr[i];
      if (ch === '`') inTemplate = !inTemplate;
      if (!inTemplate) {
        if (ch === '(' || ch === '[' || ch === '{') depth++;
        else if (ch === ')' || ch === ']' || ch === '}') depth--;
      }
      if (ch === '+' && depth === 0 && !inTemplate) { parts.push(current); current = ''; continue; }
      current += ch;
    }
    parts.push(current);
    return parts;
  }

  // Étend constMap aux `const NAME = A + B + ...;` locaux (concaténation).
  for (const m of code.matchAll(/const\s+(\w+)\s*=\s*([^;]*\+[^;]*);/g)) {
    if (constMap[m[1]] !== undefined) continue;
    const resolved = resolveConcatExpression(m[2]);
    if (resolved) constMap[m[1]] = resolved;
  }

  // 2) Helpers à un seul niveau : function NAME(...) { ... return `template`; ... }
  //    Bornage du corps par comptage d'accolades (jamais par indentation —
  //    une détection par "\n  }" se fait piéger par l'IIFE englobante qui
  //    a elle aussi une accolade à 2 espaces, avalant la 1re fonction
  //    imbriquée dans son propre corps capturé).
  const helperMap = {}; // name -> [templates]
  for (const m of code.matchAll(/function\s+(\w+)\s*\([^)]*\)\s*\{/g)) {
    const name = m[1];
    const bodyStart = m.index + m[0].length;
    let depth = 1, i = bodyStart;
    for (; i < code.length && depth > 0; i++) {
      if (code[i] === '{') depth++;
      else if (code[i] === '}') depth--;
    }
    const body = code.slice(bodyStart, i - 1);
    const templates = [];
    for (const retStmt of body.matchAll(/return\s+([^;]*);/g)) {
      for (const tpl of retStmt[1].matchAll(/`[^`]*`/g)) templates.push(tpl[0].slice(1, -1));
      const concatResolved = resolveConcatExpression(retStmt[1]);
      if (concatResolved) templates.push(`\x00RAW\x00${concatResolved}`); // déjà résolu, ne pas re-substConsts
    }
    const filtered = templates
      .filter(t => t.startsWith('\x00RAW\x00') || /^\/api\//.test(t) || /^\$\{\w+\}/.test(t))
      .map(t => (t.startsWith('\x00RAW\x00') ? t.slice(5) : substConsts(t)));
    if (filtered.length) helperMap[name] = [...new Set([...(helperMap[name] || []), ...filtered])];
  }

  // 3) Propriétés `url: \`...\`` ou `url: helperName(...)` déclarées dans des
  //    objets d'action littéraux (boutons d'action des workspaces) — voir Cas E.
  const urlPropertyTemplates = [...code.matchAll(/\burl:\s*(`[^`]*`)/g)]
    .map(m => m[1].slice(1, -1))
    .filter(t => /^\/api\//.test(t) || /^\$\{\w+\}/.test(t))
    .map(substConsts);
  const urlPropertyHelperCalls = [...new Set(
    [...code.matchAll(/\burl:\s*(\w+)\(/g)].map(m => m[1])
  )];
  const urlPropertyCandidates = [...new Set([
    ...urlPropertyTemplates,
    ...urlPropertyHelperCalls.flatMap(h => helperMap[h] || []),
  ])];

  return { constMap, helperMap, substConsts, urlPropertyCandidates };
}

// Résout l'expression d'URL (2e argument de jsonRequest, ou 1er de fetch())
// telle qu'elle apparaît en clair dans le code, en un ou plusieurs candidats
// d'URL bruts (avec ${...} restants = segments dynamiques réels).
function resolveUrlArg(argText, resolver) {
  const trimmed = argText.trim();

  // Cas A : template literal en clair, potentiellement avec un appel de
  // helper interpolé : `${endpointFor(context)}/decision`.
  const backtickMatch = trimmed.match(/^`([^`]*)`$/);
  if (backtickMatch) {
    let body = backtickMatch[1];
    const helperCallMatch = body.match(/^\$\{(\w+)\([^)]*\)\}/);
    if (helperCallMatch && resolver.helperMap[helperCallMatch[1]]) {
      const rest = body.slice(helperCallMatch[0].length);
      return resolver.helperMap[helperCallMatch[1]].map(base => resolver.substConsts(base + rest));
    }
    return [resolver.substConsts(body)];
  }

  // Cas B : appel de helper nu — endpointFor(context)
  const bareHelperMatch = trimmed.match(/^(\w+)\([^)]*\)$/);
  if (bareHelperMatch && resolver.helperMap[bareHelperMatch[1]]) {
    return resolver.helperMap[bareHelperMatch[1]];
  }

  // Cas C : identifiant nu référant une constante connue (ex: `endpointFor`
  // sans parenthèses n'existe pas en pratique, mais `ENDPOINT` seul si).
  if (/^\w+$/.test(trimmed) && resolver.constMap[trimmed]) {
    return [resolver.constMap[trimmed]];
  }

  // Cas D : chaîne littérale simple 'x' ou "x".
  const strMatch = trimmed.match(/^'([^']*)'$|^"([^"]*)"$/);
  if (strMatch) return [strMatch[1] || strMatch[2] || ''];

  // Cas E : `xxx.url` — plusieurs workspaces (catalog/operations/shipping-
  // customs/finance-accounting/sourcing) passent un objet d'action
  // `{ url: \`...\`, ... }` construit à l'appel, puis dépilent `options.url`
  // dans un handler générique avant jsonRequest(). On ne peut pas relier
  // statiquement CET appel précis à SON objet d'origine sans un vrai graphe
  // de flux de données — au lieu de laisser un simple ❓, on retient toutes
  // les valeurs `url: ...` déclarées dans le fichier comme variantes
  // possibles (best-effort, jamais un NOT_FOUND fabriqué sur un cas qui
  // pourrait très bien être prouvé — préférer l'incertitude affichée telle
  // quelle plutôt qu'un faux positif ou un faux négatif silencieux).
  if (/^\w+\.url$/.test(trimmed) && resolver.urlPropertyCandidates.length) {
    return resolver.urlPropertyCandidates;
  }

  return null; // non résolu statiquement — jamais inventé, reste UNRESOLVED
}

// Extrait les arêtes fetch d'un fichier : jsonRequest(fetchArg, urlArg, ...)
// ET fetch(urlArg, ...) / options.fetch(urlArg, ...) / fetchFn(urlArg, ...).
function traceApiEdges(code) {
  const resolver = resolveUrlExpressionsForFile(code);
  const edges = [];

  // Neutralise le corps de la fonction wrapper `jsonRequest(fetchFn, url, options)`
  // elle-même : son propre `fetchFn(url, { ... })` interne matcherait sinon
  // comme un faux appel réel (même piège que la définition déjà exclue plus
  // bas pour l'appel `jsonRequest(...)` — ici c'est l'appel `fetchFn(...)`
  // qu'il faut neutraliser, à l'intérieur de CETTE définition précise).
  let maskedCode = code;
  const jsonRequestDefMatch = code.match(/function\s+jsonRequest\s*\([^)]*\)\s*\{/);
  if (jsonRequestDefMatch) {
    const start = jsonRequestDefMatch.index;
    const bodyStart = start + jsonRequestDefMatch[0].length;
    let depth = 1, i = bodyStart;
    for (; i < code.length && depth > 0; i++) {
      if (code[i] === '{') depth++;
      else if (code[i] === '}') depth--;
    }
    // Remplace le corps par des espaces (préserve les indices/longueurs pour
    // que tout le reste du fichier continue de matcher aux mêmes positions).
    maskedCode = code.slice(0, bodyStart) + code.slice(bodyStart, i).replace(/[^\n]/g, ' ') + code.slice(i);
  }

  function extractCallArg(source, calleeRe) {
    const results = [];
    for (const m of source.matchAll(calleeRe)) {
      const startIdx = m.index + m[0].length;
      // Découpe l'argument URL jusqu'à la virgule de niveau 0 suivante ou la
      // parenthèse fermante de niveau 0 (gère un seul niveau d'imbrication,
      // suffisant pour `${helper(x)}` / `encodeURIComponent(x)` à l'intérieur).
      let depth = 0, i = startIdx, out = '';
      for (; i < source.length; i++) {
        const ch = source[i];
        if (ch === '(' || ch === '{' || ch === '[') depth++;
        else if (ch === ')' || ch === '}' || ch === ']') {
          if (depth === 0) break;
          depth--;
        } else if (ch === ',' && depth === 0) break;
        out += ch;
      }
      const restAfterUrl = source.slice(i, i + 400);
      const methodMatch = restAfterUrl.match(/method:\s*['"](\w+)['"]/);
      results.push({ urlArgText: out, methodLiteral: methodMatch ? methodMatch[1].toUpperCase() : null });
    }
    return results;
  }

  // jsonRequest(<fetchArg>, <urlArg> ...) — exclut la déclaration de la
  // fonction elle-même (`function jsonRequest(fetchFn, url, options = {})`),
  // qui matcherait sinon comme un faux appel à sa propre signature.
  for (const call of extractCallArg(maskedCode, /(?<!function\s{1,20})\bjsonRequest\(\s*[\w.]+\s*,\s*/g)) {
    const candidates = resolveUrlArg(call.urlArgText, resolver);
    edges.push({ candidates, methodLiteral: call.methodLiteral, raw: call.urlArgText });
  }
  // fetch(<urlArg> ...) / options.fetch(<urlArg> ...) / fetchFn(<urlArg> ...) — motif direct
  for (const call of extractCallArg(maskedCode, /\b(?:global\.fetch|options\.fetch|context\.fetch|fetchFn|fetch)\(\s*/g)) {
    const candidates = resolveUrlArg(call.urlArgText, resolver);
    edges.push({ candidates, methodLiteral: call.methodLiteral, raw: call.urlArgText });
  }

  return edges;
}

function collectModules() {
  const files = walk(JS_DIR, []);
  const modules = [];
  for (const f of files) {
    const rel = path.relative(JS_DIR, f).replace(/\\/g, '/');
    const raw = fs.readFileSync(f, 'utf8');
    const code = stripBlockComments(raw);
    const hmFull = raw.match(/@komerce-arch\b[\s\S]*?\*\//);
    const hmLite = raw.match(/@komerce-arch-lite\b[\s\S]*?\*\//);
    const header = hmFull ? hmFull[0] : (hmLite ? hmLite[0] : '');
    const isLite = !!hmLite && !hmFull;

    // Espaces de nom globaux exportés par ce fichier : `root.KomerceXxx = ...`
    // ou `global.KomerceXxx = ...`. Un fichier peut en exporter plusieurs
    // (ex: market-catalog.js exporte KomerceMarketCatalog ET
    // KomerceCanonicalAdmin), ou RÉÉCRIRE un namespace existant (les modules
    // `*-decision.js` enveloppent `KomerceCanonicalXxx` via `.enhance()`).
    const exportsSet = new Set();
    for (const m of code.matchAll(/(?:root|global)\.(Komerce\w+)\s*=/g)) exportsSet.add(m[1]);

    // Chaîne const ENDPOINT → helper endpointFor() → jsonRequest(fetchFn, url)
    // (ou fetch() direct pour les modules de page HTML autonome) — voir
    // traceApiEdges() pour le détail de la résolution.
    const fetchCalls = [];
    for (const edge of traceApiEdges(code)) {
      if (!edge.candidates) {
        fetchCalls.push({ rawUrl: edge.raw, httpMethod: edge.methodLiteral, unresolved: true });
        continue;
      }
      for (const candidate of edge.candidates) {
        if (!/^\/api\//.test(candidate)) continue; // hors périmètre backend (assets, pages)
        fetchCalls.push({ rawUrl: candidate, httpMethod: edge.methodLiteral, unresolved: false });
      }
    }

    const legacyHits = LEGACY_TOKENS.filter(tok => raw.includes(tok));
    const marketAuthorityHits = [...code.matchAll(new RegExp(CLIENT_MARKET_AUTHORITY_RE, 'g'))].length;

    modules.push({
      file: rel,
      id: path.basename(rel).replace(/\.js$/, ''),
      hasHeader: !!header,
      isLite,
      role: header ? headerField(header, 'role') : null,
      domain: header ? headerField(header, 'domain') : null,
      layer: header ? headerField(header, 'layer') : null,
      criticality: header ? headerField(header, 'criticality') : null,
      doctrine: header ? headerList(header, 'doctrine') : [],
      depends: header ? headerList(header, 'depends') : [],
      usedBy: header ? headerList(header, 'used-by') : [],
      exportsGlobals: [...exportsSet],
      fetchCalls,
      legacyTokenHits: legacyHits,
      clientMarketAuthorityHits: marketAuthorityHits,
    });
  }
  return modules.sort((a, b) => a.file.localeCompare(b.file));
}

// ── 2. app.js : SURFACES, surfaceForPath(), dispatch surface → renderXxx → module global ──
function parseAppRouting() {
  if (!fs.existsSync(APP_FILE)) return { surfaces: {}, pathRules: [], surfaceToModule: {} };
  const raw = fs.readFileSync(APP_FILE, 'utf8');
  const code = stripLineComments(stripBlockComments(raw));

  // const SURFACES = Object.freeze({ KEY: 'value', ... });
  const surfaces = {};
  const surfacesBlockMatch = code.match(/const\s+SURFACES\s*=\s*Object\.freeze\(\{([\s\S]*?)\}\);/);
  if (surfacesBlockMatch) {
    for (const m of surfacesBlockMatch[1].matchAll(/(\w+):\s*'([^']+)'/g)) surfaces[m[1]] = m[2];
  }

  // surfaceForPath(): equality (`path === '/x'`) and regex (`/^\/x\/[^/]+$/.test(path)`)
  // rules, in source order, each followed by `return SURFACES.KEY;`.
  const pathRules = [];
  const bodyMatch = code.match(/function surfaceForPath\(pathname\)\s*\{([\s\S]*?)\n\s{2}\}/);
  if (bodyMatch) {
    const body = bodyMatch[1];
    // regex rule: /^...$/.test(path)) return SURFACES.KEY;
    for (const m of body.matchAll(/\/(\^[^/]+\$)\/\.test\(path\)\)?\s*\{?\s*return SURFACES\.(\w+);/g)) {
      pathRules.push({ kind: 'regex', pattern: m[1], surfaceKey: m[2] });
    }
    // equality rule: path === '/x' [|| path === '/y'] ...) return SURFACES.KEY;
    for (const m of body.matchAll(/((?:path === '[^']+'(?:\s*\|\|\s*)?)+)\)?\s*\{?\s*\breturn SURFACES\.(\w+);/g)) {
      const paths = [...m[1].matchAll(/path === '([^']+)'/g)].map(x => x[1]);
      pathRules.push({ kind: 'equality', paths, surfaceKey: m[2] });
    }
  }

  // Dispatch: `if (surface === SURFACES.KEY) return renderXxx(root, ...);`
  // then resolve renderXxx's body for `global.KomerceXxx` (or the
  // canonicalMount(global.KomerceXxx, ...) helper's first argument).
  const surfaceToRenderFn = {};
  const readyBodyMatch = code.match(/function renderReady\([^)]*\)\s*\{([\s\S]*?)\n\s{2}\}/);
  if (readyBodyMatch) {
    for (const m of readyBodyMatch[1].matchAll(/surface === SURFACES\.(\w+)\)\s*return\s+(\w+)\(/g)) {
      surfaceToRenderFn[m[1]] = m[2];
    }
  }
  // Défaut implicite (dernière ligne du if-chain, `return renderPilotageShell(...)`).
  if (readyBodyMatch && /return\s+renderPilotageShell\(/.test(readyBodyMatch[1])) {
    surfaceToRenderFn.PILOTAGE = surfaceToRenderFn.PILOTAGE || 'renderPilotageShell';
  }

  const surfaceToModule = {};
  for (const [key, fnName] of Object.entries(surfaceToRenderFn)) {
    // Shell wrapper (`renderXShell`) → trouve le `render: renderX` qu'il délègue.
    const shellMatch = code.match(new RegExp(`function ${fnName}\\([^)]*\\)\\s*\\{([\\s\\S]*?)\\n\\s{2}\\}`));
    let targetFn = fnName;
    if (shellMatch) {
      const delegate = shellMatch[1].match(/render:\s*(\w+),/);
      if (delegate) targetFn = delegate[1];
    }
    const fnMatch = code.match(new RegExp(`function ${targetFn}\\([^)]*\\)\\s*\\{([\\s\\S]*?)\\n\\s{2}\\}`));
    let moduleGlobal = null;
    if (fnMatch) {
      const g = fnMatch[1].match(/global\.(Komerce\w+)/);
      if (g) moduleGlobal = g[1];
    }
    surfaceToModule[key] = { renderFn: fnName, resolvedRenderFn: targetFn, moduleGlobal };
  }

  return { surfaces, pathRules, surfaceToModule };
}

// ── 3. navigation.js : DOMAINS/spaces, roles, hrefFor() overrides, surfaceForPath html ──
function parseNavigation() {
  if (!fs.existsSync(NAV_FILE)) return { items: [], hrefOverrides: [], htmlSurfaceForPath: {} };
  const raw = fs.readFileSync(NAV_FILE, 'utf8');
  const code = stripLineComments(stripBlockComments(raw));

  // Items plats (domaines sans spaces + spaces de chaque domaine groupé).
  const items = [];
  for (const m of code.matchAll(/\{\s*id:\s*'([^']+)',\s*label:\s*'([^']+)',\s*href:\s*'([^']+)',\s*roles:\s*Object\.freeze\(\[([^\]]*)\]\)\s*\}/g)) {
    const roles = m[4].split(',').map(s => s.trim().replace(/['"]/g, '')).filter(Boolean);
    items.push({ id: m[1], label: m[2], href: m[3], roles });
  }

  // hrefFor() overrides : `if (item.id === 'x' && user && user.role === 'y') return 'href';`
  const hrefOverrides = [];
  const hrefForMatch = code.match(/function hrefFor\([^)]*\)\s*\{([\s\S]*?)\n\s{2}\}/);
  if (hrefForMatch) {
    for (const m of hrefForMatch[1].matchAll(/item\.id === '([^']+)'\s*&&\s*user\s*&&\s*user\.role === '([^']+)'\)\s*\{\s*return '([^']+)';/g)) {
      hrefOverrides.push({ itemId: m[1], role: m[2], href: m[3] });
    }
  }

  // surfaceForPath() propre à navigation.js — gère les pages HTML autonomes.
  const htmlSurfaceForPath = { ...STANDALONE_HTML_SURFACES };

  return { items, hrefOverrides, htmlSurfaceForPath };
}

// ── 4. Résolution href → surface (réplique fidèle des deux surfaceForPath()) ──
function resolveHrefToSurface(href, appRouting, navParsed) {
  if (navParsed.htmlSurfaceForPath[href]) {
    return { surfaceId: navParsed.htmlSurfaceForPath[href], via: 'standalone-html' };
  }
  if (href === '/admin/settings') return { surfaceId: 'settings', via: 'app-equality' };

  for (const rule of appRouting.pathRules) {
    if (rule.kind === 'equality' && rule.paths.includes(href)) {
      return { surfaceId: appRouting.surfaces[rule.surfaceKey] || rule.surfaceKey.toLowerCase(), via: 'app-equality' };
    }
    if (rule.kind === 'regex') {
      try {
        const re = new RegExp(rule.pattern);
        if (re.test(href)) return { surfaceId: appRouting.surfaces[rule.surfaceKey] || rule.surfaceKey.toLowerCase(), via: 'app-regex' };
      } catch (_) { /* pattern non compilable statiquement — ignoré, jamais fatal */ }
    }
  }
  // Défaut implicite d'app.js::surfaceForPath (toute URL /admin/* non
  // reconnue retombe sur Pilotage — jamais un 404, jamais du Legacy).
  return { surfaceId: 'pilotage', via: 'app-default-fallback' };
}

// Lit le statut de preuve d'une opération OpenAPI. `contract-generate.js`
// n'écrit JAMAIS `x-contract-status` au niveau de l'opération elle-même : il
// l'écrit dans le schéma de la réponse 2xx la plus significative
// (`responses.<code>.content.<type>.schema['x-contract-status']`), ou dans
// `requestBody['x-contract-status']` pour le statut "joi" (validation de la
// requête, pas preuve de la réponse) — cf. l'en-tête documentaire de
// docs/contract/openapi.json (info.description) qui énumère exactement ces
// statuts : joi / test / route-read / service-read / scan-* / UNKNOWN.
// Chercher la clé au niveau racine de l'opération (comme le faisait ce
// générateur) ne la trouve donc jamais : `def['x-contract-status']` est
// toujours `undefined` pour les 639 opérations actuelles du contrat, quel
// que soit leur vrai statut. Résultat : la comparaison plus bas à la valeur
// littérale `'PROVEN'` ne pouvait jamais matcher (`'PROVEN'` n'est d'ailleurs
// jamais écrit nulle part dans le contrat), donc AUCUN endpoint, dans aucun
// des deux systèmes nerveux (Legacy et Canonical), ne pouvait jamais sortir
// autrement qu'`UNKNOWN` — y compris ceux couverts par un vrai test
// d'intégration/unitaire. Cette fonction va chercher le statut au bon
// endroit, de façon générique (aucune route, aucun fichier, aucun module
// nommé en dur : uniquement la structure OpenAPI standard réponses/requestBody).
function extractContractStatus(def) {
  if (!def || typeof def !== 'object') return null;
  if (def['x-contract-status']) return def['x-contract-status'];
  const responses = def.responses || {};
  const successCodes = Object.keys(responses).filter(c => /^2\d\d$/.test(c)).sort();
  for (const code of successCodes) {
    const content = responses[code] && responses[code].content;
    if (!content) continue;
    for (const media of Object.values(content)) {
      const st = media && media.schema && media.schema['x-contract-status'];
      if (st) return st;
    }
  }
  if (def.requestBody && def.requestBody['x-contract-status']) return def.requestBody['x-contract-status'];
  return null;
}

// Seul un statut réellement issu d'un test d'intégration/unitaire sur le
// corps HTTP constitue une preuve au sens de ce scanner — c'est la doctrine
// déjà documentée dans docs/contract/openapi.json (info.description) :
// "test → réponse couverte par un test [...]", contre "route-read"/
// "service-read" explicitement qualifiés là-bas de "confiance < test", et
// "joi"/"scan-*" qui ne portent pas sur le corps de la réponse. On ne réécrit
// pas cette doctrine ici, on se contente d'appliquer celle qui existe déjà.
function isProvenStatus(status) {
  return status === 'test';
}

// ── 5. Contrat OpenAPI (même mécanique que Legacy — jamais réinventée) ──
function parseOpenApiContract() {
  if (!fs.existsSync(OPENAPI_FILE)) return {};
  try {
    const doc = JSON.parse(fs.readFileSync(OPENAPI_FILE, 'utf8'));
    const status = {};
    for (const [route, methodsObj] of Object.entries(doc.paths || {})) {
      for (const [httpMethod, def] of Object.entries(methodsObj)) {
        status[`${httpMethod.toUpperCase()} ${route}`] = isProvenStatus(extractContractStatus(def)) ? 'PROVEN' : 'UNKNOWN';
      }
    }
    return status;
  } catch { return {}; }
}

// Normalise une URL fetch() Canonical (template literal ou concat) en
// template comparable au contrat OpenAPI (`{param}` à la place des segments
// dynamiques : ${marketCode}, ${orderReference}, ${encodeURIComponent(x)}…).
function normalizeFetchUrl(rawUrl) {
  let dynamic = false;
  const withoutQuery = rawUrl.split('?')[0]; // la query string n'est jamais un segment de chemin comparable au contrat
  const normalized = withoutQuery.replace(/\$\{[^}]*\}/g, () => { dynamic = true; return '{param}'; });
  // Toute URL qui ne commence pas littéralement par /api/ après normalisation
  // (ex: entièrement construite par variable) n'est pas comparable statiquement.
  if (!/^\/api\//.test(normalized)) return { normalized: null, dynamic };
  return { normalized: normalized.replace(/\/{2,}/g, '/').replace(/\/$/, '') || normalized, dynamic };
}

// Le contrat OpenAPI utilise `{marketCode}`, `{signalRef}`, etc. — pas un
// `{param}` générique. On compare donc par SHAPE (nombre + position des
// segments dynamiques), pas par nom littéral.
function shapeKey(routeTemplate) {
  return routeTemplate.replace(/\{[^}]+\}/g, '{param}');
}

// Deux index : par méthode+forme (quand la méthode est connue) et par forme
// seule, tous verbes confondus (quand elle ne l'est pas — jamais on ne
// suppose GET par défaut, ce qui fabriquerait de faux NOT_FOUND sur des
// endpoints POST/PATCH réels : voir méthode non littérale dans jsonRequest()).
function buildContractShapeIndex(contract) {
  const byMethodShape = {};
  const byShapeOnly = {};
  for (const key of Object.keys(contract)) {
    const [method, route] = key.split(' ');
    const shaped = shapeKey(route);
    const methodShapeKeyStr = `${method} ${shaped}`;
    byMethodShape[methodShapeKeyStr] = byMethodShape[methodShapeKeyStr] || [];
    byMethodShape[methodShapeKeyStr].push({ route, status: contract[key], method });
    byShapeOnly[shaped] = byShapeOnly[shaped] || [];
    byShapeOnly[shaped].push({ route, status: contract[key], method });
  }
  return { byMethodShape, byShapeOnly };
}

// ── Construction du modèle ──────────────────────────────────────────────────
function build() {
  const modules = collectModules();
  const appRouting = parseAppRouting();
  const navParsed = parseNavigation();
  const contract = parseOpenApiContract();
  const shapeIndex = buildContractShapeIndex(contract);

  const moduleByGlobal = {};
  for (const mod of modules) {
    for (const g of mod.exportsGlobals) {
      moduleByGlobal[g] = moduleByGlobal[g] || [];
      moduleByGlobal[g].push(mod.file);
    }
  }

  // ── Matrice nav : pour chaque rôle × item de navigation, résout la
  //    destination réelle (avec override par rôle) puis la surface, le
  //    module, et le statut des endpoints que ce module appelle. ──
  const navMatrix = [];
  const surfaceWithoutModule = [];
  const navHrefUnresolved = [];

  for (const item of navParsed.items) {
    for (const role of ALL_ROLES) {
      if (!item.roles.includes(role)) continue;
      const override = navParsed.hrefOverrides.find(o => o.itemId === item.id && o.role === role);
      const href = override ? override.href : item.href;
      const resolved = resolveHrefToSurface(href, appRouting, navParsed);
      const surfaceId = resolved.surfaceId;

      let moduleFiles = [];
      let moduleGlobal = null;
      if (resolved.via === 'standalone-html') {
        // Page HTML autonome : pas de dispatch app.js à suivre — son
        // inventaire de scripts est traité séparément (voir buildHtmlSurfaces).
      } else {
        const surfaceKeyEntry = Object.entries(appRouting.surfaces).find(([, v]) => v === surfaceId);
        const surfaceKey = surfaceKeyEntry ? surfaceKeyEntry[0] : null;
        const dispatch = surfaceKey ? appRouting.surfaceToModule[surfaceKey] : null;
        moduleGlobal = dispatch ? dispatch.moduleGlobal : null;
        moduleFiles = moduleGlobal ? (moduleByGlobal[moduleGlobal] || []) : [];
        if (surfaceKey && dispatch && !moduleGlobal) {
          surfaceWithoutModule.push(`${surfaceId} (rendu par ${dispatch.resolvedRenderFn}, aucun global.Komerce* résolu statiquement)`);
        }
      }

      // Le fallback par défaut d'app.js::surfaceForPath n'est légitime QUE
      // pour `/admin/pilotage` lui-même (aucune règle explicite ne le
      // matche dans app.js — c'est la valeur de repli assumée en fin de
      // fonction). Toute AUTRE href qui tombe sur ce même défaut est un
      // signe réel de destination non reconnue.
      if (resolved.via === 'app-default-fallback' && href !== '/admin/pilotage') {
        navHrefUnresolved.push(`${item.id} → ${href} (rôle ${role})`);
      }

      navMatrix.push({
        role, itemId: item.id, label: item.label, href, surfaceId,
        resolvedVia: resolved.via, moduleFiles,
      });
    }
  }

  // ── Chaîne API : pour chaque module, chaque fetch() vers /api/, statut contrat ──
  const apiEdges = [];
  for (const mod of modules) {
    for (const call of mod.fetchCalls) {
      if (call.unresolved) {
        apiEdges.push({
          module: mod.file, rawUrl: call.rawUrl, httpMethod: call.httpMethod || '?',
          normalized: null, matchedRoute: null, contractStatus: 'UNRESOLVED',
        });
        continue;
      }
      const { normalized, dynamic } = normalizeFetchUrl(call.rawUrl);
      let status;
      let matchedRoute = null;
      let effectiveMethod = call.httpMethod;
      if (!normalized) {
        status = 'UNRESOLVED';
      } else {
        const shaped = shapeKey(normalized);
        let candidates;
        if (call.httpMethod) {
          candidates = shapeIndex.byMethodShape[`${call.httpMethod} ${shaped}`];
        } else {
          // Méthode non littérale (ex: `{ method, body }` où `method` est une
          // variable) — recherche tous verbes confondus plutôt que de
          // supposer GET, pour ne jamais fabriquer un faux NOT_FOUND.
          candidates = shapeIndex.byShapeOnly[shaped];
        }
        if (candidates && candidates.length) {
          matchedRoute = candidates[0].route;
          effectiveMethod = call.httpMethod || candidates[0].method;
          status = candidates.some(c => c.status === 'PROVEN') ? 'PROVEN' : candidates[0].status;
        } else {
          status = dynamic ? 'NOT_FOUND_DYNAMIC' : 'NOT_FOUND';
        }
      }
      apiEdges.push({
        module: mod.file, rawUrl: call.rawUrl, httpMethod: effectiveMethod || 'GET*',
        normalized, matchedRoute, contractStatus: status,
      });
    }
  }

  // ── Diagnostics ──────────────────────────────────────────────────────────
  const unprovenContracts = [...new Set(
    apiEdges.filter(e => e.contractStatus === 'UNKNOWN').map(e => `${e.httpMethod} ${e.matchedRoute}`)
  )].sort();
  const notFoundContracts = [...new Set(
    apiEdges.filter(e => e.contractStatus === 'NOT_FOUND').map(e => `${e.httpMethod} ${e.normalized} (${e.module})`)
  )].sort();
  const notFoundDynamic = [...new Set(
    apiEdges.filter(e => e.contractStatus === 'NOT_FOUND_DYNAMIC').map(e => `${e.httpMethod} ${e.normalized} (${e.module})`)
  )].sort();
  const unresolvedFetches = [...new Set(
    apiEdges.filter(e => e.contractStatus === 'UNRESOLVED').map(e => `${e.rawUrl} (${e.module})`)
  )].sort();

  const legacyDependencies = modules
    .filter(m => m.legacyTokenHits.length)
    .map(m => `${m.file} (${m.legacyTokenHits.join(', ')})`)
    .sort();

  const clientMarketAuthoritySuspects = modules
    .filter(m => m.clientMarketAuthorityHits > 0)
    .map(m => `${m.file} (${m.clientMarketAuthorityHits} occurrence(s))`)
    .sort();

  const moduleFilesWithoutHeader = modules.filter(m => !m.hasHeader).map(m => m.file).sort();

  // NOTE : une détection "module exporté jamais référencé" a été envisagée
  // (candidat "workspace mort") puis abandonnée pour ce premier passage —
  // trop de faux positifs plausibles (modules montés uniquement depuis une
  // page HTML autonome, ou référencés par un autre module via un nom
  // construit dynamiquement). Mieux vaut ne rien affirmer que d'inventer un
  // statut non prouvé ; à reprendre dans un lot dédié si le besoin se confirme.

  navHrefUnresolved.sort();

  const summary = {
    navItems: navParsed.items.length,
    navMatrixEntries: navMatrix.length,
    canonicalModules: modules.length,
    apiEdgesTraced: apiEdges.length,
    surfaceWithoutModule: surfaceWithoutModule.length,
    navHrefUnresolved: navHrefUnresolved.length,
    unprovenContracts: unprovenContracts.length,
    notFoundContracts: notFoundContracts.length,
    notFoundDynamic: notFoundDynamic.length,
    unresolvedFetches: unresolvedFetches.length,
    legacyDependencies: legacyDependencies.length,
    clientMarketAuthoritySuspects: clientMarketAuthoritySuspects.length,
    moduleFilesWithoutHeader: moduleFilesWithoutHeader.length,
  };

  return {
    generatedAt: new Date().toISOString(),
    summary,
    navMatrix,
    apiEdges,
    modules: modules.map(m => ({
      file: m.file, hasHeader: m.hasHeader, isLite: m.isLite, role: m.role,
      domain: m.domain, layer: m.layer, criticality: m.criticality,
      doctrine: m.doctrine, exportsGlobals: m.exportsGlobals,
      fetchCount: m.fetchCalls.length,
    })),
    diagnostics: {
      surfaceWithoutModule: surfaceWithoutModule.sort(),
      navHrefUnresolved,
      unprovenContracts,
      notFoundContracts,
      notFoundDynamic,
      unresolvedFetches,
      legacyDependencies,
      clientMarketAuthoritySuspects,
      moduleFilesWithoutHeader,
    },
  };
}

// ── Rendu Markdown ───────────────────────────────────────────────────────────
function renderMd(model) {
  const s = model.summary;
  const d = model.diagnostics;
  const L = [];
  L.push('# Dashboards 360 — Canonical (généré)');
  L.push('');
  L.push('> ⚠️ Fichier **généré** par `scripts/gen-dashboards-360-canonical.js`. Ne pas éditer à la main.');
  L.push(`> Régénéré le ${model.generatedAt}.`);
  L.push('> Contrepartie de `docs/DASHBOARDS_360.md` (Legacy 1). Les deux coexistent tant que le rollback `?legacy=1` existe (`bootstrap/html-routes.js`).');
  L.push('> Chaîne de preuve : `navigation.js` (item × rôle) → `hrefFor()` → `app.js::surfaceForPath()` → module (`global.Komerce*`) → `fetch()` → `docs/contract/openapi.json`.');
  L.push('');
  L.push('## Synthèse');
  L.push('');
  L.push(`- Items de navigation déclarés : **${s.navItems}** → **${s.navMatrixEntries}** entrées (item × rôle visible)`);
  L.push(`- Modules JS Canonical scannés : **${s.canonicalModules}**`);
  L.push(`- Arêtes API tracées (\`fetch()\` vers \`/api/\`) : **${s.apiEdgesTraced}**`);
  L.push(`- 🔴 Surfaces de navigation sans module résolu : **${s.surfaceWithoutModule}**`);
  L.push(`- 🔴 Destination de navigation dont l'URL ne résout vers aucune surface connue (retombe sur Pilotage par défaut) : **${s.navHrefUnresolved}**`);
  L.push(`- 🔴 Endpoints appelés mais absents du contrat OpenAPI (statiques) : **${s.notFoundContracts}**`);
  L.push(`- 🟠 Endpoints appelés absents du contrat (URL dynamique — à vérifier à la main) : **${s.notFoundDynamic}**`);
  L.push(`- ⚪ Endpoints appelés mais non prouvés par un test (\`UNKNOWN\` dans le contrat) : **${s.unprovenContracts}**`);
  L.push(`- ❓ \`fetch()\` dont l'URL n'a pas pu être résolue statiquement : **${s.unresolvedFetches}**`);
  L.push(`- 🟣 Modules Canonical avec une dépendance textuelle vers Legacy 1 : **${s.legacyDependencies}**`);
  L.push(`- 🟡 Modules avec un motif \`market_id\`/\`marketId\` construit côté navigateur (à vérifier — le serveur rejette déjà ceci sur Action Center, cf. \`rejectBrowserAuthority\`) : **${s.clientMarketAuthoritySuspects}**`);
  L.push(`- Modules sans header \`@komerce-arch\` : **${s.moduleFilesWithoutHeader}**`);
  L.push('');

  if (s.surfaceWithoutModule || s.navHrefUnresolved || s.notFoundContracts) {
    L.push('## 1. Anomalies à traiter (aucune tolérance nouvelle ajoutée)');
    L.push('');
    if (d.surfaceWithoutModule.length) L.push(`- 🔴 **Surfaces sans module** : ${d.surfaceWithoutModule.map(x => '`' + x + '`').join(', ')}`);
    if (d.navHrefUnresolved.length) L.push(`- 🔴 **Nav → surface non résolue** : ${d.navHrefUnresolved.map(x => '`' + x + '`').join(', ')}`);
    if (d.notFoundContracts.length) L.push(`- 🔴 **Endpoint appelé, absent du contrat** : ${d.notFoundContracts.map(x => '`' + x + '`').join(', ')}`);
    L.push('');
  }

  L.push('## 2. Signaux informatifs (non bloquants, jamais inventés)');
  L.push('');
  if (d.notFoundDynamic.length) L.push(`- 🟠 Endpoint dynamique absent du contrat (à vérifier à la main) : ${d.notFoundDynamic.map(x => '`' + x + '`').join(', ')}`);
  if (d.unprovenContracts.length) L.push(`- ⚪ Contrats non prouvés réellement appelés : ${d.unprovenContracts.map(x => '`' + x + '`').join(', ')}`);
  if (d.unresolvedFetches.length) L.push(`- ❓ \`fetch()\` non résolus statiquement : ${d.unresolvedFetches.map(x => '`' + x + '`').join(', ')}`);
  if (d.legacyDependencies.length) L.push(`- 🟣 Dépendance textuelle Legacy détectée : ${d.legacyDependencies.map(x => '`' + x + '`').join(', ')}`);
  if (d.clientMarketAuthoritySuspects.length) L.push(`- 🟡 Motif \`market_id\` navigateur détecté : ${d.clientMarketAuthoritySuspects.map(x => '`' + x + '`').join(', ')}`);
  if (d.moduleFilesWithoutHeader.length) L.push(`- Modules sans header : ${d.moduleFilesWithoutHeader.map(x => '`' + x + '`').join(', ')}`);
  if (!d.notFoundDynamic.length && !d.unprovenContracts.length && !d.unresolvedFetches.length && !d.legacyDependencies.length && !d.clientMarketAuthoritySuspects.length && !d.moduleFilesWithoutHeader.length) {
    L.push('_Aucun signal informatif._');
  }
  L.push('');

  L.push('## 3. Matrice navigation × rôle × surface × module');
  L.push('');
  L.push('| Rôle | Item nav | Destination | Surface résolue | Module(s) |');
  L.push('|---|---|---|---|---|');
  for (const e of model.navMatrix.sort((a, b) => a.itemId.localeCompare(b.itemId) || a.role.localeCompare(b.role))) {
    const mods = e.moduleFiles.length ? e.moduleFiles.map(f => '`' + f + '`').join(', ') : (e.resolvedVia === 'standalone-html' ? '_(page HTML autonome — voir §5)_' : '🔴 aucun');
    L.push(`| ${e.role} | ${e.label} | \`${e.href}\` | ${e.surfaceId} | ${mods} |`);
  }
  L.push('');

  L.push('## 4. Chaîne module → fetch() → contrat');
  L.push('');
  L.push('| Module | Méthode | URL appelée | Statut contrat |');
  L.push('|---|---|---|---|');
  const statusIcon = {
    PROVEN: '🟢 prouvé', UNKNOWN: '⚪ non prouvé', NOT_FOUND: '🔴 absent du contrat',
    NOT_FOUND_DYNAMIC: '🟠 absent (dynamique)', UNRESOLVED: '❓ url non résolue',
  };
  for (const e of model.apiEdges.sort((a, b) => a.module.localeCompare(b.module))) {
    L.push(`| \`${e.module}\` | \`${e.httpMethod}\` | \`${e.rawUrl}\` | ${statusIcon[e.contractStatus] || e.contractStatus} |`);
  }
  L.push('');

  L.push('## 5. Pages HTML autonomes (hors dispatch app.js)');
  L.push('');
  L.push('Ces surfaces ne passent pas par `app.js::surfaceForPath()` — chacune est');
  L.push('une page HTML servie telle quelle par `bootstrap/html-routes.js`, avec ses');
  L.push('propres `<script>`. Inventaire non couvert par la matrice ci-dessus :');
  L.push('');
  for (const [href, surfaceId] of Object.entries(STANDALONE_HTML_SURFACES)) {
    L.push(`- \`${href}\` → surface \`${surfaceId}\``);
  }
  L.push('');

  L.push('---');
  L.push('*Carte vérifiée par `dashboards:canonical:360:check` (cliquet sur les anomalies §1 ; les signaux §2 ne bloquent jamais). Agrégée avec Legacy dans `dashboards:360:check`.*');
  return L.join('\n') + '\n';
}

// ── Cliquet ──────────────────────────────────────────────────────────────────
function loadBaseline() { try { return JSON.parse(fs.readFileSync(BASELINE, 'utf8')); } catch { return null; } }

const RATCHET_KEYS = ['surfaceWithoutModule', 'navHrefUnresolved', 'notFoundContracts'];

function runCheck(model) {
  const base = loadBaseline();
  if (!base) {
    console.error(`${RED}${BLD}✖ Aucune baseline Canonical 360.${R} Lance d'abord : node scripts/gen-dashboards-360-canonical.js --save`);
    return 1;
  }
  const d = model.diagnostics;
  const news = [];
  const diff = (key, label) => {
    const set = new Set(base[key] || []);
    for (const x of d[key]) if (!set.has(x)) news.push(`${label} : ${x}`);
  };
  diff('surfaceWithoutModule', '🔴 nouvelle surface sans module');
  diff('navHrefUnresolved', '🔴 nouvelle destination nav non résolue');
  diff('notFoundContracts', '🔴 nouvel endpoint absent du contrat');

  const drops = [];
  for (const key of RATCHET_KEYS) {
    const now = new Set(d[key]);
    for (const x of (base[key] || [])) if (!now.has(x)) drops.push(`${key} : ${x}`);
  }

  console.log(`${BLD}Dashboards 360 Canonical — ${model.summary.navItems} items nav, ${model.summary.canonicalModules} modules, ${model.summary.apiEdgesTraced} arêtes API${R}`);
  if (model.summary.unprovenContracts) {
    console.log(`${DIM}  ⚪ ${model.summary.unprovenContracts} contrat(s) non prouvé(s) — informatif.${R}`);
  }
  if (drops.length) {
    console.log(`${DIM}  Anomalies résolues depuis la baseline (fige-les avec --save) :${R}`);
    drops.forEach(x => console.log(`${GRN}   ↓ ${x}${R}`));
  }
  if (news.length === 0) {
    console.log(`${GRN}${BLD}✔ Aucune nouvelle anomalie bloquante hors baseline.${R}`);
    if ((base.surfaceWithoutModule || []).length || (base.navHrefUnresolved || []).length || (base.notFoundContracts || []).length) {
      console.log(`${YLW}  ⚠ Dette déjà connue en baseline (voir docs/DASHBOARDS_360_CANONICAL.md §1) — non bloquante ici, à traiter en petits lots.${R}`);
    }
    return 0;
  }
  console.log(`${RED}${BLD}✖ ${news.length} nouvelle(s) anomalie(s) bloquante(s) :${R}`);
  news.forEach(x => console.log(`${RED}   ↑ ${x}${R}`));
  console.log(`${DIM}  Corrige la chaîne nav/surface/module/endpoint, ou — si légitime — fige : node scripts/gen-dashboards-360-canonical.js --save${R}`);
  return 1;
}

// Exports pour tests unitaires (LOT 3 — non-régression sur l'extraction du
// statut de contrat) — n'affecte pas l'exécution CLI ci-dessous, gardée
// derrière require.main===module (même convention que gen-boutique-360.js).
module.exports = {
  build, renderMd, parseOpenApiContract,
  extractContractStatus, isProvenStatus,
};

if (require.main === module) {
  // ── Main ───────────────────────────────────────────────────────────────
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
    console.log(`${GRN}${BLD}✔ Baseline Dashboards 360 Canonical figée${R} (${d.surfaceWithoutModule.length} surface(s) sans module, ${d.navHrefUnresolved.length} nav non résolue(s), ${d.notFoundContracts.length} endpoint(s) absent(s) du contrat — dette réelle conservée telle quelle, voir le .md).`);
    process.exit(0);
  }

  if (CHECK) {
    process.exit(runCheck(model));
  }

  if (!fs.existsSync(DOCS)) fs.mkdirSync(DOCS, { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify(model, null, 2));
  fs.writeFileSync(OUT_MD, renderMd(model));
  console.log(`${GRN}${BLD}✔ DASHBOARDS_360_CANONICAL généré${R} ${DIM}(${model.summary.navItems} items nav, ${model.summary.canonicalModules} modules, ${model.summary.apiEdgesTraced} arêtes API)${R}`);
  console.log(`${CYN}  docs/DASHBOARDS_360_CANONICAL.md${R}  +  ${CYN}docs/DASHBOARDS_360_CANONICAL.json${R}`);
  const s = model.summary;
  if (s.surfaceWithoutModule || s.navHrefUnresolved || s.notFoundContracts) {
    console.log(`${YLW}  ⚠ ${s.surfaceWithoutModule} surface(s) sans module, ${s.navHrefUnresolved} nav non résolue(s), ${s.notFoundContracts} endpoint(s) absent(s) — voir §1.${R}`);
  }
}
