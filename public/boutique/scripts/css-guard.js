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

const DIST_FILES = ['base.css', 'components.css', 'desktop.css', 'event.css'];

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

// ── Parser CSS avec tracking @media par profondeur de braces ───────────────
// (une règle à l'intérieur d'un @media donné n'est en conflit qu'avec une
// règle du MÊME sélecteur dans le MÊME @media — un override responsive
// desktop n'est jamais un conflit avec sa base mobile.)

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

if (save) {
  const keys = Object.keys(perKey).sort();
  fs.writeFileSync(BASELINE, JSON.stringify({ total, keys, savedAt: new Date().toISOString() }, null, 2));
  console.log(`${GRN}${BLD}✔ Baseline css-guard figée à ${total} conflit(s) de cascade.${R}`);
  process.exit(0);
}

console.log(`${BLD}CSS Guardian — conflits de cascade (css/dist/)${R}`);

if (total === 0) {
  console.log(`${GRN}${BLD}✔ Aucun conflit de cascade.${R}`);
  process.exit(0);
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

if (!strict) process.exit(0);

const baseline = loadBaseline();
if (!baseline) {
  console.error(`${RED}${BLD}✖ Aucune baseline css-guard.${R} Lance d'abord : node scripts/css-guard.js --save`);
  process.exit(1);
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
  process.exit(0);
}

console.log(`\n${RED}${BLD}✖ ${regressions.length} nouveau(x) conflit(s) hors baseline :${R}`);
regressions.forEach(k => {
  const c = perKey[k];
  console.log(`${RED}   ↑ ${c.selector} (${c.media === 'global' ? 'global' : c.media}, ${c.prop})${R}`);
});
console.log(`${DIM}  Corrige le(s) conflit(s) ajouté(s), ou — si la hausse est légitime${R}`);
console.log(`${DIM}  — fige le nouvel état : npm run check:css-guard:save${R}`);
process.exit(1);
