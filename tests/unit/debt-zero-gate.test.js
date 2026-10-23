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
  approvalMatchesHead,
  PENDING_APPROVAL_EXIT,
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

  test('parseApprovalSignal exige un SHA explicite (≥ 12 caractères hexadécimaux)', () => {
    expect(parseApprovalSignal('DEBT-APPROVAL')).toBeNull();
    expect(parseApprovalSignal('DEBT-APPROVAL abc')).toBeNull();
    expect(parseApprovalSignal('DEBT-APPROVAL 5d24dcd7c')).toBeNull();
    expect(parseApprovalSignal('DEBT-APPROVAL 5d24dcd7c0ab12\nmerci')).toBe('5d24dcd7c0ab12');
    expect(parseApprovalSignal('merci\nDEBT-APPROVAL 5d24dcd7c0ab12')).toBeNull();
  });

  test('l’accord ne vaut que pour le SHA exact approuvé, jamais pour un autre commit', () => {
    const head = '5d24dcd7c0ab12ffeeddccbbaa99887766554433';
    expect(approvalMatchesHead('5d24dcd7c0ab12', head)).toBe(true);
    expect(approvalMatchesHead(head, head)).toBe(true);
    expect(approvalMatchesHead('5d24dcd7c0ab13', head)).toBe(false);
    expect(approvalMatchesHead(null, head)).toBe(false);
  });

  test('l’accord ne se déduit jamais d’une date de commit (forgeable par l’auteur)', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '../../scripts/debt-zero-gate.js'), 'utf8');
    expect(src).not.toMatch(/committer\?\.date|headAt/);
    expect(src).toContain('prMeta.head.sha !== head');
  });

  test('en local (--local), l’accord en attente est le code 3, distinct d’un échec', () => {
    expect(PENDING_APPROVAL_EXIT).toBe(3);
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

  test('le workflow fournit le numéro de la PR au contrôle humain Debt Zero', () => {
    const workflow = fs.readFileSync(path.join(__dirname, '../../.github/workflows/pr-enforcement.yml'), 'utf8');
    const step = workflow.match(/- name: Debt Zero — forbid baseline and exemption growth\n([\s\S]*?)\n\s*- name:/);
    expect(step).not.toBeNull();
    expect(step[1]).toContain('PR_NUMBER: ${{ inputs.pr_number || github.event.pull_request.number }}');
    expect(step[1]).toContain('node scripts/debt-zero-gate.js');
  });

});
