'use strict';

const {
  arrayGrowth,
  countQualityDisables,
  extractArchSourceAllowlists,
  extractRuleFileExemptions,
  identityArrayGrowth,
  numericMapGrowth,
  objectKeyGrowth,
  parseApprovalSignal,
  parseApprovalContext,
  stableStringify,
} = require('../../scripts/debt-zero-gate');

const fs = require('fs');
const path = require('path');
const debtRegistry = require('../../governance/debt-zero-registry.json');

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

  test('arrayGrowth bloque un ajout mais autorise une suppression', () => {
    const failures = [];
    arrayGrowth(['a', 'b'], ['b', 'c'], 'baseline exempt', failures);
    expect(failures).toEqual(['baseline exempt: +"c"']);
  });

  test('identityArrayGrowth ignore une modification de raison mais bloque une nouvelle identité', () => {
    const failures = [];
    identityArrayGrowth(
      [{ file: 'a.js', category: 'xss', contains: 'innerHTML', reason: 'old' }],
      [
        { file: 'a.js', category: 'xss', contains: 'innerHTML', reason: 'better explanation' },
        { file: 'b.js', category: 'xss', contains: 'innerHTML', reason: 'new' },
      ],
      ['file', 'category', 'contains'],
      'impact',
      failures
    );
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain('file="b.js"');
  });

  test('stableStringify ne dépend pas de l’ordre des clés objet', () => {
    expect(stableStringify({ b: 2, a: { d: 4, c: 3 } }))
      .toBe(stableStringify({ a: { c: 3, d: 4 }, b: 2 }));
  });

  test('countQualityDisables compte les suppressions inline par règle', () => {
    const marker = ['quality', 'disable'].join('-');
    const counts = countQualityDisables([
      `db.query(sql); // ${marker} N2-SQL-INJECTION`,
      `foo(); // ${marker} N2-X`,
      `bar(); // ${marker} N2-X`,
    ].join('\n'));
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

  test('extractArchSourceAllowlists couvre ALLOWED_* et COLUMN_OWNERSHIP.allowlist', () => {
    const src = `
      const ALLOWED_LARGE_FILES = new Set([
        'routes/a.js',
      ]);
      const ALLOWED_RAW_SQL_PATTERNS = [
        /SAVEPOINT\\s+\\w+/i,
      ];
      const COLUMN_OWNERSHIP = [
        {
          id: 'orders.status',
          owners: new Set(['services/owner.js']),
          allowlist: new Set([
            'scripts/fix-schema.js',
          ]),
        },
      ];
    `;
    const out = extractArchSourceAllowlists(src);
    expect([...out.get('ALLOWED_LARGE_FILES')]).toEqual(["'routes/a.js'"]);
    expect([...out.get('ALLOWED_RAW_SQL_PATTERNS')]).toEqual(['/SAVEPOINT\\s+\\w+/i']);
    expect([...out.get('COLUMN_OWNERSHIP.orders.status.allowlist')])
      .toEqual(["'scripts/fix-schema.js'"]);
  });

  test('parseApprovalSignal accepte uniquement le geste simplifié', () => {
    expect(parseApprovalSignal('DEBT-APPROVAL')).toBe(true);
    expect(parseApprovalSignal('DEBT-APPROVAL\nmerci')).toBe(true);
    expect(parseApprovalSignal('DEBT-APPROVAL abc')).toBe(false);
  });

  test('parseApprovalContext exige explication et justification dans la PR', () => {
    const valid = [
      'Explication: Le registre doit protéger la source réellement exécutée par les gates.',
      'Justification: La correction ferme un trou de gouvernance sans créer de tolérance.',
    ].join('\n');
    expect(parseApprovalContext(valid)).not.toBeNull();
    expect(parseApprovalContext('Explication: trop court\nJustification: trop court')).toBeNull();
  });

  test('chaque cible du registre Debt Zero existe réellement', () => {
    const root = path.join(__dirname, '../..');
    const missing = Object.keys(debtRegistry.files).filter(file => !fs.existsSync(path.join(root, file)));
    expect(missing).toEqual([]);
  });

});
