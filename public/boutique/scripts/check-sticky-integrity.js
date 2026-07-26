#!/usr/bin/env node
'use strict';

/**
 * @komerce-arch-lite
 * @role          css-invariant-gate
 * @domain        boutique
 * @layer         build-gate
 * @purpose       Interdit qu'un élément en `position: sticky` soit aussi centré
 *                verticalement dans son conteneur (grid/flex). Les deux sont
 *                mutuellement exclusifs : un item centré n'a aucune amplitude
 *                de collage, donc le sticky défile 1:1 — silencieusement.
 * @impact-areas  css-pipeline, modale-produit, hero
 *
 * ── Pourquoi ce gate existe ────────────────────────────────────────────────
 * Le hero de la modale produit desktop (.k-modal-img-wrap) déclarait
 * `position: sticky; top: 0` dans modal-shell.css, pendant que modal-media.css
 * — plus loin dans le bundle, à spécificité identique — posait
 * `align-self: center` ET `margin: auto`. Résultat mesuré en Chromium :
 * tops [509, 409, 309, 209] pour un scroll [0, 100, 200, 300] — aucun collage.
 *
 * Le piège est qu'il faut DEUX variables pour le reproduire : `align-self` et
 * `margin` centrent chacun indépendamment. Neutraliser une seule des deux ne
 * change rien de mesurable, ce qui a fait conclure à tort à un bug Chromium
 * sur `position: sticky` + item de grille. Ce gate teste les deux ensemble.
 *
 * Usage :
 *   node scripts/check-sticky-integrity.js            ← rapport
 *   node scripts/check-sticky-integrity.js --strict   ← bloque (CI / pre-commit)
 */

const fs = require('fs');
const path = require('path');

const CSS_DIR = path.join(path.resolve(__dirname, '..'), 'css', 'dist');
const DIST_FILES = ['base.css', 'components.css', 'desktop.css'];
const strict = process.argv.includes('--strict');

const RED = '\x1b[31m', GRN = '\x1b[32m', BLD = '\x1b[1m', DIM = '\x1b[2m', R = '\x1b[0m';

// Déclarations qui centrent verticalement un item de grille/flex.
// `margin: auto` (raccourci) compte : il pose margin-block: auto.
const CENTERING = [
  ['align-self', (v) => /^(center|safe center|unsafe center)$/.test(v.trim())],
  ['margin', (v) => /(^|\s)auto(\s|$)/.test(v.trim())],
  ['margin-block', (v) => /auto/.test(v)],
  ['margin-top', (v) => /auto/.test(v)],
  ['margin-bottom', (v) => /auto/.test(v)],
];

function stripComments(s) {
  let out = '', i = 0, inC = false;
  while (i < s.length) {
    if (!inC && s[i] === '/' && s[i + 1] === '*') { inC = true; out += '  '; i += 2; continue; }
    if (inC && s[i] === '*' && s[i + 1] === '/') { inC = false; out += '  '; i += 2; continue; }
    out += inC ? (s[i] === '\n' ? '\n' : ' ') : s[i];
    i++;
  }
  return out;
}

function splitDecls(chunk) {
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
  return parts.map((d) => d.trim()).filter(Boolean);
}

/** Collecte, par (sélecteur + @media), l'union des déclarations pertinentes. */
function collect(content, file) {
  const lines = stripComments(content).split('\n');
  const acc = new Map();
  let depth = 0, sel = null, sline = 0;
  const mediaAt = {};
  let bucket = null;

  const keyFor = () => {
    let media = 'global';
    for (const d of Object.keys(mediaAt).map(Number).sort((a, b) => a - b)) {
      if (d <= depth) media = mediaAt[d];
    }
    return sel + ' ||| ' + media;
  };

  const feed = (chunk) => {
    if (!bucket) return;
    for (const d of splitDecls(chunk)) {
      const ci = d.indexOf(':');
      if (ci < 0) continue;
      const k = d.slice(0, ci).trim();
      const v = d.slice(ci + 1).trim();
      if (!/^-?[a-zA-Z][a-zA-Z0-9-]*$/.test(k)) continue;
      if (k === 'position' && /sticky/.test(v)) bucket.sticky.push(`${file}:L${sline}`);
      for (const [prop, test] of CENTERING) {
        if (k === prop && test(v)) bucket.center.push(`${file}:L${sline}  ${k}: ${v}`);
      }
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const s = lines[i].trim();
    const o = (s.match(/{/g) || []).length;
    const c = (s.match(/}/g) || []).length;

    if (/^@media\b/.test(s) && o > 0) { depth++; mediaAt[depth] = s; depth += o - 1 - c; continue; }
    if (/^@(keyframes|font-face|supports)\b/.test(s)) { depth += o - c; continue; }
    if (s.startsWith('@') && o > 0) { depth += o - c; continue; }

    if (o > 0) {
      const cand = s.split('{')[0].trim();
      if (cand && !/^[\d]+%/.test(cand) && cand !== 'from' && cand !== 'to') {
        sel = cand; sline = i + 1;
        const k = keyFor();
        if (!acc.has(k)) acc.set(k, { sel, sticky: [], center: [] });
        bucket = acc.get(k);
        feed(s.slice(s.indexOf('{') + 1).split('}')[0]);
      }
    } else if (bucket && s.includes(':')) {
      sline = i + 1;
      feed(s);
    }

    if (c > 0) { bucket = null; sel = null; }
    depth += o - c;
    for (const d of Object.keys(mediaAt)) if (Number(d) > depth) delete mediaAt[d];
  }
  return acc;
}

const merged = new Map();
for (const f of DIST_FILES) {
  const fp = path.join(CSS_DIR, f);
  if (!fs.existsSync(fp)) continue;
  for (const [k, v] of collect(fs.readFileSync(fp, 'utf8'), f)) {
    if (!merged.has(k)) merged.set(k, { sel: v.sel, sticky: [], center: [] });
    merged.get(k).sticky.push(...v.sticky);
    merged.get(k).center.push(...v.center);
  }
}

console.log(`${BLD}Sticky Integrity — sticky vs centrage vertical (css/dist/)${R}`);

const violations = [];
for (const [k, v] of merged) {
  if (v.sticky.length && v.center.length) {
    violations.push({ key: k, ...v });
  }
}

for (const v of violations) {
  const media = v.key.split(' ||| ')[1];
  console.log(`${RED}✗ ${v.sel}${R}  ${DIM}(${media})${R}`);
  console.log(`   ${DIM}position:sticky  →${R} ${v.sticky.join(', ')}`);
  for (const c of v.center) console.log(`   ${RED}centrage vertical →${R} ${c}`);
  console.log(`   ${DIM}Un item centré n'a aucune amplitude de collage : le sticky défilera 1:1.${R}`);
}

if (!violations.length) {
  console.log(`${GRN}${BLD}✔ Aucun sticky neutralisé par un centrage vertical.${R}`);
  process.exit(0);
}

console.log(`\n${BLD}Total : ${violations.length} sticky neutralisé(s).${R}`);
process.exit(strict ? 1 : 0);
