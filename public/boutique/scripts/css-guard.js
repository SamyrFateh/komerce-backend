#!/usr/bin/env node
'use strict';

/**
 * css-guard.js — Garde-fou à cliquet sur les conflits de cascade CSS.
 *
 *   Doctrine : deux règles sur le même sélecteur + même contexte @media,
 *   avec des valeurs différentes pour une même propriété, sont presque
 *   toujours un bug (ordre d'import qui décide, pas l'intention). Cette
 *   règle était invisible (personne ne grep des conflits de cascade) →
 *   ce script la rend exécutable, en mode CLIQUET (jamais big-bang),
 *   même philosophie que check-important.js / check-breakpoints.js :
 *     • on gèle l'état actuel comme référence (`--save`) ;
 *     • toute HAUSSE (nouveau conflit absent de la baseline) bloque ;
 *     • une BAISSE est toujours acceptée — et peut être figée au nouvel
 *       étiage avec `--save` (le cliquet ne remonte jamais tout seul).
 *
 * Périmètre : css/dist/*.css (les bundles livrés en prod — mêmes fichiers
 * que check:cache). Les conflits dont la propriété est invariante
 * (display, position, width, height, z-index, overflow, flex, grid…)
 * sont marqués 🔴 dans le rapport — toujours inclus dans le cliquet, juste
 * mis en avant car ce sont les seuls qui cassent visuellement à coup sûr.
 *
 * Usage :
 *   node scripts/css-guard.js --strict   ← bloque toute hausse (pre-commit / CI)
 *   node scripts/css-guard.js --save      ← fige l'état courant comme baseline
 *   node scripts/css-guard.js             ← rapport simple
 */

const fs   = require('fs');
const path = require('path');

const ROOT     = path.resolve(__dirname, '..');
const CSS_DIR  = path.join(ROOT, 'css', 'dist');
const BASELINE = path.join(__dirname, '.css-guard-baseline.json');

const DIST_FILES = ['base.css', 'components.css', 'desktop.css'];

const args   = process.argv.slice(2);
const strict = args.includes('--strict');
const save   = args.includes('--save');

const RED = '\x1b[31m', GRN = '\x1b[32m', YLW = '\x1b[33m', BLD = '\x1b[1m', DIM = '\x1b[2m', R = '\x1b[0m';

// Propriétés dont un conflit casse toujours visuellement (jamais un simple
// détail cosmétique) — mises en avant dans le rapport.
const INVARIANTS = new Set([
  'display', 'position', 'height', 'width', 'max-width', 'min-width',
  'min-height', 'grid-template-columns', 'flex', 'overflow', 'overflow-x',
  'overflow-y', 'z-index', 'object-fit', 'object-position', 'aspect-ratio',
]);

// ── Whitelist : conflits inter-bundles légitimes ────────────────────────────
// Format : 'sélecteur|||média|||propriété'
// Ces conflits sont intentionnels (bundles distincts avec contextes différents)
// et ne doivent jamais bloquer ni apparaître dans le rapport.
const WHITELIST = new Set([
  // event.css redéfinit body intentionnellement (typo + fond propres à la page événement)
  'body|||global|||background',
  'body|||global|||font-family',
  'body|||global|||line-height',
  // .k-sec-header desktop : surcharge responsive dans components.css
  '.k-sec-header|||@media (min-width: 900px) {|||padding',
]);

// ── Parser CSS avec tracking @media par profondeur de braces ───────────────
// (une règle à l'intérieur d'un @media donné n'est en conflit qu'avec une
// règle du MÊME sélecteur dans le MÊME @media — un override responsive
// desktop n'est jamais un conflit avec sa base mobile.)

/**
 * Découpe un fragment de bloc CSS en déclarations et les pousse dans `props`.
 *
 * FIX 2026-07 — deux angles morts du parser d'origine, tous deux prouvés :
 *   1. `s.indexOf(':')` ne prenait QUE la première déclaration d'une ligne,
 *      et lui affectait tout le reste comme valeur. Sur
 *      `position: sticky; top: 0; align-self: start;` il enregistrait
 *      { position: "sticky; top: 0; align-self: start" } — `top` et
 *      `align-self` n'existaient tout simplement pas pour le détecteur.
 *   2. Les règles mono-ligne ressortaient avec props:{} (cf. parseCSS).
 *
 * Conséquence concrète : le conflit réel `align-self: start` (modal-shell.css)
 * vs `align-self: center` (modal-media.css), même sélecteur et même @media —
 * cause racine du hero sticky cassé en modale desktop — n'a jamais pu être
 * signalé, alors que ce gate existe précisément pour ça.
 *
 * Le découpage ignore les `;` internes aux parenthèses et aux chaînes
 * (url(data:image/svg+xml;base64,…), content: "a;b") — sinon on fabriquerait
 * des déclarations fantômes.
 */
function addDecls(chunk, props) {
  if (!chunk) return;
  const parts = [];
  let buf = '', depth = 0, quote = null;
  for (const ch of chunk) {
    if (quote) { buf += ch; if (ch === quote) quote = null; continue; }
    if (ch === '"' || ch === "'") { quote = ch; buf += ch; continue; }
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ';' && depth === 0) { parts.push(buf); buf = ''; continue; }
    buf += ch;
  }
  parts.push(buf);

  for (const raw of parts) {
    const d = raw.replace(/\/\*[\s\S]*?\*\//g, '').trim();
    if (!d) continue;
    const ci = d.indexOf(':');
    if (ci < 0) continue;
    const k = d.slice(0, ci).trim();
    const v = d.slice(ci + 1).trim();
    // Un sélecteur résiduel (`a:hover`) n'est pas une déclaration : une
    // propriété CSS ne contient que [a-z-] (et jamais d'espace).
    if (!k || k.startsWith('--') || !/^-?[a-zA-Z][a-zA-Z0-9-]*$/.test(k)) continue;
    props[k] = v;
  }
}

/**
 * Remplace le CONTENU des commentaires /* … *​/ par des espaces, en préservant
 * les sauts de ligne (donc la numérotation reste exacte).
 *
 * Nécessaire depuis le fix du découpage par `;` : le parser d'origine ne
 * filtrait que les lignes COMMENÇANT par `/*`, jamais les lignes de suite
 * d'un commentaire de bloc. Or la prose des commentaires de ce dépôt cite
 * couramment du CSS ("border-radius:0 volontaire", "… ; align-self:center …"),
 * ce qui fabriquait des déclarations fantômes et donc de faux conflits.
 * Un gate bruyant est un gate ignoré — cette passe garde le signal propre.
 */
function stripComments(content) {
  let out = '', i = 0, inC = false;
  while (i < content.length) {
    if (!inC && content[i] === '/' && content[i + 1] === '*') { inC = true; out += '  '; i += 2; continue; }
    if (inC && content[i] === '*' && content[i + 1] === '/') { inC = false; out += '  '; i += 2; continue; }
    out += inC ? (content[i] === '\n' ? '\n' : ' ') : content[i];
    i++;
  }
  return out;
}

function parseCSS(content, filename) {
  const rules = [];
  const lines = stripComments(content).split('\n');
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
        // FIX 2026-07 : les déclarations posées SUR la ligne d'ouverture
        // (`.x { color: red; }`, style compact omniprésent dans
        // modal-shell.css) étaient intégralement perdues — la branche
        // `else if` ne pouvait jamais les voir. Une règle mono-ligne
        // ressortait donc avec props:{}, invisible au détecteur.
        addDecls(s.slice(s.indexOf('{') + 1).split('}')[0], props);
      }
    } else if (sel && s.includes(':') && !s.startsWith('/*') && !s.startsWith('//')) {
      addDecls(s, props);
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

// ── Scan : un conflit = un (sélecteur, média, propriété) avec ≥2 valeurs ───

function scan() {
  let allRules = [];
  for (const f of DIST_FILES) {
    const fp = path.join(CSS_DIR, f);
    if (!fs.existsSync(fp)) continue;
    allRules = allRules.concat(parseCSS(fs.readFileSync(fp, 'utf8'), f));
  }

  const groups = {};
  for (const r of allRules) {
    const k = r.selector + '|||' + r.media;
    (groups[k] || (groups[k] = [])).push(r);
  }

  const perKey = {};
  let total = 0;

  for (const group of Object.values(groups)) {
    if (group.length <= 1) continue;

    const allProps = new Set();
    for (const r of group) Object.keys(r.props).forEach(p => allProps.add(p));

    for (const prop of allProps) {
      const vals = group
        .filter(r => prop in r.props)
        .map(r => ({ file: r.file, line: r.line, val: r.props[prop] }));
      if (vals.length < 2) continue;
      if (new Set(vals.map(v => v.val)).size < 2) continue;

      const key = group[0].selector + '|||' + group[0].media + '|||' + prop;
      if (WHITELIST.has(key)) continue;
      perKey[key] = {
        selector: group[0].selector,
        media: group[0].media,
        prop,
        critical: INVARIANTS.has(prop),
        vals,
      };
      total++;
    }
  }

  return { perKey, total };
}

// ── Baseline ────────────────────────────────────────────────────────────────

function loadBaseline() {
  try { return JSON.parse(fs.readFileSync(BASELINE, 'utf8')); }
  catch { return null; }
}

const result = scan();
const perKey = result.perKey;
const total  = result.total;

// FIX (dette identifiée en session — flake ~20% de
// tests/unit/css-guard-compact-line.test.js, reproduit hors Jest en pur
// Node.js séquentiel, aucune concurrence en cause) :
//
//   process.exit(N) appelé juste après une rafale de console.log() tronque
//   la sortie quand stdout est un pipe (jamais un TTY) — cas systématique
//   ici puisque ce script n'est utilisé QUE via child_process
//   (execFileSync/execSync) par les tests et par predeploy-gate.js/
//   npm scripts. Sur Linux, l'écriture d'un pipe est non-bloquante côté
//   Node ; process.exit() ne draine JAMAIS le buffer stdout en attente
//   avant de tuer le process — avec ~170 conflits (~28 Ko), le buffer du
//   pipe dépasse régulièrement ce qui a eu le temps d'être flush avant le
//   exit(), et la fin du rapport (jusqu'à la ligne "Total : …") disparaît
//   silencieusement. Reproduit et confirmé par diff de longueur de sortie
//   entre runs identiques (28092 caractères vs des runs tronqués à
//   9564-26240, toujours coupés avant la fin, jamais corrompus).
//
// Fix : process.exitCode + return au lieu de process.exit() partout dans
// ce script (return top-level valide : Node enveloppe chaque module CJS
// dans une fonction). Le process se termine alors naturellement en fin de
// script, après drain complet de stdout par l'event loop — jamais tué en
// plein flush.

if (save) {
  const keys = Object.keys(perKey).sort();
  fs.writeFileSync(BASELINE, JSON.stringify({ total, keys, savedAt: new Date().toISOString() }, null, 2));
  console.log(`${GRN}${BLD}✔ Baseline css-guard figée à ${total} conflit(s) de cascade.${R}`);
  process.exitCode = 0;
  return;
}

console.log(`${BLD}CSS Guardian — conflits de cascade (css/dist/)${R}`);

if (total === 0) {
  console.log(`${GRN}${BLD}✔ Aucun conflit de cascade.${R}`);
  process.exitCode = 0;
  return;
}

const sortedKeys = Object.keys(perKey).sort();
for (const key of sortedKeys) {
  const c = perKey[key];
  const tag = c.critical ? `${RED}🔴` : `${YLW}🟡`;
  console.log(`${tag} ${c.selector}  ${DIM}(${c.media === 'global' ? 'global' : c.media}, ${c.prop})${R}`);
  for (const v of c.vals) {
    const short = v.val.length > 55 ? v.val.slice(0, 55) + '…' : v.val;
    console.log(`     ${DIM}${v.file}:L${v.line}${R} → ${short}`);
  }
}
console.log(`\n${BLD}Total : ${total} conflit(s)${R} (baseline : ${(loadBaseline() || {}).total ?? 'aucune'})`);

if (!strict) {
  process.exitCode = 0;
  return;
}

const baseline = loadBaseline();
if (!baseline) {
  console.error(`${RED}${BLD}✖ Aucune baseline css-guard.${R} Lance d'abord : node scripts/css-guard.js --save`);
  process.exitCode = 1;
  return;
}

const known = new Set(baseline.keys || []);
const regressions = sortedKeys.filter(k => !known.has(k));
const drops = (baseline.keys || []).filter(k => !perKey[k]);

if (drops.length) {
  console.log(`\n${DIM}  Baisses depuis la baseline (fige-les avec --save) :${R}`);
  drops.forEach(k => console.log(`${GRN}   ↓ ${k.split('|||').join(' / ')}${R}`));
}

if (regressions.length === 0) {
  console.log(`\n${GRN}${BLD}✔ Aucune hausse hors baseline.${R}`);
  process.exitCode = 0;
  return;
}

console.log(`\n${RED}${BLD}✖ ${regressions.length} nouveau(x) conflit(s) hors baseline :${R}`);
regressions.forEach(k => {
  const c = perKey[k];
  console.log(`${RED}   ↑ ${c.selector} (${c.media === 'global' ? 'global' : c.media}, ${c.prop})${R}`);
});
console.log(`${DIM}  Corrige le(s) conflit(s) ajouté(s), ou — si la hausse est légitime${R}`);
console.log(`${DIM}  — fige le nouvel état : npm run check:css-guard:save${R}`);
process.exitCode = 1;
