'use strict';

const {
  countQualityDisables,
  extractRuleFileExemptions,
  numericMapGrowth,
  objectKeyGrowth,
} = require('../../scripts/debt-zero-gate');

describe('debt-zero-gate', () => {
  test('numericMapGrowth refuse une augmentation et autorise une réduction', () => {
    const failures = [];
    numericMapGrowth({ A: 2, B: 3 }, { A: 1, B: 4, C: 1 }, 'baseline ', failures);
    expect(failures).toEqual([
      'baseline B: 3 -> 4',
      'baseline C: 0 -> 1',
    ]);
  });

  test('objectKeyGrowth refuse une nouvelle exemption mais ignore les métadonnées', () => {
    const failures = [];
    objectKeyGrowth(
      { _comment: 'meta', 'routes/a.js': 'ok' },
      { _comment: 'changed', 'routes/a.js': 'ok', 'routes/b.js': 'new' },
      'exemptions ',
      failures
    );
    expect(failures).toEqual(['exemptions routes/b.js: nouvelle exemption/allowance']);
  });

  test('countQualityDisables compte les suppressions inline par règle', () => {
    const counts = countQualityDisables(`
      db.query(sql); // quality-disable N2-SQL-INJECTION
      foo(); // quality-disable N2-X
      bar(); // quality-disable N2-X
    `);
    expect(counts.get('N2-SQL-INJECTION')).toBe(1);
    expect(counts.get('N2-X')).toBe(2);
  });

  test('extractRuleFileExemptions extrait les fichiers exemptés par règle', () => {
    const src = `
      const RULE_FILE_EXEMPT = {
        'N2-NO-CONSOLE': new Set([
          'utils/logger.js',
          'middleware/error-handler.js',
        ]),
        'N2-OTHER': new Set([
          'utils/other.js',
        ]),
      };
    `;
    const out = extractRuleFileExemptions(src);
    expect([...out.get('N2-NO-CONSOLE')].sort()).toEqual([
      'middleware/error-handler.js',
      'utils/logger.js',
    ]);
    expect([...out.get('N2-OTHER')]).toEqual(['utils/other.js']);
  });
});
