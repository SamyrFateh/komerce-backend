'use strict';

const {
  parseNameStatus,
  isMigrationSql,
  evaluate,
} = require('../../scripts/check-migration-immutability');

describe('migration immutability PR gate', () => {
  test('parse les statuts Git name-status', () => {
    expect(parseNameStatus('A\tmigrations/144_new.sql\nM\tmigrations/099_old.sql\n')).toEqual([
      { rawStatus: 'A', code: 'A', paths: ['migrations/144_new.sql'] },
      { rawStatus: 'M', code: 'M', paths: ['migrations/099_old.sql'] },
    ]);
  });

  test('reconnaît les migrations SQL y compris sous-dossiers', () => {
    expect(isMigrationSql('migrations/144_new.sql')).toBe(true);
    expect(isMigrationSql('migrations/_superseded/099_old.sql')).toBe(true);
    expect(isMigrationSql('docs/db/schema.sql')).toBe(false);
  });

  test('autorise uniquement les ajouts append-only', () => {
    const result = evaluate(parseNameStatus(
      'A\tmigrations/144_new.sql\nA\tmigrations/145_more.sql\n'
    ));
    expect(result.ok).toBe(true);
    expect(result.additions).toEqual([
      'migrations/144_new.sql',
      'migrations/145_more.sql',
    ]);
    expect(result.violations).toEqual([]);
  });

  test.each([
    ['M\tmigrations/099_old.sql\n', 'M'],
    ['D\tmigrations/099_old.sql\n', 'D'],
    ['R100\tmigrations/099_old.sql\tmigrations/_superseded/099_old.sql\n', 'R100'],
  ])('bloque une réécriture historique %s', (diff, expectedStatus) => {
    const result = evaluate(parseNameStatus(diff));
    expect(result.ok).toBe(false);
    expect(result.violations[0].status).toBe(expectedStatus);
  });

  test('ignore les changements non SQL', () => {
    const result = evaluate(parseNameStatus(
      'M\tdocs/README.md\nA\tmigrations/README.md\n'
    ));
    expect(result.ok).toBe(true);
    expect(result.additions).toEqual([]);
  });
});
