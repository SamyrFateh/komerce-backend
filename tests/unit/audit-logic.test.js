'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const { included, markdown } = require('../../scripts/audit-logic');

test('audit:logic analyse les sources applicatives et outils suivis, jamais les jeux de test', () => {
  expect(included('services/refund-service.js')).toBe(true);
  expect(included('routes/parcels.js')).toBe(true);
  expect(included('scripts/lib/arch-drift-core.js')).toBe(true);
  expect(included('tests/e2e-api/foo.e2e.test.js')).toBe(false);
  expect(included('migrations/050_example.js')).toBe(false);
  expect(included('node_modules/mod/index.js')).toBe(false);
});

test('le rapport refuse de faire passer une suspicion pour un bug confirmé', () => {
  const report = markdown({
    sha: 'testSHA', base: 'baseSHA', scannedFiles: 5, changedFiles: 1,
    findings: [{
      rule: 'LS-03', priority: 'P1', category: 'FIN', novelty: 'NEW',
      file: 'services/paypal-client.js', line: 8, snippet: 'Date.now()',
    }],
    newFindings: 1,
    gates: [{ name: 'Gouvernance', status: 'PASS' }],
  });
  expect(report).toContain('suspicion');
  expect(report).toContain('P1');
  expect(report).toContain('**Portée :**');
  expect(report).not.toContain('1 bug confirmé');
});
