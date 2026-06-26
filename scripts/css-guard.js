#!/usr/bin/env node
/**
 * @komerce-arch
 * @role         governance-css-guard
 * @domain       governance
 * @layer        tooling
 * @criticality  high
 * @purpose      Porte CSS boutique. Détecte les conflits de cascade (même sélecteur,
 *               même @media, valeurs différentes) et bloque le deploy si le
 *               compteur dépasse le baseline (cliquet). Baseline 0 = zéro tolérance.
 * @inputs       public/boutique/css/dist/base.css,
 *               public/boutique/css/dist/components.css,
 *               public/boutique/css/dist/desktop.css,
 *               public/boutique/css/dist/event.css,
 *               scripts/css-guard-baseline.json
 * @outputs      stdout report, process exit code
 * @depends      public/boutique/scripts/deploy-css.js (bundle CSS en amont)
 * @used-by      package.json#css:guard, package.json#build
 * @db-read      none
 * @db-write     none
 * @db-txn       none
 * @doctrine     KOMERCE_CSS_ZERO_CONFLICT
 * @impact-areas governance, ci, boutique
 *
 * Dependency-free. Ne modifie aucun fichier.
 *
 * Périmètre :
 *   BLOQUANT (exit 1 hors --observe) :
 *     - conflits de propriétés invariantes (display, position, height,
 *       width, z-index, overflow, grid-template-columns, flex, object-fit…)
 *     - total conflits > baseline
 *   OBSERVE (informatif, jamais bloquant) :
 *     - conflits cosmétiques (padding, margin, font-size, color…)
 *
 * Usage :
 *   node scripts/css-guard.js             # bloque si > baseline
 *   node scripts/css-guard.js --observe   # observe : sort toujours 0
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ── Config ────────────────────────────────────────────────────────────────────

const ROOT     = path.join(__dirname, '..');
const CSS_DIR  = path.join(ROOT, 'public', 'boutique', 'css', 'dist');
const BASELINE = path.join(__dirname, 'css-guard-baseline.json');

const DIST_FILES = ['base.css', 'components.css', 'desktop.css', 'event.css'];

const OBSERVE = process.argv.includes('--observe');

// ── Couleurs ──────────────────────────────────────────────────────────────────

const R   = '\x1b[0m';
const RED = '\x1b[31m';
const GRN = '\x1b[32m';
const YLW = '\x1b[33m';
const DIM = '\x1b[2m';

// ── Invariants : propriétés dont un conflit est toujours un bug ───────────────

const INVARIANTS = new Set([
  'display', 'position', 'height', 'width', 'max-width', 'min-width',
  'min-height', 'grid-template-columns', 'flex', 'overflow', 'overflow-x',
  'overflow-y', 'z-index', 'object-fit', 'object-position', 'aspect-ratio',
]);

// ── Whitelist : overrides inter-bundles intentionnels ────────────────────────
// Format : 'sélecteur|||média|||propriété'
// Ces conflits sont légitimes par design et ne doivent jamais bloquer :
//   - event.css est une page autonome qui redéfinit body (typo + fond propres)
//   - .k-sec-header desktop : surcharge responsive dans components.css
const WHITELIST = new Set([
  'body|||global|||background',
  'body|||global|||font-family',
  'body|||global|||line-height',
  '.k-sec-header|||@media (min-width: 900px) {|||padding',
]);

// ── Parser CSS avec tracking @media par profondeur de braces ──────────────────

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

// ── Détection des conflits ────────────────────────────────────────────────────

function analyze(allRules) {
  const groups = {};
  for (const r of allRules) {
    const k = r.selector + '|||' + r.media;
    (groups[k] || (groups[k] = [])).push(r);
  }

  const conflicts = [];
  let deadCount = 0;

  for (const [key, group] of Object.entries(groups)) {
    if (group.length <= 1) continue;

    const allProps = new Set();
    for (const r of group) Object.keys(r.props).forEach(function (p) { allProps.add(p); });

    const cProps = [];
    for (const prop of allProps) {
      const wkey = key.split('|||')[0] + '|||' + group[0].media + '|||' + prop;
      if (WHITELIST.has(wkey)) continue;
      const vals = group.filter(function (r) { return prop in r.props; })
                        .map(function (r) { return { file: r.file, line: r.line, val: r.props[prop] }; });
      if (vals.length > 1 && new Set(vals.map(function (v) { return v.val; })).size > 1) {
        cProps.push({ prop: prop, vals: vals, invariant: INVARIANTS.has(prop) });
      }
    }

    if (cProps.length) {
      conflicts.push({
        selector: key.split('|||')[0],
        media:    group[0].media,
        count:    group.length,
        props:    cProps,
        critical: cProps.some(function (p) { return p.invariant; }),
      });
      deadCount += group.length - 1;
    }
  }

  return { conflicts: conflicts, deadCount: deadCount };
}

// ── Main ──────────────────────────────────────────────────────────────────────

function main() {
  // Baseline
  var baseline = 0;
  try {
    var bl = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
    baseline = bl.max_conflicts;
  } catch (e) {
    // pas de fichier → baseline 0 (stricte)
  }

  var modeLabel = OBSERVE ? '--observe (non bloquant)' : 'bloquant';

  console.log('============================================================');
  console.log(' KOMERCE — Porte CSS boutique (conflits de cascade)');
  console.log('============================================================');
  console.log('Mode                    : ' + modeLabel);
  console.log('Baseline                : ' + baseline);
  console.log('Source                  : public/boutique/css/dist/');
  console.log('');

  // Parse
  var allRules = [];
  for (var fi = 0; fi < DIST_FILES.length; fi++) {
    var f = DIST_FILES[fi];
    var fp = path.join(CSS_DIR, f);
    if (!fs.existsSync(fp)) { console.log('  ' + YLW + '⚠' + R + '  ' + f + ': manquant'); continue; }
    var rules = parseCSS(fs.readFileSync(fp, 'utf8'), f);
    allRules = allRules.concat(rules);
    console.log('  ' + DIM + '✓' + R + '  ' + f.padEnd(22) + ' ' + String(rules.length).padStart(5) + ' règles');
  }
  console.log('  ' + ''.padEnd(22) + ' ' + String(allRules.length).padStart(5) + ' total');
  console.log('');

  // Analyze
  var result   = analyze(allRules);
  var conflicts = result.conflicts;
  var deadCount = result.deadCount;
  var critical = conflicts.filter(function (c) { return c.critical; });
  var cosmetic = conflicts.filter(function (c) { return !c.critical; });
  var total    = conflicts.length;

  console.log('--- TIER BLOQUANT ---');
  console.log('Conflits invariants     : ' + String(critical.length).padStart(3) + '   ' + (critical.length === 0 ? GRN + 'OK' + R : RED + 'FAIL' + R));
  console.log('Total conflits          : ' + String(total).padStart(3) + '   ' + (total <= baseline ? GRN + 'OK (<= ' + baseline + ')' + R : RED + 'REGRESSION > ' + baseline + R));
  console.log('');
  console.log('--- OBSERVE ---');
  console.log('Conflits cosmétiques    : ' + String(cosmetic.length).padStart(3));
  console.log('Règles mortes estimées  : ' + String(deadCount).padStart(3));
  console.log('');

  // Détails des conflits critiques
  if (critical.length > 0) {
    console.log('--- DÉTAIL CONFLITS INVARIANTS ---');
    for (var ci2 = 0; ci2 < Math.min(critical.length, 20); ci2++) {
      var cc = critical[ci2];
      console.log('  ' + RED + '✗' + R + ' ' + cc.selector + '  (' + cc.count + ' déclarations)');
      var invProps = cc.props.filter(function (x) { return x.invariant; }).slice(0, 3);
      for (var pi = 0; pi < invProps.length; pi++) {
        var p = invProps[pi];
        console.log('    ' + p.prop + ':');
        for (var vi = 0; vi < p.vals.length; vi++) {
          var v = p.vals[vi];
          var short = v.val.length > 55 ? v.val.slice(0, 55) + '…' : v.val;
          console.log('      ' + DIM + v.file + ':L' + v.line + R + ' → ' + short);
        }
      }
    }
    console.log('');
  }

  // Verdict
  var blockers = [];
  if (critical.length > 0) blockers.push(critical.length + ' conflits invariants');
  if (total > baseline)     blockers.push('total ' + total + ' > baseline ' + baseline);

  if (blockers.length === 0) {
    console.log(GRN + '✔ Porte CSS verte' + R + ' — ' + total + ' conflits (baseline ' + baseline + ')');
    if (total < baseline) {
      console.log('  ' + GRN + '↘ Amélioration !' + R + ' Mettre à jour scripts/css-guard-baseline.json → ' + total);
    }
    process.exit(0);
  }

  if (OBSERVE) {
    console.log(YLW + '⚠ Porte CSS orange (observe)' + R + ' — ' + blockers.join(', '));
    console.log('  Mode --observe : exit 0 (non bloquant)');
    process.exit(0);
  }

  console.log(RED + '✗ Porte CSS rouge' + R + ' — ' + blockers.join(', '));
  console.log('  Le build est bloqué. Corriger les conflits ou ajuster le baseline.');
  process.exit(1);
}

main();
