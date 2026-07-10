#!/usr/bin/env node
'use strict';

/**
 * report-coverage.js — Rapport de couverture réel de la boutique.
 *
 * Source : coverage/coverage-summary.json + coverage/lcov.info produits par Jest.
 * Exclusions : bundles js/dist/**, fichiers *.test.js et __tests__.
 * Sortie : coverage/COVERAGE_MISSING.md, triée par criticité puis dette lignes.
 */

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const COVERAGE_DIR = path.join(ROOT, 'coverage');
const SUMMARY_PATH = path.join(COVERAGE_DIR, 'coverage-summary.json');
const LCOV_PATH = path.join(COVERAGE_DIR, 'lcov.info');
const REPORT_PATH = path.join(COVERAGE_DIR, 'COVERAGE_MISSING.md');

function fail(message) {
  console.error(`[coverage] ${message}`);
  process.exit(1);
}

if (!fs.existsSync(SUMMARY_PATH)) {
  fail(`rapport absent : ${path.relative(ROOT, SUMMARY_PATH)} — lancer npm run test:coverage`);
}

function normalizeFile(filePath) {
  const normalized = String(filePath).replace(/\\/g, '/');
  if (path.isAbsolute(filePath)) {
    return path.relative(ROOT, filePath).replace(/\\/g, '/');
  }
  const marker = '/public/boutique/';
  const markerIndex = normalized.lastIndexOf(marker);
  return markerIndex >= 0 ? normalized.slice(markerIndex + marker.length) : normalized.replace(/^\.\//, '');
}

function isRealSource(filePath) {
  const file = normalizeFile(filePath);
  return file.startsWith('js/') &&
    !file.startsWith('js/dist/') &&
    !file.endsWith('.test.js') &&
    !file.includes('/__tests__/');
}

function pct(covered, total) {
  return total === 0 ? 100 : Math.round((covered / total) * 10000) / 100;
}

function aggregate(files, metric) {
  return files.reduce((acc, item) => {
    acc.covered += Number(item.metrics[metric].covered || 0);
    acc.total += Number(item.metrics[metric].total || 0);
    return acc;
  }, { covered: 0, total: 0 });
}

function parseLcovMissingLines() {
  if (!fs.existsSync(LCOV_PATH)) return new Map();

  const result = new Map();
  let current = null;

  fs.readFileSync(LCOV_PATH, 'utf8').split(/\r?\n/).forEach((line) => {
    if (line.startsWith('SF:')) {
      current = normalizeFile(line.slice(3));
      if (!result.has(current)) result.set(current, []);
      return;
    }
    if (current && line.startsWith('DA:')) {
      const [lineNumber, hits] = line.slice(3).split(',').map(Number);
      if (Number.isFinite(lineNumber) && hits === 0) result.get(current).push(lineNumber);
      return;
    }
    if (line === 'end_of_record') current = null;
  });

  return result;
}

function compactRanges(lines, maxRanges = 14) {
  const sorted = [...new Set(lines)].sort((a, b) => a - b);
  if (sorted.length === 0) return '—';

  const ranges = [];
  let start = sorted[0];
  let previous = sorted[0];

  for (let i = 1; i < sorted.length; i += 1) {
    const current = sorted[i];
    if (current === previous + 1) {
      previous = current;
      continue;
    }
    ranges.push(start === previous ? `${start}` : `${start}-${previous}`);
    start = current;
    previous = current;
  }
  ranges.push(start === previous ? `${start}` : `${start}-${previous}`);

  if (ranges.length <= maxRanges) return ranges.join(', ');
  return `${ranges.slice(0, maxRanges).join(', ')}, … (+${ranges.length - maxRanges} zones)`;
}

function priorityFor(linePct) {
  if (linePct === 0) return { code: 'P0', label: 'aucune couverture', rank: 0 };
  if (linePct < 50) return { code: 'P1', label: 'couverture faible', rank: 1 };
  if (linePct < 70) return { code: 'P2', label: 'couverture moyenne', rank: 2 };
  return { code: 'OK', label: '≥ 70 %', rank: 3 };
}

const summary = JSON.parse(fs.readFileSync(SUMMARY_PATH, 'utf8'));
const missingLinesByFile = parseLcovMissingLines();

const files = Object.entries(summary)
  .filter(([filePath]) => filePath !== 'total' && isRealSource(filePath))
  .map(([filePath, metrics]) => {
    const file = normalizeFile(filePath);
    const linePct = pct(metrics.lines.covered, metrics.lines.total);
    return {
      file,
      metrics,
      linePct,
      uncoveredLines: Math.max(0, metrics.lines.total - metrics.lines.covered),
      missingRanges: compactRanges(missingLinesByFile.get(file) || []),
      priority: priorityFor(linePct),
    };
  });

if (files.length === 0) fail('aucun fichier source js/** trouvé dans coverage-summary.json');

const metricLabels = [
  ['statements', 'Statements'],
  ['branches', 'Branches'],
  ['functions', 'Functions'],
  ['lines', 'Lines'],
];

const globalMetrics = Object.fromEntries(metricLabels.map(([metric]) => {
  const value = aggregate(files, metric);
  return [metric, { ...value, pct: pct(value.covered, value.total) }];
}));

const debt = files
  .filter((item) => item.linePct < 70)
  .sort((a, b) =>
    a.priority.rank - b.priority.rank ||
    b.uncoveredLines - a.uncoveredLines ||
    a.file.localeCompare(b.file)
  );

const markdown = [];
markdown.push('# Couverture boutique — dette réelle');
markdown.push('');
markdown.push(`Généré le ${new Date().toISOString()} par \`npm run test:coverage\`.`);
markdown.push('');
markdown.push('Périmètre : `js/**/*.js`, hors `js/dist/**`, `*.test.js` et `__tests__/**`.');
markdown.push('');
markdown.push('## Couverture globale corrigée');
markdown.push('');
markdown.push('| Métrique | Couvert / total | Couverture |');
markdown.push('|---|---:|---:|');
metricLabels.forEach(([metric, label]) => {
  const value = globalMetrics[metric];
  markdown.push(`| ${label} | ${value.covered} / ${value.total} | **${value.pct.toFixed(2)} %** |`);
});
markdown.push('');
markdown.push('## Fichiers sous 70 % de lignes');
markdown.push('');
markdown.push('| Priorité | Fichier | Lines | Lignes manquantes | Zones non couvertes |');
markdown.push('|---|---|---:|---:|---|');
if (debt.length === 0) {
  markdown.push('| — | Aucun fichier sous le seuil | — | — | — |');
} else {
  debt.forEach((item) => {
    markdown.push(`| ${item.priority.code} — ${item.priority.label} | \`${item.file}\` | ${item.linePct.toFixed(2)} % | ${item.uncoveredLines} | ${item.missingRanges} |`);
  });
}
markdown.push('');
markdown.push('## Lecture');
markdown.push('');
markdown.push('- **P0** : fichier jamais exercé ; vérifier d’abord s’il s’agit d’un bootstrap ou d’un module réellement actif.');
markdown.push('- **P1** : tester les contrats publics et les branches métier actives avant les détails DOM.');
markdown.push('- **P2** : compléter les erreurs, fallbacks, idempotence et variantes desktop/mobile.');
markdown.push('- Le code volontairement désactivé ou mort doit être supprimé/isolé, pas artificiellement exécuté pour gonfler le chiffre.');
markdown.push('');

fs.mkdirSync(COVERAGE_DIR, { recursive: true });
fs.writeFileSync(REPORT_PATH, `${markdown.join('\n')}\n`, 'utf8');

console.log('\n=== Couverture boutique corrigée ===');
metricLabels.forEach(([metric, label]) => {
  const value = globalMetrics[metric];
  console.log(`${label.padEnd(12)} ${value.pct.toFixed(2).padStart(6)} %  (${value.covered}/${value.total})`);
});
console.log(`\nDette < 70 % : ${debt.length} fichier(s)`);
debt.slice(0, 20).forEach((item) => {
  console.log(`${item.priority.code}  ${item.linePct.toFixed(2).padStart(6)} %  -${String(item.uncoveredLines).padStart(4)} lignes  ${item.file}`);
});
if (debt.length > 20) console.log(`… ${debt.length - 20} autre(s) fichier(s) dans ${path.relative(ROOT, REPORT_PATH)}`);
console.log(`\nRapport : ${path.relative(ROOT, REPORT_PATH)}\n`);
