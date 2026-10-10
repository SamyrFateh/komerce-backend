'use strict';
const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(
  path.join(__dirname, '../../public/dashboards/canonical/css/import-runtime.css'), 'utf8');

describe('import-runtime.css — le menu latéral appartient à la coque standard', () => {
  test('aucune règle :has(.kmc-import-runtime) ne redessine le menu ni le décalage de page', () => {
    const rules = css.match(/[^{}]*:has\(\.kmc-import-runtime\)[^{}]*\{[^{}]*\}/g) || [];
    const offenders = rules.filter((r) => /kmc-admin-(navigation|primary|home|secondary-link|account|settings-link|logout|utility-nav|capability-group-label)|padding-left|sidebar-width/.test(r));
    expect(offenders).toEqual([]);
  });

  test('les libellés d’étape du flux Sourcing reprennent la typographie de Hub / Relais (visuel seul)', () => {
    expect(css).toContain('.kmc-import-runtime .kir-run-flow .kir-run-flow-step strong{text-transform:uppercase');
  });

  test('le flux Sourcing porte des anneaux d’état (fait / en cours / attente) comme la chaîne Hub / Relais', () => {
    expect(css).toContain('.kir-run-flow-step.is-completed .kir-run-flow-marker{box-shadow:0 0 0 5px');
    expect(css).toContain('.kir-run-flow-step.is-pending{opacity:.72}');
  });
});
