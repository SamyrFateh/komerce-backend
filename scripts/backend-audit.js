'use strict';

/**
 * Entrée canonique de `npm run backend:audit`.
 *
 * `audit-backend-arch.js` reste le détecteur historique. Ce wrapper ajoute la
 * doctrine Debt Zero 2026-08-29 pour I-BACK-10 : les sept ensembles exacts de
 * migrations déjà publiées, documentés dans GAPS.md, sont de l'historique
 * immuable réaudité et non une dette à « corriger » par renommage.
 *
 * Sécurité : avant toute reclassification de rapport, on rescane le disque et
 * exige l'égalité exacte avec GAPS.md. Toute nouvelle collision, disparition,
 * différence d'ensemble ou documentation dupliquée fait échouer le gate.
 */

const path = require('path');
const { spawnSync } = require('child_process');
const { evaluateCollisionGovernance } = require('./migration-collision-policy');

const ROOT = process.env.ROOT || process.cwd();
const MIGRATIONS_DIR = path.join(ROOT, 'migrations');
const LEGACY_AUDIT = path.join(__dirname, 'audit-backend-arch.js');

function printCollisionGovernanceFailure(violations) {
  console.error('\n  ❌  Gouvernance collisions migrations invalide :\n');
  for (const violation of violations) {
    console.error(`     ✗  [${violation.token}] ${violation.message}`);
    if (violation.expected) console.error(`        attendu : ${violation.expected.join(', ')}`);
    if (violation.files) console.error(`        présent  : ${violation.files.join(', ')}`);
  }
  console.error('\n  → Corriger la collision ou GAPS.md sans modifier une migration déjà versionnée.\n');
}

function buildReviewedInfo(reviewedExact) {
  if (reviewedExact.length === 0) return [];
  return [
    `  ℹ️   ${reviewedExact.length} collision(s) historique(s) de migrations immuables réauditée(s) :`,
    '',
    `  ── Collisions historiques immuables ── (${reviewedExact.length})`,
    ...reviewedExact.map(({ token, files }) =>
      `     ℹ  préfixe ${token} : ${files.join(', ')}`
    ),
    '       Ensemble exact ancré dans migrations/GAPS.md ; tout écart reste bloquant.',
    '',
  ];
}

function reclassifyLegacyOutput(stdout, reviewedExact) {
  const lines = String(stdout || '').replace(/\r\n/g, '\n').split('\n');
  const reviewedCount = reviewedExact.length;

  // Supprimer uniquement la section warning I-BACK-10 du rapport legacy.
  const collisionHeading = lines.findIndex(line =>
    line.includes('── Collisions numéros migrations ──')
  );
  if (collisionHeading >= 0) {
    let end = collisionHeading + 1;
    while (
      end < lines.length &&
      !lines[end].startsWith('  ── ') &&
      !lines[end].startsWith('  ✅') &&
      !lines[end].startsWith('  ❌')
    ) {
      end += 1;
    }
    lines.splice(collisionHeading, end - collisionHeading);
  }

  // Recalculer le nombre d'avertissements affiché : les collisions exactes
  // réauditées ne sont plus des warnings, mais restent affichées en information.
  const warningHeader = lines.findIndex(line => /avertissement\(s\)/.test(line));
  if (warningHeader >= 0) {
    const match = lines[warningHeader].match(/(\d+)\s+avertissement\(s\)/);
    if (match) {
      const legacyCount = Number(match[1]);
      const remaining = Math.max(0, legacyCount - reviewedCount);
      if (remaining === 0) {
        lines.splice(warningHeader, 1);
        if (lines[warningHeader] === '') lines.splice(warningHeader, 1);
      } else {
        lines[warningHeader] = lines[warningHeader].replace(
          /\d+\s+avertissement\(s\)/,
          `${remaining} avertissement(s)`
        );
      }
    }
  }

  const successIndex = lines.findIndex(line => line.startsWith('  ✅'));
  const infoLines = buildReviewedInfo(reviewedExact);
  if (infoLines.length > 0) {
    lines.splice(successIndex >= 0 ? successIndex : lines.length, 0, ...infoLines);
  }

  return lines.join('\n').replace(/\n{4,}/g, '\n\n\n');
}

function main() {
  const governance = evaluateCollisionGovernance({ migrationsDir: MIGRATIONS_DIR });
  if (governance.violations.length > 0) {
    printCollisionGovernanceFailure(governance.violations);
    process.exit(1);
  }

  const result = spawnSync(process.execPath, [LEGACY_AUDIT], {
    cwd: ROOT,
    env: process.env,
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    process.exit(result.status == null ? 1 : result.status);
  }

  const output = reclassifyLegacyOutput(result.stdout, governance.reviewedExact);
  process.stdout.write(output.endsWith('\n') ? output : `${output}\n`);
  if (result.stderr) process.stderr.write(result.stderr);
}

if (require.main === module) main();

module.exports = {
  buildReviewedInfo,
  reclassifyLegacyOutput,
};
