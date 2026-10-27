'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const fs = require('node:fs');
const path = require('node:path');

describe('sourcing handoff boundary', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../public/dashboards/canonical/js/sourcing-workspace.js'), 'utf8');
  test('completed sourcing candidates are not actionable after handoff', () => {
    expect(source).toContain("context.focusCandidateRef");
    expect(source).toContain("row.candidate_ref === context.focusCandidateRef");
    expect(source).toContain(": !['imported_to_catalog', 'rejected'].includes(row.state)");
    expect(source).toContain("if (!['imported_to_catalog', 'rejected'].includes(row.state))");
    expect(source).toContain('Exceptions sourcing à traiter');
    expect(source).toContain('préparation produit relève de la Raffinerie');
  });
});
