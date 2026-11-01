'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

test('les libellés propres au marché ne modifient pas le composant global', () => {
  const service = read('services/cost-component-market-service.js');
  const workspace = read('services/pricing-workspace.js');
  expect(service).toContain('label_override');
  expect(service).toContain('description_override');
  expect(service).toContain('base_label: row.label');
  expect(service).toContain('cost_component_market_override_events');
  expect(workspace).toContain('payload.label = body.label');
  expect(workspace).toContain('payload.description = body.description');
});

test('coûts variables : libellé et description éditables sur un poste direct', () => {
  const ui = read('public/dashboards/canonical/js/pricing-economic-cockpit.js');
  expect(ui).toContain('data-variable-cost-label');
  expect(ui).toContain('data-variable-cost-description');
  expect(ui).toContain("allocationPerimeter(component) !== 'mutualized'");
  expect(ui).toContain("'Référence mutualisée en lecture seule");
});

test('charges fixes : les champs sont expliqués en français métier', () => {
  const ui = read('public/dashboards/canonical/js/pricing-structure-event-panel.js');
  for (const label of ['Ajouter une charge pour cette période', 'Montant de la période', 'Justificatif', 'Début de la période', 'Fin de la période', 'Montant déjà enregistré']) {
    expect(ui).toContain(label);
  }
  expect(ui).not.toContain("ACCRUAL: 'Accrual");
});
