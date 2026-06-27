#!/usr/bin/env node
/*
 * @komerce-arch
 * @domain platform-ops
 * @owner platform-ops
 * @responsibility Bloque la réintroduction de bruit documentaire historique hors archive.
 * @inputs git-tracked markdown paths, git diff
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

const ALL_MODE = process.argv.includes('--all');

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

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function splitLines(out) {
  return out.split('\n').map((line) => line.trim()).filter(Boolean);
}

function listAllMarkdownFiles() {
  return splitLines(git(['ls-files', '*.md']));
}

function listChangedMarkdownFiles() {
  const base = process.env.BASE_REF || 'origin/main';
  try {
    const mergeBase = git(['merge-base', 'HEAD', base]);
    return splitLines(git(['diff', '--name-only', `${mergeBase}...HEAD`, '--', '*.md']));
  } catch (_) {
    return splitLines(git(['diff', '--name-only', 'HEAD~1..HEAD', '--', '*.md']));
  }
}

function isHistoricalNoise(path) {
  if (path.startsWith('archive/')) return false;
  if (ALLOWED_LIVE.has(path)) return false;
  return HISTORICAL_PATTERNS.some((pattern) => pattern.test(path));
}

function main() {
  const files = ALL_MODE ? listAllMarkdownFiles() : listChangedMarkdownFiles();
  const offenders = files.filter(isHistoricalNoise);

  if (offenders.length > 0) {
    const mode = ALL_MODE ? 'all' : 'changed';
    console.error(`❌ Documents à signal historique trouvés hors archive/ (${mode}):`);
    for (const file of offenders) console.error(` - ${file}`);
    console.error('\nDéplacer vers archive/YYYY-MM/<chemin-origine>/ ou renommer/classer explicitement vivant.');
    process.exit(1);
  }

  const mode = ALL_MODE ? 'all' : 'changed';
  console.log(`✅ docs-history-lint (${mode}): aucun bruit historique évident hors archive/.`);
}

main();
