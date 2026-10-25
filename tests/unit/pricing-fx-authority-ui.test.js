'use strict';

/** @test-kind unit @test-runner jest @test-requires none */

const fs = require('fs');
const path = require('path');
const source = fs.readFileSync(
  path.join(__dirname, '../../public/dashboards/canonical/js/pricing-workspace.js'), 'utf8'
);

describe('Pricing FX authority administration', () => {
  test('seul un administrateur visualise la saisie et la double approbation', () => {
    expect(source).toContain("context.user?.role || '').toLowerCase() !== 'admin'");
    expect(source).toContain("context.user?.email || context.user?.id");
    expect(source).toContain("String(obs.entered_by || '').trim().toLowerCase() !== sessionIdentity");
    expect(source).toContain("obs.approved_by");
  });

  test('soumet une observation EUR/USD horodatée et sourcée par les endpoints existants', () => {
    expect(source).toContain("'/api/admin/finance-config/fx-observations'");
    expect(source).toContain("input.name = name;");
    for (const field of ['rate', 'as_of', 'source_label', 'source_ref']) {
      expect(source).toContain(`['${field}',`);
    }
    expect(source).toContain("as_of: asOf.toISOString()");
    expect(source).toContain("await jsonRequest(context.fetch, endpoint, {");
    expect(source).toContain("method: 'POST'");
    expect(source).toContain("/approve");
  });

  test('aucun taux par défaut ni approbation automatique lors de la saisie', () => {
    expect(source).toContain('Les cotations publiques de la BCE sont synchronisées automatiquement');
    expect(source).toContain("form.addEventListener('submit'");
    expect(source).toContain("Observation enregistrée. Approbation requise depuis un deuxième compte admin.");
    expect(source).not.toMatch(/input\.value\s*=\s*['\"]1\.[0-9]+/);
    expect(source).toContain("panel.id = 'fx-authority'");
  });
});
