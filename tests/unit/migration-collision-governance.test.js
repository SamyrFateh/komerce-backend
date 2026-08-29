'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  evaluateCollisionGovernance,
  parseReviewedCollisionSets,
} = require('../../scripts/migration-collision-policy');
const { reclassifyLegacyOutput } = require('../../scripts/backend-audit');

const ROOT = path.join(__dirname, '..', '..');
const MIGRATIONS_DIR = path.join(ROOT, 'migrations');
const GAPS_FILE = path.join(MIGRATIONS_DIR, 'GAPS.md');

function writeFixture(dir, name) {
  fs.writeFileSync(path.join(dir, name), '-- fixture\n', 'utf8');
}

describe('migration collision governance — immutable history', () => {
  test('les 7 collisions historiques du dépôt correspondent exactement à GAPS.md', () => {
    const result = evaluateCollisionGovernance({ migrationsDir: MIGRATIONS_DIR });

    expect(result.violations).toEqual([]);
    expect(result.reviewedExact.map(entry => entry.token)).toEqual([
      '014', '072', '073', '074', '119', '128', '147',
    ]);
  });

  test('GAPS.md ne documente chaque token collision qu’une seule fois', () => {
    const content = fs.readFileSync(GAPS_FILE, 'utf8');
    const { reviewed, duplicateTokens } = parseReviewedCollisionSets(content);

    expect(duplicateTokens).toEqual([]);
    expect(reviewed.size).toBe(7);
    expect(content).toMatch(/fichiers SQL déjà versionnés sont \*\*immuables\*\*/i);
  });

  test('un troisième fichier sous un token réaudité redevient immédiatement bloquant', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kmrc-collision-policy-'));
    try {
      writeFixture(dir, '119_a.sql');
      writeFixture(dir, '119_b.sql');
      writeFixture(dir, '119_c.sql');
      fs.writeFileSync(
        path.join(dir, 'GAPS.md'),
        '- COLLISION: `119` = 119_a.sql, 119_b.sql\n',
        'utf8'
      );

      const result = evaluateCollisionGovernance({ migrationsDir: dir });
      expect(result.reviewedExact).toEqual([]);
      expect(result.violations).toEqual([
        expect.objectContaining({ token: '119', kind: 'set-mismatch' }),
      ]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('une collision non documentée reste bloquante', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kmrc-collision-policy-'));
    try {
      writeFixture(dir, '200_a.sql');
      writeFixture(dir, '200_b.sql');
      fs.writeFileSync(path.join(dir, 'GAPS.md'), '', 'utf8');

      const result = evaluateCollisionGovernance({ migrationsDir: dir });
      expect(result.violations).toEqual([
        expect.objectContaining({ token: '200', kind: 'undocumented' }),
      ]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('le rapport canonique reclassifie seulement I-BACK-10 en information', () => {
    const legacyOutput = [
      '',
      '  🔍  Audit architecture Komerce backend',
      '',
      '  ⚠️   12 avertissement(s) (violations connues — lots prévus) :',
      '',
      '  ── Taille des fichiers ── (5)',
      '     ⚠  services/example.js — 900 lignes',
      '',
      '  ── Collisions numéros migrations ── (7)',
      '     ⚠  Collision migration documentée (préfixe 014) : a.sql, b.sql',
      '       Dette connue listée dans migrations/GAPS.md',
      '',
      '  ✅  Aucune violation. Architecture conforme.',
      '',
    ].join('\n');

    const reviewed = [
      '014', '072', '073', '074', '119', '128', '147',
    ].map(token => ({ token, files: [`${token}_a.sql`, `${token}_b.sql`] }));

    const output = reclassifyLegacyOutput(legacyOutput, reviewed);

    expect(output).toContain('5 avertissement(s)');
    expect(output).toContain('7 collision(s) historique(s) de migrations immuables');
    expect(output).not.toContain('── Collisions numéros migrations ──');
    expect(output).toContain('── Taille des fichiers ── (5)');
  });
});
