#!/usr/bin/env node
'use strict';

/**
 * check-css-vars.js — Garde-fou custom properties CSS orphelines
 *
 * Né de l'incident #k-modal-main / #k-modal-cart-slot (même famille : le gate
 * est vert, le rendu est cassé en silence) et de l'audit manuel du 2026-07-24
 * qui a trouvé hero.css:274 `font-family: var(--font-body)` — token qui
 * n'existe nulle part (le vrai token est `--font`), sans fallback → la police
 * retombait sur la police par défaut du navigateur, aucune erreur console.
 *
 * Principe : `var(--x)` sans qu'aucun `--x:` ne soit jamais déclaré dans le
 * CSS est soit (a) un bug de frappe / de rename incomplet, soit (b) une
 * variable posée dynamiquement en JS via .style.setProperty('--x', ...), soit
 * (c) un alias volontairement laissé sans valeur de base (toujours utilisé
 * avec fallback). (b) et (c) sont légitimes → allowlist explicite, pas de
 * bug silencieux à leur sujet. Seul (a) doit bloquer.
 *
 * Ce que ce script vérifie :
 *   V-CV1  `var(--x)` SANS fallback où --x n'est jamais défini en CSS ni posé
 *          en JS (setProperty) → ERREUR. Sans fallback, un navigateur retombe
 *          sur la valeur initiale de la propriété (souvent visible, parfois
 *          désastreux : font-family, color, background deviennent silencieux).
 *   V-CV2  `var(--x, fallback)` AVEC fallback où --x n'est jamais défini
 *          → AVERTISSEMENT. Le rendu ne casse pas (le fallback s'applique
 *          toujours), mais c'est soit une intention jamais posée (thème
 *          jamais branché), soit un fallback-of-fallback mort (ex.
 *          `var(--ocean, var(--cta))` où --ocean existe toujours → --cta ne
 *          se déclenche jamais). Signal utile, pas bloquant par défaut.
 *
 * Ce que ce script NE fait PAS :
 *   - Résoudre les cascades / héritage réels (pas de moteur CSS). Une var
 *     définie seulement dans un sélecteur qui ne s'applique jamais à
 *     l'élément qui la consomme resterait invisible ici — hors scope,
 *     cohérent avec css-guard.js / check-dom-contract.js.
 *   - Suivre les concaténations dynamiques (`--k-${n}`) — listées en info.
 *
 * Usage :
 *   node scripts/check-css-vars.js [--strict]
 *   npm run check:css-vars
 *
 * --strict promeut les avertissements V-CV2 en erreurs (une fois le
 * manifeste trié, comme check-dom-contract.js --strict pour V-9).
 */

const fs   = require('fs');
const path = require('path');

const ROOT     = path.resolve(__dirname, '..');
const CSS_DIR  = path.join(ROOT, 'css');
const JS_DIR   = path.join(ROOT, 'js');
const MANIFEST = path.join(ROOT, 'governance', 'css-vars-manifest.json');

const RESET = '\x1b[0m', RED = '\x1b[31m', YELLOW = '\x1b[33m',
      GREEN = '\x1b[32m', BOLD = '\x1b[1m', DIM = '\x1b[2m', CYAN = '\x1b[36m';

const args   = process.argv.slice(2);
const STRICT = args.includes('--strict');

function rel(p) { return path.relative(ROOT, p); }

function collectFiles(dir, ext) {
  const out = [];
  function walk(d) {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === 'coverage'
        || e.name === 'playwright-report' || e.name === 'test-results') continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) { walk(full); continue; }
      if (e.name.endsWith(ext)) out.push(full);
    }
  }
  walk(dir);
  return out;
}

function loadManifest() {
  if (!fs.existsSync(MANIFEST)) {
    console.log(`${YELLOW}⚠  Manifeste introuvable : ${rel(MANIFEST)} — aucune allowlist chargée.${RESET}`);
    return { jsSetProperties: new Set(), fallbackOnlyAllowed: new Set() };
  }
  const raw = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  return {
    jsSetProperties: new Set((raw.jsSetProperties || []).map(x => x.var)),
    fallbackOnlyAllowed: new Set((raw.fallbackOnlyAllowed || []).map(x => x.var)),
  };
}

// ── Collecte des définitions --x: dans le CSS ──────────────────────────────
function collectDefinedVars(cssFiles) {
  const defined = new Set();
  const DEF_RE = /(--[a-zA-Z0-9_-]+)\s*:/g;
  for (const file of cssFiles) {
    const src = fs.readFileSync(file, 'utf8');
    let m;
    while ((m = DEF_RE.exec(src))) defined.add(m[1]);
  }
  return defined;
}

// ── Collecte des --x posées dynamiquement en JS (.setProperty) ────────────
function collectJsSetVars(jsFiles) {
  const set = new Set();
  const dynamic = [];
  const SET_RE = /\.setProperty\(\s*(['"`])(--[a-zA-Z0-9_-]+|[^'"`]*\$\{[^}]+\}[^'"`]*)\1/g;
  for (const file of jsFiles) {
    const src = fs.readFileSync(file, 'utf8');
    let m;
    while ((m = SET_RE.exec(src))) {
      const name = m[2];
      if (name.includes('${')) { dynamic.push({ file, name }); continue; }
      set.add(name);
    }
  }
  return { set, dynamic };
}

// ── Collecte des var(--x[, fallback]) utilisées ────────────────────────────
// Parse manuel (pas de simple regex) pour gérer les fallbacks imbriqués
// comme var(--ocean, var(--cta)) sans confondre les parenthèses.
function collectUsages(files) {
  const usages = []; // { name, hasFallback, file, line }
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    const lines = src.split('\n');
    const VAR_START = /var\(\s*(--[a-zA-Z0-9_-]+)/g;
    let m;
    while ((m = VAR_START.exec(src))) {
      const name = m[1];
      const openParenIdx = src.indexOf('(', m.index);
      // Trouver la parenthèse fermante correspondante (profondeur simple).
      let depth = 1, i = openParenIdx + 1;
      let sawComma = false;
      while (i < src.length && depth > 0) {
        if (src[i] === '(') depth++;
        else if (src[i] === ')') depth--;
        else if (src[i] === ',' && depth === 1) sawComma = true;
        i++;
      }
      const lineNo = src.slice(0, m.index).split('\n').length;
      usages.push({ name, hasFallback: sawComma, file, line: lineNo });
    }
  }
  return usages;
}

function main() {
  const cssFiles = collectFiles(CSS_DIR, '.css');
  const manifest = loadManifest();

  const definedVars = collectDefinedVars(cssFiles);
  const { set: jsSetVars, dynamic: dynamicJsSets } = collectJsSetVars(collectFiles(JS_DIR, '.js'));
  const usages = collectUsages(cssFiles);

  console.log(`\n${BOLD}${CYAN}━━━ check-css-vars — Komerce Boutique ━━━${RESET}`);
  console.log(`${DIM}${cssFiles.length} feuille(s) CSS — ${definedVars.size} custom prop(s) définies — ${usages.length} usage(s) var(...)${RESET}\n`);

  const errors = [];
  const warnings = [];

  const seenNoFallback = new Map();
  const seenWithFallback = new Map();

  for (const u of usages) {
    if (definedVars.has(u.name)) continue;
    if (jsSetVars.has(u.name)) continue;
    if (manifest.jsSetProperties.has(u.name)) continue;

    if (manifest.fallbackOnlyAllowed.has(u.name)) continue;

    if (!u.hasFallback) {
      if (!seenNoFallback.has(u.name)) seenNoFallback.set(u.name, []);
      seenNoFallback.get(u.name).push(u);
    } else {
      if (!seenWithFallback.has(u.name)) seenWithFallback.set(u.name, []);
      seenWithFallback.get(u.name).push(u);
    }
  }

  for (const [name, occs] of seenNoFallback) {
    const locs = occs.slice(0, 3).map(o => `${rel(o.file)}:${o.line}`).join(', ');
    errors.push({
      code: 'V-CV1',
      msg: `var(${name}) sans fallback, jamais défini`,
      detail: `Aucun \`${name}:\` dans css/, aucun .setProperty('${name}', ...) en JS. Rendu silencieusement replié sur la valeur initiale de la propriété (souvent visible à l'œil, jamais en CI) — ${locs}${occs.length > 3 ? ` …(+${occs.length - 3})` : ''}`,
    });
  }
  for (const [name, occs] of seenWithFallback) {
    const locs = occs.slice(0, 3).map(o => `${rel(o.file)}:${o.line}`).join(', ');
    warnings.push({
      code: 'V-CV2',
      msg: `var(${name}, fallback) — ${name} jamais défini`,
      detail: `Le fallback s'applique systématiquement (aucun \`${name}:\` en CSS, aucun setProperty JS). Si voulu, ajoute-le à fallbackOnlyAllowed dans ${rel(MANIFEST)} ; sinon c'est un token jamais branché — ${locs}${occs.length > 3 ? ` …(+${occs.length - 3})` : ''}`,
    });
  }

  if (dynamicJsSets.length > 0) {
    console.log(`${DIM}ℹ  ${dynamicJsSets.length} .setProperty avec nom dynamique (non vérifiable statiquement, ignoré)${RESET}\n`);
  }

  function printIssue(x, prefix, color) {
    console.log(`${color}${prefix}${RESET} ${BOLD}[${x.code}]${RESET} ${x.msg}`);
    if (x.detail) console.log(`  ${DIM}↳ ${x.detail}${RESET}`);
  }

  const promoted = STRICT ? warnings : [];
  const activeWarnings = STRICT ? [] : warnings;
  const allErrors = [...errors, ...promoted];

  for (const e of allErrors) printIssue(e, '✖', RED);
  for (const w of activeWarnings) printIssue(w, '⚠', YELLOW);

  console.log(`\n${BOLD}${CYAN}━━━ Résultat ━━━${RESET}`);
  if (allErrors.length === 0 && activeWarnings.length === 0) {
    console.log(`${GREEN}${BOLD}✔ Aucune custom property orpheline.${RESET}\n`);
    process.exit(0);
  }
  if (allErrors.length > 0) {
    console.log(`${RED}${BOLD}✖ ${allErrors.length} erreur(s)${RESET}${activeWarnings.length ? `, ${YELLOW}${activeWarnings.length} avertissement(s)${RESET}` : ''}`);
    console.log(`${DIM}Corrigez les erreurs (exit 1) avant de merger.${RESET}\n`);
    process.exit(1);
  }
  console.log(`${YELLOW}⚠ 0 erreur, ${activeWarnings.length} avertissement(s) — exit 0${RESET}`);
  console.log(`${DIM}Triage recommandé : chaque custom property orpheline est soit un bug, soit à classer dans le manifeste. Relance avec --strict une fois trié.${RESET}\n`);
  process.exit(0);
}

if (require.main === module) {
  main();
}

module.exports = {
  collectDefinedVars,
  collectJsSetVars,
  collectUsages,
};
