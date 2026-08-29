#!/usr/bin/env node
'use strict';

/**
 * check-important.js — dette ouverte vs exceptions `!important` revues.
 *
 * Un `!important` n'est pas automatiquement une dette : certains guards de
 * frontière responsive doivent neutraliser un état JS commun sur un breakpoint
 * où la surface ne doit jamais apparaître. Ces exceptions sont rares, exactes,
 * documentées et vérifiées structurellement.
 *
 * Tout le reste reste de la dette ouverte sous cliquet :
 *   - toute nouvelle occurrence non revue bloque `--strict` ;
 *   - toute baisse est acceptée et doit être refigée avec `--save` ;
 *   - une exception revue qui change de sélecteur, valeur ou contexte @media
 *     cesse immédiatement d'être revue et redevient de la dette ouverte.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CSS_DIR = path.join(ROOT, 'css');
const BASELINE = path.join(__dirname, '.important-baseline.json');

const args = process.argv.slice(2);
const strict = args.includes('--strict');
const save = args.includes('--save');
const json = args.includes('--json');

const RED = '\x1b[31m';
const GRN = '\x1b[32m';
const YLW = '\x1b[33m';
const BLD = '\x1b[1m';
const DIM = '\x1b[2m';
const R = '\x1b[0m';

const REVIEWED_GUARDS = Object.freeze([
  {
    id: 'desktop-mobile-drawer-neutralization',
    file: 'boutique-desktop.css',
    media: /@media\s*\(\s*min-width\s*:\s*900px\s*\)/,
    selector: /\.k-cart-drawer\.open\s*,\s*\.k-cart-overlay\.open\s*\{/g,
    declarations: Object.freeze({
      display: 'none',
      transform: 'translateX(100%)',
      'pointer-events': 'none',
    }),
    rationale: 'À ≥900px, neutralise le drawer/overlay mobile quand la classe JS .open subsiste.',
  },
]);

function cssFiles() {
  return fs.readdirSync(CSS_DIR)
    .filter(file => file.endsWith('.css'))
    .sort();
}

function stripCommentsPreserveLength(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, match => match.replace(/[^\n]/g, ' '));
}

function matchingBrace(source, openIndex) {
  let depth = 0;
  let quote = null;
  for (let i = openIndex; i < source.length; i += 1) {
    const ch = source[i];
    if (quote) {
      if (ch === '\\') { i += 1; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function insideExpectedMedia(source, blockStart, mediaRegex) {
  const media = new RegExp(mediaRegex.source, mediaRegex.flags.includes('g') ? mediaRegex.flags : `${mediaRegex.flags}g`);
  let match;
  while ((match = media.exec(source)) !== null) {
    if (match.index > blockStart) break;
    const open = source.indexOf('{', match.index + match[0].length);
    if (open < 0) continue;
    const close = matchingBrace(source, open);
    if (close >= blockStart) return true;
  }
  return false;
}

function parseImportantDeclarations(blockBody) {
  const out = [];
  const re = /([a-zA-Z-]+)\s*:\s*([^;{}]+?)\s*!important\s*;/g;
  let match;
  while ((match = re.exec(blockBody)) !== null) {
    out.push({ property: match[1].trim(), value: match[2].trim() });
  }
  return out;
}

function findReviewedOccurrences(file, source) {
  const reviewed = [];
  const clean = stripCommentsPreserveLength(source);

  for (const guard of REVIEWED_GUARDS) {
    if (guard.file !== file) continue;
    const selectorRe = new RegExp(guard.selector.source, guard.selector.flags);
    let match;
    while ((match = selectorRe.exec(clean)) !== null) {
      const open = clean.indexOf('{', match.index);
      const close = matchingBrace(clean, open);
      if (open < 0 || close < 0) continue;
      if (!insideExpectedMedia(clean, match.index, guard.media)) continue;

      const declarations = parseImportantDeclarations(clean.slice(open + 1, close));
      const expectedEntries = Object.entries(guard.declarations);
      const exact = declarations.length === expectedEntries.length
        && expectedEntries.every(([property, value]) =>
          declarations.some(item => item.property === property && item.value === value)
        );
      if (!exact) continue;

      for (const [property, value] of expectedEntries) {
        reviewed.push({
          id: guard.id,
          file,
          property,
          value,
          rationale: guard.rationale,
        });
      }
    }
  }

  return reviewed;
}

function scan() {
  const totalPerFile = {};
  const reviewedPerFile = {};
  const openPerFile = {};
  const reviewed = [];
  let total = 0;
  let reviewedTotal = 0;

  for (const file of cssFiles()) {
    const source = fs.readFileSync(path.join(CSS_DIR, file), 'utf8');
    const clean = stripCommentsPreserveLength(source);
    const count = (clean.match(/!important\b/g) || []).length;
    const fileReviewed = findReviewedOccurrences(file, source);
    const open = Math.max(0, count - fileReviewed.length);

    if (count > 0) totalPerFile[file] = count;
    if (fileReviewed.length > 0) reviewedPerFile[file] = fileReviewed.length;
    if (open > 0) openPerFile[file] = open;

    total += count;
    reviewedTotal += fileReviewed.length;
    reviewed.push(...fileReviewed);
  }

  return {
    total,
    totalPerFile,
    reviewedTotal,
    reviewedPerFile,
    reviewed,
    openTotal: total - reviewedTotal,
    openPerFile,
  };
}

function loadBaseline() {
  try { return JSON.parse(fs.readFileSync(BASELINE, 'utf8')); }
  catch { return null; }
}

function saveBaseline(result) {
  const baseline = {
    total: result.openTotal,
    perFile: result.openPerFile,
    semantics: 'open-debt-only',
    reviewedGuardIds: REVIEWED_GUARDS.map(guard => guard.id),
    savedAt: new Date().toISOString(),
  };
  fs.writeFileSync(BASELINE, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8');
  return baseline;
}

function diffAgainstBaseline(result, baseline) {
  const regressions = [];
  const drops = [];
  const current = result.openPerFile;
  const reference = baseline.perFile || {};

  for (const [file, count] of Object.entries(current)) {
    const ref = reference[file] || 0;
    if (count > ref) regressions.push({ file, ref, now: count });
  }
  for (const [file, ref] of Object.entries(reference)) {
    const now = current[file] || 0;
    if (now < ref) drops.push({ file, ref, now });
  }

  return { regressions, drops };
}

function run() {
  const result = scan();

  if (save) {
    const baseline = saveBaseline(result);
    console.log(`${GRN}${BLD}✔ Baseline dette !important ouverte figée à ${baseline.total} occurrence(s).${R}`);
    console.log(`${DIM}  ${result.reviewedTotal} occurrence(s) revue(s) restent suivies séparément.${R}`);
    return 0;
  }

  const baseline = loadBaseline();
  if (!baseline) {
    console.error(`${RED}${BLD}✖ Aucune baseline !important.${R}`);
    return strict ? 1 : 0;
  }

  const { regressions, drops } = diffAgainstBaseline(result, baseline);

  if (json) {
    console.log(JSON.stringify({ result, baseline, regressions, drops }, null, 2));
    return strict && regressions.length > 0 ? 1 : 0;
  }

  console.log(`${BLD}!important — ${result.total} occurrence(s) physiques${R}`);
  console.log(`  Dette ouverte : ${result.openTotal} (baseline : ${baseline.total})`);
  console.log(`  Revues        : ${result.reviewedTotal}`);

  if (result.reviewed.length > 0) {
    console.log(`${DIM}  Exceptions revues exactes :${R}`);
    const ids = [...new Set(result.reviewed.map(item => item.id))];
    for (const id of ids) {
      const items = result.reviewed.filter(item => item.id === id);
      console.log(`${GRN}   ✓ ${id} — ${items.length} déclaration(s)${R}`);
      console.log(`${DIM}     ${items[0].rationale}${R}`);
    }
  }

  if (drops.length > 0) {
    console.log(`${DIM}  Baisses de dette ouverte depuis la baseline :${R}`);
    drops.forEach(item => console.log(`${GRN}   ↓ ${item.file} : ${item.ref} → ${item.now}${R}`));
  }

  if (regressions.length === 0) {
    console.log(`${GRN}${BLD}✔ Aucune hausse de dette !important ouverte.${R}`);
    return 0;
  }

  console.log(`${RED}${BLD}✖ ${regressions.length} hausse(s) de dette !important ouverte :${R}`);
  regressions.forEach(item => console.log(`${RED}   ↑ ${item.file} : ${item.ref} → ${item.now} (+${item.now - item.ref})${R}`));
  console.log(`${YLW}  Ne pas gonfler la baseline pour faire passer le gate : supprimer la cause ou documenter une exception exacte et revue.${R}`);
  return strict ? 1 : 0;
}

if (require.main === module) process.exit(run());

module.exports = {
  REVIEWED_GUARDS,
  matchingBrace,
  insideExpectedMedia,
  parseImportantDeclarations,
  findReviewedOccurrences,
  scan,
  diffAgainstBaseline,
  run,
};
