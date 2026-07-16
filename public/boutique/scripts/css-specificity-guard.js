#!/usr/bin/env node
'use strict';

/**
 * css-specificity-guard.js — Détecte les overrides silencieux par spécificité
 * impliquant une classe d'état globale posée en permanence sur <html>/<body>.
 *
 * Complément de css-guard.js, PAS un remplacement.
 *
 *   css-guard.js détecte : deux règles avec le MÊME sélecteur littéral, même
 *     @media, valeurs différentes → conflit dépendant de l'ordre d'import.
 *   css-specificity-guard.js détecte : une règle "avec classe globale"
 *     (ex. html.k-mobile-premium-v1 #k-modal .x) et une règle "sans" (ex.
 *     #k-modal .x) qui ciblent le MÊME élément mais ont des SÉLECTEURS
 *     DIFFÉRENTS — donc invisibles pour css-guard.js — où celle qui a la
 *     classe globale gagne TOUJOURS par spécificité, quel que soit l'ordre
 *     des fichiers. C'est un override qui n'a pas besoin d'être "après" pour
 *     gagner : c'est le bug trouvé sur MDM-8 (k-mobile-premium-v1 écrasant
 *     modal-mobile-canonical.css).
 *
 * Étape 1 : découvre dynamiquement les classes globales candidates en
 *   grepant `document.documentElement.classList.add(...)` et
 *   `document.body.classList.add(...)` dans js/*.js — pas de liste en dur,
 *   pour rester valable si de nouvelles classes du même genre apparaissent.
 *
 * Étape 2 : parse css/dist/*.css (mêmes bundles livrés que css-guard.js),
 *   repère les règles dont le sélecteur contient une de ces classes comme
 *   token de classe, calcule le sélecteur "de base" équivalent (sans la
 *   classe, sans le html/body ancré en tête), et cherche toute règle avec
 *   exactement ce sélecteur de base ailleurs dans le bundle.
 *
 * Étape 3 : pour chaque paire trouvée, compare la spécificité CSS (id,
 *   classe, type) des deux sélecteurs. Si la version "classe globale" gagne
 *   ET qu'au moins une propriété partagée a une valeur différente → signalé.
 *
 * Limite assumée : ne sait pas dire si la classe globale est retirée
 * dynamiquement (ex. cart-open, modal-open — légitimement transitoires) ou
 * posée en permanence (ex. k-mobile-premium-v1, k-home-premium-v1). Le
 * rapport liste tout ; c'est à la lecture humaine de trier — d'où le mode
 * cliquet (--save/--strict) au lieu d'un blocage automatique brutal.
 *
 * Usage :
 *   node scripts/css-specificity-guard.js                 # rapport
 *   node scripts/css-specificity-guard.js --strict         # exit(1) si hausse
 *   node scripts/css-specificity-guard.js --save           # fige la baseline
 *   node scripts/css-specificity-guard.js --classes-only    # étape 1 seule
 */

const fs   = require('fs');
const path = require('path');

const ROOT      = path.resolve(__dirname, '..');
const CSS_DIR   = path.join(ROOT, 'css', 'dist');
const JS_DIR    = path.join(ROOT, 'js');
const BASELINE  = path.join(__dirname, '.css-specificity-guard-baseline.json');
const DIST_FILES = ['base.css', 'components.css', 'desktop.css', 'event.css'];

const args        = process.argv.slice(2);
const strict      = args.includes('--strict');
const save        = args.includes('--save');
const classesOnly = args.includes('--classes-only');

const RED = '\x1b[31m', GRN = '\x1b[32m', YLW = '\x1b[33m', BLD = '\x1b[1m', DIM = '\x1b[2m', R = '\x1b[0m';

/* ── Étape 1 : découverte des classes globales ─────────────────────────── */

function discoverGlobalClasses() {
  const classes = new Set();
  if (!fs.existsSync(JS_DIR)) return classes;
  const files = fs.readdirSync(JS_DIR).filter(f => f.endsWith('.js'));
  const re = /document\.(?:documentElement|body)\.classList\.add\(\s*['"]([^'"]+)['"]/g;
  for (const f of files) {
    const content = fs.readFileSync(path.join(JS_DIR, f), 'utf8');
    let m;
    while ((m = re.exec(content))) classes.add(m[1]);
  }
  return classes;
}

/* ── Étape 2 : parser CSS (repris de css-guard.js) ─────────────────────── */

function parseCSS(content, filename) {
  const rules = [];
  const lines = content.split('\n');
  let depth = 0;
  const mediaAt = {};
  let inKF = false, kfBase = -1;
  let sel = null, props = {}, sline = 0;

  for (let i = 0; i < lines.length; i++) {
    const ln = i + 1;
    const s  = lines[i].trim();
    const o  = (s.match(/{/g) || []).length;
    const c  = (s.match(/}/g) || []).length;

    if (/^@media\b/.test(s) && o > 0) {
      depth++; mediaAt[depth] = s;
      depth += o - 1 - c;
      continue;
    }
    if (/^@(keyframes|font-face)\b/.test(s)) {
      inKF = true; kfBase = depth;
      depth += o - c;
      continue;
    }
    if (inKF) {
      depth += o - c;
      if (depth <= kfBase) inKF = false;
      continue;
    }
    if (s.startsWith('@') && o > 0) { depth += o - c; continue; }

    if (o > 0 && !s.startsWith('/*')) {
      const cand = s.split('{')[0].trim();
      if (cand && !/^[\d]+%/.test(cand) && cand !== 'from' && cand !== 'to') {
        sel = cand; sline = ln; props = {};
      }
    } else if (sel && s.includes(':') && !s.startsWith('/*') && !s.startsWith('//')) {
      const ci = s.indexOf(':');
      const k = s.slice(0, ci).trim();
      const v = s.slice(ci + 1).replace(/;$/, '').trim();
      if (k && !k.startsWith('--')) props[k] = v;
    }

    if (c > 0 && sel) {
      let media = 'global';
      for (const d of Object.keys(mediaAt).map(Number).sort((a, b) => a - b)) {
        if (d <= depth) media = mediaAt[d];
      }
      rules.push({ file: filename, line: sline, selector: sel, media, props: { ...props } });
      sel = null; props = {};
    }

    depth += o - c;
    for (const d of Object.keys(mediaAt)) { if (Number(d) > depth) delete mediaAt[d]; }
  }
  return rules;
}

/* ── Étape 3a : spécificité CSS approximative (id, classe, type) ───────── */

function specificity(selector) {
  // Une règle peut être une liste séparée par virgules — on prend le pire cas
  // (le plus spécifique) comme le fait un navigateur pour matcher un élément donné.
  const parts = selector.split(',').map(s => s.trim());
  let best = [0, 0, 0];
  for (const part of parts) {
    let ids = 0, classes = 0, types = 0;
    // Tokenise grossièrement : #id, .class, [attr], :pseudo-class, ::pseudo-element, mot-type
    const tokens = part.match(/(#[\w-]+)|(\.[\w-]+)|(\[[^\]]+\])|(::?[\w-]+(\([^)]*\))?)|([a-zA-Z][\w-]*)/g) || [];
    for (const t of tokens) {
      if (t.startsWith('#')) ids++;
      else if (t.startsWith('.') || t.startsWith('[')) classes++;
      else if (t.startsWith('::')) types++; // pseudo-élément compte comme type
      else if (t.startsWith(':')) classes++; // pseudo-classe compte comme classe
      else types++;
    }
    const score = [ids, classes, types];
    if (score[0] > best[0] || (score[0] === best[0] && score[1] > best[1]) ||
        (score[0] === best[0] && score[1] === best[1] && score[2] > best[2])) {
      best = score;
    }
  }
  return best;
}

function cmpSpecificity(a, b) {
  for (let i = 0; i < 3; i++) { if (a[i] !== b[i]) return a[i] - b[i]; }
  return 0;
}

/* ── Étape 3b : sélecteur "de base" (classe globale retirée) ───────────── */

function stripGlobalClass(selector, className) {
  const token = '.' + className;
  if (!selector.includes(token)) return null;
  let out = selector.split(token).join('');
  // Nettoie un "html"/"body" devenu orphelin en tête de sélecteur composé
  // (ex. "html.k-x #k-modal" → "html #k-modal" → "#k-modal")
  out = out.replace(/^(html|body)\s+/, '');
  out = out.replace(/\s{2,}/g, ' ').trim();
  return out || null;
}

/* ── Scan principal ──────────────────────────────────────────────────── */

function scan(globalClasses) {
  let allRules = [];
  for (const f of DIST_FILES) {
    const fp = path.join(CSS_DIR, f);
    if (!fs.existsSync(fp)) continue;
    allRules = allRules.concat(parseCSS(fs.readFileSync(fp, 'utf8'), f));
  }

  // Index par sélecteur exact → liste de règles (pour retrouver le sélecteur "de base")
  const bySelector = {};
  for (const r of allRules) (bySelector[r.selector] || (bySelector[r.selector] = [])).push(r);

  const findings = [];

  for (const r of allRules) {
    let matchedClass = null;
    for (const gc of globalClasses) {
      if (r.selector.includes('.' + gc)) { matchedClass = gc; break; }
    }
    if (!matchedClass) continue;

    const baseSelector = stripGlobalClass(r.selector, matchedClass);
    if (!baseSelector || !bySelector[baseSelector]) continue;

    const specGlobal = specificity(r.selector);
    const specBase = specificity(baseSelector);
    if (cmpSpecificity(specGlobal, specBase) <= 0) continue; // pas d'override garanti

    for (const baseRule of bySelector[baseSelector]) {
      const sharedProps = Object.keys(r.props).filter(p => p in baseRule.props);
      for (const prop of sharedProps) {
        if (r.props[prop] === baseRule.props[prop]) continue;
        findings.push({
          globalClass: matchedClass,
          overriding: { selector: r.selector, file: r.file, line: r.line, media: r.media, value: r.props[prop] },
          overridden: { selector: baseSelector, file: baseRule.file, line: baseRule.line, media: baseRule.media, value: baseRule.props[prop] },
          prop,
          specGlobal, specBase,
        });
      }
    }
  }
  return findings;
}

/* ── Baseline (cliquet, même doctrine que css-guard.js) ─────────────────── */

function keyOf(f) {
  return [f.globalClass, f.overriding.selector, f.overridden.selector, f.prop].join('|||');
}

function loadBaseline() {
  try { return JSON.parse(fs.readFileSync(BASELINE, 'utf8')); }
  catch { return null; }
}

/* ── Exécution ───────────────────────────────────────────────────────── */

const globalClasses = discoverGlobalClasses();

console.log(`${BLD}CSS Specificity Guard — classes d'état globales détectées :${R}`);
[...globalClasses].sort().forEach(c => console.log(`  ${DIM}.${c}${R}`));
console.log('');

if (classesOnly) process.exit(0);

const findings = scan(globalClasses);

if (findings.length === 0) {
  console.log(`${GRN}${BLD}✔ Aucun override de spécificité via classe globale détecté.${R}`);
  process.exit(0);
}

console.log(`${BLD}Overrides silencieux détectés (invisibles pour css-guard.js) :${R}\n`);
findings.forEach(f => {
  console.log(`${RED}🔴 .${f.globalClass}${R} — propriété ${BLD}${f.prop}${R}`);
  console.log(`   gagnant  ${DIM}${f.overriding.file}:L${f.overriding.line}${R} ${f.overriding.selector}`);
  console.log(`            → ${f.overriding.value}  ${DIM}(spécificité ${f.specGlobal.join(',')})${R}`);
  console.log(`   perdant  ${DIM}${f.overridden.file}:L${f.overridden.line}${R} ${f.overridden.selector}`);
  console.log(`            → ${f.overridden.value}  ${DIM}(spécificité ${f.specBase.join(',')})${R}`);
  console.log('');
});
console.log(`${BLD}Total : ${findings.length} override(s)${R}`);

if (save) {
  const keys = findings.map(keyOf).sort();
  fs.writeFileSync(BASELINE, JSON.stringify({ total: keys.length, keys, savedAt: new Date().toISOString() }, null, 2));
  console.log(`${GRN}${BLD}✔ Baseline figée à ${keys.length} override(s).${R}`);
  process.exit(0);
}

if (!strict) process.exit(0);

const baseline = loadBaseline();
if (!baseline) {
  console.error(`${RED}${BLD}✖ Aucune baseline css-specificity-guard.${R} Lance d'abord : node scripts/css-specificity-guard.js --save`);
  process.exit(1);
}
const known = new Set(baseline.keys || []);
const regressions = findings.map(f => ({ f, k: keyOf(f) })).filter(x => !known.has(x.k));

if (regressions.length === 0) {
  console.log(`\n${GRN}${BLD}✔ Aucune hausse hors baseline.${R}`);
  process.exit(0);
}

console.log(`\n${RED}${BLD}✖ ${regressions.length} nouvel/nouveaux override(s) hors baseline.${R}`);
process.exit(1);
