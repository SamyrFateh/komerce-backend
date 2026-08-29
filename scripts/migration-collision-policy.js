'use strict';

/**
 * Gouvernance des collisions de migrations historiques.
 *
 * Source de vérité : migrations/GAPS.md, lignes
 *   - COLLISION: `TOKEN` = fichier_a.sql, fichier_b.sql
 *
 * Une collision documentée n'est saine que si l'ensemble présent sur disque
 * est EXACTEMENT celui documenté. Tout ajout, retrait, remplacement ou nouvelle
 * collision reste bloquant.
 */

const fs = require('fs');
const path = require('path');

const COLLISION_RE = /COLLISION:\s*`([^`]+)`\s*=\s*([^\n]+)/g;
const TOKEN_RE = /^(\d+[a-z]?)(?:_|\.sql$)/;

function parseReviewedCollisionSets(gapsContent) {
  const reviewed = new Map();
  const duplicateTokens = [];

  for (const match of gapsContent.matchAll(COLLISION_RE)) {
    const token = match[1];
    const files = new Set(
      match[2]
        .split(',')
        .map(value => value.trim())
        .filter(Boolean)
    );

    if (reviewed.has(token)) duplicateTokens.push(token);
    reviewed.set(token, files);
  }

  return { reviewed, duplicateTokens };
}

function scanCollisionSets(migrationsDir) {
  const groups = new Map();

  for (const file of fs.readdirSync(migrationsDir).filter(name => name.endsWith('.sql'))) {
    const match = file.match(TOKEN_RE);
    if (!match) continue;
    const token = match[1];
    if (!groups.has(token)) groups.set(token, new Set());
    groups.get(token).add(file);
  }

  return new Map([...groups].filter(([, files]) => files.size > 1));
}

function setsEqual(a, b) {
  if (a.size !== b.size) return false;
  for (const value of a) if (!b.has(value)) return false;
  return true;
}

function evaluateCollisionGovernance({ migrationsDir, gapsFile } = {}) {
  if (!migrationsDir) throw new Error('migrationsDir requis');
  const resolvedGapsFile = gapsFile || path.join(migrationsDir, 'GAPS.md');
  const gapsContent = fs.readFileSync(resolvedGapsFile, 'utf8');
  const { reviewed, duplicateTokens } = parseReviewedCollisionSets(gapsContent);
  const actual = scanCollisionSets(migrationsDir);

  const reviewedExact = [];
  const violations = [];

  for (const token of duplicateTokens) {
    violations.push({
      token,
      kind: 'duplicate-documentation',
      message: `Token ${token} documenté plusieurs fois dans GAPS.md`,
    });
  }

  for (const [token, files] of actual) {
    const expected = reviewed.get(token);
    if (!expected) {
      violations.push({
        token,
        kind: 'undocumented',
        files: [...files].sort(),
        message: `Collision non documentée pour ${token}`,
      });
      continue;
    }

    if (!setsEqual(expected, files)) {
      violations.push({
        token,
        kind: 'set-mismatch',
        files: [...files].sort(),
        expected: [...expected].sort(),
        message: `Ensemble réel différent de l'ensemble réaudité pour ${token}`,
      });
      continue;
    }

    reviewedExact.push({ token, files: [...files].sort() });
  }

  for (const [token, files] of reviewed) {
    if (!actual.has(token)) {
      violations.push({
        token,
        kind: 'documented-but-absent',
        expected: [...files].sort(),
        message: `Collision documentée absente du dépôt pour ${token}`,
      });
    }
  }

  reviewedExact.sort((a, b) => a.token.localeCompare(b.token, undefined, { numeric: true }));
  violations.sort((a, b) => a.token.localeCompare(b.token, undefined, { numeric: true }));

  return { reviewedExact, violations };
}

module.exports = {
  COLLISION_RE,
  TOKEN_RE,
  parseReviewedCollisionSets,
  scanCollisionSets,
  setsEqual,
  evaluateCollisionGovernance,
};
