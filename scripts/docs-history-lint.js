#!/usr/bin/env node
/*
 * @komerce-arch
 * @domain platform-ops
 * @owner platform-ops
 * @responsibility Bloque la réintroduction de bruit documentaire historique hors archive.
 * @inputs git-tracked markdown paths
 * @outputs process exit code + diagnostic report
 * @depends child_process
 * @used-by npm run docs:history-lint, npm run map:check
 * @db-read none
 * @db-write none
 * @db-txn none
 * @doctrine docs/INDEX.md, AGENTS.md
 * @impact-areas documentation-governance, ci-gates
 */
'use strict';

const { execFileSync } = require('child_process');

const HISTORICAL_PATTERNS = [
  /(^|\/)(AUDIT|RAPPORT|REPORT|SUMMARY|REFACTOR_SUMMARY|CORRECTIONS|CORRECTIONS_APPLIQUEES|CHANGELOG-lot|PROMPT_)/i,
  /(^|\/).*(20\d{2}[-_][01]\d[-_][0-3]\d).*\.md$/i,
  /(^|\/).*(20\d{2}[-_][01]\d).*\.md$/i,
  /(^|\/).*(APPLIQUEES|APPLIQU[EÉ]ES|MIGRATION_TERMINEE|ONE[-_]?SHOT).*\.md$/i,
];

const ALLOWED_LIVE = new Set([
  'README.md',
  'CONTRIBUTING.md',
  'AGENTS.md',
  'docs/INDEX.md',
  'docs/README.md',
  'docs/SCHEMA.md',
]);

function listMarkdownFiles() {
  const out = execFileSync('git', ['ls-files', '*.md'], { encoding: 'utf8' });
  return out.split('\n').map((line) => line.trim()).filter(Boolean);
}

function isHistoricalNoise(path) {
  if (path.startsWith('archive/')) return false;
  if (ALLOWED_LIVE.has(path)) return false;
  return HISTORICAL_PATTERNS.some((pattern) => pattern.test(path));
}

function main() {
  const offenders = listMarkdownFiles().filter(isHistoricalNoise);

  if (offenders.length > 0) {
    console.error('❌ Documents à signal historique trouvés hors archive/:');
    for (const file of offenders) console.error(` - ${file}`);
    console.error('\nDéplacer vers archive/YYYY-MM/<chemin-origine>/ ou renommer/classer explicitement vivant.');
    process.exit(1);
  }

  console.log('✅ docs-history-lint: aucun bruit historique évident hors archive/.');
}

main();
