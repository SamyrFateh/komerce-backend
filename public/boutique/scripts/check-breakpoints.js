#!/usr/bin/env node
'use strict';

/**
 * scripts/check-breakpoints.js
 *
 * GARDE-FOU breakpoints (violation V1 de l'audit).
 * Charte projet : un seul système de breakpoints — 900px (desktop), 1200px (large).
 * Tout autre breakpoint dans un @media est une violation qui casse la prévisibilité mobile.
 *
 * Mode par défaut : RAPPORT (liste les violations, n'échoue pas) — pour migration progressive.
 * Mode --strict   : ÉCHOUE (exit 1) si une NOUVELLE violation apparaît vs la baseline.
 *
 * La baseline (scripts/.breakpoints-baseline.json) gèle le nombre de violations connues.
 * À chaque sprint qui en supprime, regénérer la baseline avec --save pour verrouiller le gain
 * (empêche toute régression : on ne peut plus jamais remonter au-dessus du compte gelé).
 *
 * Usage :
 *   node scripts/check-breakpoints.js            # rapport
 *   node scripts/check-breakpoints.js --strict   # échoue si > baseline
 *   node scripts/check-breakpoints.js --save      # fige la baseline au compte actuel
 */

const fs   = require('fs');
const path = require('path');

const ROOT     = path.resolve(__dirname, '..');
const CSS_DIR  = path.join(ROOT, 'css');
const BASELINE = path.join(__dirname, '.breakpoints-baseline.json');
const ALLOWED  = new Set(['900', '1200']);

const args   = process.argv.slice(2);
const strict = args.includes('--strict');
const save   = args.includes('--save');

function cssFiles() {
  return fs.readdirSync(CSS_DIR)
    .filter(f => f.endsWith('.css'))
    .map(f => path.join(CSS_DIR, f));
}

function scan() {
  const perFile = {};
  let total = 0;
  for (const f of cssFiles()) {
    const src = fs.readFileSync(f, 'utf8');
    const bps = [...src.matchAll(/@media[^{]*?(\d{2,4})px/g)].map(m => m[1]);
    const violations = [...new Set(bps)].filter(b => !ALLOWED.has(b));
    if (violations.length) {
      perFile[path.basename(f)] = violations.sort((a, b) => a - b);
      total += violations.length;
    }
  }
  return { perFile, total };
}

const { perFile, total } = scan();

// --save : fige la baseline
if (save) {
  fs.writeFileSync(BASELINE, JSON.stringify({ total, perFile, savedAt: new Date().toISOString() }, null, 2));
  console.log(`✅ Baseline breakpoints figée à ${total} violations.`);
  process.exit(0);
}

// Rapport
console.log('\n📐 Breakpoints — garde-fou V1');
console.log('   Autorisés : 900px, 1200px\n');
if (total === 0) {
  console.log('✅ Aucune violation. Boutique sous contrôle côté breakpoints.\n');
  process.exit(0);
}
for (const [file, viols] of Object.entries(perFile)) {
  console.log(`   🔴 ${file.padEnd(34)} ${viols.map(v => v + 'px').join(', ')}`);
}
console.log(`\n   Total : ${total} violations dans ${Object.keys(perFile).length} fichiers.`);

// Mode strict : comparer à la baseline
if (strict) {
  let baseTotal = Infinity;
  if (fs.existsSync(BASELINE)) {
    baseTotal = JSON.parse(fs.readFileSync(BASELINE, 'utf8')).total;
  }
  if (total > baseTotal) {
    console.error(`\n❌ RÉGRESSION : ${total} violations > baseline ${baseTotal}. Commit bloqué.`);
    console.error(`   Un nouveau breakpoint hors 900/1200 a été introduit. Utilisez 900px.\n`);
    process.exit(1);
  }
  if (total < baseTotal) {
    console.log(`\n🎉 Progrès : ${total} < baseline ${baseTotal}. Pensez à figer : npm run check:breakpoints:save\n`);
  } else {
    console.log(`\n✅ Stable vs baseline (${baseTotal}). Pas de régression.\n`);
  }
}
process.exit(0);
