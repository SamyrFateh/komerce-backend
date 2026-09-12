'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { runCheck, BASELINE } = require('../../scripts/check-currency-truncation');

function makeRepo(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'trunc-gate-'));
  fs.mkdirSync(path.join(root, 'services'));
  fs.mkdirSync(path.join(root, 'routes'));
  for (const [rel, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(root, rel), content);
  }
  return root;
}

describe('check-currency-truncation — cliquet anti-troncature monétaire', () => {
  test('détecte un arrondi affecté à un champ *_kmf (littéral d’objet)', () => {
    const root = makeRepo({ 'services/a.js': 'const o = { total_kmf: Math.round(x) };' });
    const r = runCheck({ root, print: false });
    expect(r.count).toBe(1);
    expect(r.findings[0].field).toBe('total_kmf');
  });

  test('détecte aussi une affectation de variable *_kmf', () => {
    // Angle mort d'un premier jet du gate, trouvé par test de mutation :
    // seule la forme `champ:` était couverte.
    const root = makeRepo({ 'services/a.js': 'const total_kmf = Math.round(x);' });
    expect(runCheck({ root, print: false }).count).toBe(1);
  });

  test('détecte parseInt, Math.trunc, Math.floor et Math.ceil', () => {
    const root = makeRepo({
      'services/a.js': [
        'const a_kmf = parseInt(x);',
        'const b_kmf = Math.trunc(x);',
        'const c_kmf = Math.floor(x);',
        'const d_kmf = Math.ceil(x);',
      ].join('\n'),
    });
    expect(runCheck({ root, print: false }).count).toBe(4);
  });

  test('n’alerte PAS sur un arrondi au centime — c’est le motif correct', () => {
    // Math.round(x * 100) / 100 est la bonne façon de neutraliser une dérive
    // flottante (cf. services/wallet-service.js). L'interdire pousserait vers
    // le contraire de l'objectif.
    const root = makeRepo({ 'services/a.js': 'const total_kmf = Math.round(x * 100) / 100;' });
    expect(runCheck({ root, print: false }).count).toBe(0);
  });

  test('n’alerte PAS sur les champs non monétaires (pct, count, quantity)', () => {
    const root = makeRepo({
      'services/a.js': 'const o = { margin_pct: Math.round(x), items_count: Math.round(y) };',
    });
    expect(runCheck({ root, print: false }).count).toBe(0);
  });

  test('ignore les commentaires', () => {
    const root = makeRepo({ 'services/a.js': '// const total_kmf = Math.round(x);' });
    expect(runCheck({ root, print: false }).count).toBe(0);
  });

  test('ignore les fichiers de test', () => {
    const root = makeRepo({ 'services/a.test.js': 'const total_kmf = Math.round(x);' });
    expect(runCheck({ root, print: false }).count).toBe(0);
  });

  test('ok tant que le compte reste au niveau du cliquet, échoue au-dessus', () => {
    const under = makeRepo({ 'services/a.js': 'const total_kmf = Math.round(x);' });
    expect(runCheck({ root: under, print: false }).ok).toBe(true);

    const lines = [];
    for (let i = 0; i <= BASELINE; i++) lines.push(`const v${i}_kmf = Math.round(x);`);
    const over = makeRepo({ 'services/a.js': lines.join('\n') });
    const r = runCheck({ root: over, print: false });
    expect(r.count).toBe(BASELINE + 1);
    expect(r.ok).toBe(false);
  });
});
