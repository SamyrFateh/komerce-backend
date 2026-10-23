'use strict';

const gate = require('../../scripts/feature-invariant-check');

describe('feature-invariant-check — classification et runner officiel', () => {
  const runners = gate.loadRunners();

  test('classe chaque famille de test', () => {
    expect(gate.classifyTest('tests/unit/a.test.js')).toBe('unit');
    expect(gate.classifyTest('tests/invariants/a.test.js')).toBe('unit');
    expect(gate.classifyTest('tests/integration/a.test.js')).toBe('integration');
    expect(gate.classifyTest('tests/e2e-api/a.e2e.test.js')).toBe('e2e-api');
    expect(gate.classifyTest('tests/e2e/a.spec.js')).toBe('playwright');
    expect(gate.classifyTest('public/boutique/tests/unit/a.test.js')).toBe('boutique');
    expect(gate.classifyTest('docs/a.md')).toBe('unknown');
  });

  test('un test unitaire hors testMatch officiel est orphelin', () => {
    expect(gate.coveredByOfficialRunner('tests/unit/x.test.js', 'unit', runners)).toBe(true);
    expect(gate.coveredByOfficialRunner('tests/helpers/x.test.js', 'unit', runners)).toBe(false);
  });

  test('un spec Playwright non enregistré dans DASHBOARD_SPECS est orphelin', () => {
    expect(gate.coveredByOfficialRunner('tests/e2e/hub-live-execution.spec.js', 'playwright', runners)).toBe(true);
    expect(gate.coveredByOfficialRunner('tests/e2e/jamais-enregistre.spec.js', 'playwright', runners)).toBe(false);
  });

  test('globToRegExp gère ** et *', () => {
    const re = gate.globToRegExp('<rootDir>/tests/unit/**/*.test.js');
    expect(re.test('tests/unit/a.test.js')).toBe(true);
    expect(re.test('tests/unit/x/y/a.test.js')).toBe(true);
    expect(re.test('tests/unitx/a.test.js')).toBe(false);
  });

  test('staticFindings signale fichier absent et runner absent', () => {
    const out = gate.staticFindings([
      { feature: 'f', statement: 's', test: 'tests/unit/n-existe-pas.test.js' },
      { feature: 'f', statement: 's', test: 'tests/e2e/jamais-enregistre.spec.js' },
      { feature: 'f', statement: 's', test: 'tests/unit/feature-invariant-check.test.js' },
    ], { unit: runners.unit, playwright: new Set() }, require('path').resolve(__dirname, '../..'));
    expect(out.map(f => f.code)).toEqual(['FICHIER_INTROUVABLE', 'FICHIER_INTROUVABLE']);
  });
});

describe('feature-invariant-check — cliquet des invariants textuels', () => {
  test('collect sépare exécutables et textuels', () => {
    const { executable, textual } = gate.collect([
      { id: 'a', invariants: ['texte', { statement: 's', test: 't' }, { statement: 'sans test' }] },
    ]);
    expect(executable).toHaveLength(1);
    expect(textual).toEqual({ a: 2 });
  });

  test('un nouvel invariant textuel dépasse la baseline ; une nouvelle feature part de 0', () => {
    expect(gate.ratchetFindings({ a: 3, b: 1, c: 2 }, { a: 3, c: 1 })).toEqual([
      { feature: 'b', count: 1, max: 0 },
      { feature: 'c', count: 2, max: 1 },
    ]);
    expect(gate.ratchetFindings({ a: 2 }, { a: 3 })).toEqual([]);
  });

  test('une carte s’évalue depuis son texte (commit de base), sans fichier de tolérance', () => {
    const card = gate.evalCard("module.exports = { name: 'x', invariants: ['a', { statement: 's', test: 't' }] };", '/tmp/x.feature.js');
    expect(gate.collect([{ id: card.name, invariants: card.invariants }]).textual).toEqual({ x: 1 });
  });

  test('le stock textuel du commit HEAD est mesurable et cohérent avec les cartes chargées', () => {
    const { spawnSync } = require('child_process');
    const head = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
    const atHead = gate.textualAtBase(head);
    expect(Object.values(atHead).reduce((s, n) => s + n, 0)).toBeGreaterThan(0);
    expect(() => gate.textualAtBase('0000000000000000000000000000000000000000')).toThrow(/illisible/);
  });
});

describe('feature-invariant-check — jamais de succès à vide', () => {
  const ok = { status: 'passed', assertionResults: [{ status: 'passed' }] };

  test('fichier prouvé', () => {
    expect(gate.evaluateFileResult(ok)).toEqual({ ok: true, reason: '1 test(s) passé(s)' });
  });

  test('suite skippée (ex. sans DATABASE_URL) = échec', () => {
    expect(gate.evaluateFileResult({ status: 'passed', assertionResults: [{ status: 'pending' }] }).ok).toBe(false);
    expect(gate.evaluateFileResult({ status: 'passed', assertionResults: [] }).reason).toMatch(/succès à vide/);
  });

  test('un test ignoré parmi des tests passés = preuve incomplète', () => {
    const r = gate.evaluateFileResult({ status: 'passed', assertionResults: [{ status: 'passed' }, { status: 'todo' }] });
    expect(r).toEqual({ ok: false, reason: '1 test(s) ignoré(s) : preuve incomplète' });
  });

  test('suite qui ne démarre pas ou test rouge = échec', () => {
    expect(gate.evaluateFileResult({ status: 'failed', message: 'Test suite failed to run\nboom', assertionResults: [] }).reason)
      .toMatch(/Test suite failed to run/);
    expect(gate.evaluateFileResult({ status: 'passed', assertionResults: [{ status: 'failed' }] }).ok).toBe(false);
    expect(gate.evaluateFileResult(undefined).ok).toBe(false);
  });

  test('--run accepte unit, db, boutique, all et refuse le reste', () => {
    expect(gate.parseRunArg([])).toEqual([]);
    expect(gate.parseRunArg(['--run=all'])).toEqual(['unit', 'db', 'boutique']);
    expect(gate.parseRunArg(['--run=unit,db'])).toEqual(['unit', 'db']);
    expect(() => gate.parseRunArg(['--run=playwright'])).toThrow(/inconnu/);
  });
});


describe('diagnostic des erreurs de preuves E2E', () => {
  test('affiche la cause technique plutôt que le seul titre du test', () => {
    const result = gate.evaluateFileResult({
      status: 'failed',
      assertionResults: [{ status: 'failed' }],
      message: '● nom du test\\n  Error: relation refund_execution_intents missing\\n    at line',
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('relation refund_execution_intents missing');
  });
});
