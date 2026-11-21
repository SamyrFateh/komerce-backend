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
    // TEST et WATCH peuvent demander une action au Sourcing ; la règle
    // de non-retour au Sourcing s'applique aux états terminaux.
    expect(source).toContain('Boolean(sourcingRemedy(row) || candidatePromotionEligible(row) ||');
    expect(source).toContain('candidateWatchActionEligible(row)))');
    expect(source).toContain("['imported_to_catalog','rejected','archived','quarantined'].includes(state)");
    expect(source).toContain('Exceptions fournisseur à résoudre');
    expect(source).toContain('Les classements, traductions et validations sont dans le Catalogue');
  });

  test('états terminaux refusés même avec prix manquant ou décision TEST', () => {
    jest.resetModules();
    delete global.KomerceCanonicalSourcingWorkspace;
    require('../../public/dashboards/canonical/js/sourcing-workspace');
    const api = global.KomerceCanonicalSourcingWorkspace;
    for (const state of ['imported_to_catalog', 'rejected', 'archived', 'quarantined']) {
      const row = { state, purchase_price:0, currency:'',
        scan_result:{ sourcing_decision:'TEST' } };
      expect(api.sourcingRemedy(row)).toBeNull();
      expect(api.candidatePromotionEligible(row)).toBe(false);
    }
  });
});
