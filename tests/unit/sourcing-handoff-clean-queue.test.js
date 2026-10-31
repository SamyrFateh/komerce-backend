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
    expect(source).toContain('Boolean(sourcingRemedy(row))');
    expect(source).toContain("['imported_to_catalog','rejected','archived','quarantined'].includes(state)");
    expect(source).toContain('Exceptions fournisseur à résoudre');
    expect(source).toContain('Les classements, traductions et validations sont dans le Catalogue');
  });
});
