'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { checkCollisionCountWording } = require('../../scripts/collision-count-wording-check');

const REAL_ROOT = path.join(__dirname, '..', '..');

function makeFixtureRoot({ collisionLines, gapsWordCount, auditWordCount }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kmrc-wording-check-'));
  fs.mkdirSync(path.join(dir, 'migrations'));
  fs.mkdirSync(path.join(dir, 'scripts'));

  fs.writeFileSync(
    path.join(dir, 'migrations', 'GAPS.md'),
    [
      `Les ${gapsWordCount} ensembles ci-dessous ont été réaudités le 2026-08-29.`,
      '',
      ...collisionLines,
      '',
    ].join('\n'),
    'utf8'
  );

  fs.writeFileSync(
    path.join(dir, 'scripts', 'backend-audit.js'),
    `// doctrine Debt Zero 2026-08-29 pour I-BACK-10 : les ${auditWordCount} ensembles exacts de\n`,
    'utf8'
  );

  return dir;
}

describe('collision-count-wording-check', () => {
  test('l’état réel du dépôt est cohérent (aucune violation)', () => {
    const { actualCount, violations } = checkCollisionCountWording({ rootDir: REAL_ROOT });
    expect(actualCount).toBeGreaterThan(0);
    expect(violations).toEqual([]);
  });

  test('détecte une dérive quand la prose reste figée après un nouveau token', () => {
    const dir = makeFixtureRoot({
      collisionLines: [
        '- COLLISION: `014` = 014_a.sql, 014_b.sql',
        '- COLLISION: `072` = 072_a.sql, 072_b.sql',
      ],
      gapsWordCount: 'un', // faux : il y a 2 tokens réels
      auditWordCount: 'un',
    });
    try {
      const { actualCount, violations } = checkCollisionCountWording({ rootDir: dir });
      expect(actualCount).toBe(2);
      expect(violations).toHaveLength(2);
      expect(violations.map(v => v.kind)).toEqual(['count-mismatch', 'count-mismatch']);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('passe quand la prose est alignée sur le nombre réel de tokens', () => {
    const dir = makeFixtureRoot({
      collisionLines: [
        '- COLLISION: `014` = 014_a.sql, 014_b.sql',
        '- COLLISION: `072` = 072_a.sql, 072_b.sql',
        '- COLLISION: `073` = 073_a.sql, 073_b.sql',
      ],
      gapsWordCount: 'trois',
      auditWordCount: 'trois',
    });
    try {
      const { violations } = checkCollisionCountWording({ rootDir: dir });
      expect(violations).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('signale un mot-nombre non reconnu plutôt que de le tolérer silencieusement', () => {
    const dir = makeFixtureRoot({
      collisionLines: ['- COLLISION: `014` = 014_a.sql, 014_b.sql'],
      gapsWordCount: 'beaucoup',
      auditWordCount: 'un',
    });
    try {
      const { violations } = checkCollisionCountWording({ rootDir: dir });
      expect(violations).toEqual([
        expect.objectContaining({ kind: 'unknown-word', file: path.join('migrations', 'GAPS.md') }),
      ]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
