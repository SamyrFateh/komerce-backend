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
});
