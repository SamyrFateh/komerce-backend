'use strict';
/** @test-kind unit @test-runner jest @test-requires none */
const { paleYellowFills } = require('../helpers/noYellowFill');

test('purchasing-workspace.css : aucun fond jaune/crème pâle (fond blanc)', () => {
  expect(paleYellowFills('purchasing-workspace.css')).toEqual([]);
});

test('purchasing-workspace.css : plancher typographique (aucun texte sous 10 px)', () => {
  expect(require('../helpers/fontFloor').tinyFonts('purchasing-workspace.css')).toEqual([]);
});

describe('purchasing-workspace — rafraîchissement intersession sans destruction des saisies', () => {
  const freshnessFs = require('fs');
  const freshnessPath = require('path');
  const source = freshnessFs.readFileSync(
    freshnessPath.join(__dirname, '../../public/dashboards/canonical/js/purchasing-workspace.js'), 'utf8');
  test('relit les API canoniques en arrière-plan, et attend la fin de la saisie', () => {
    expect(source).toContain('KomerceDashboardFreshness?.watch?.({');
    expect(source).toContain('isBusy:workspaceBusy');
    expect(source).toContain('if (background && workspaceBusy()) return');
    expect(source).toContain('context.reload({ background:true })');
    expect(source).toContain("'data-dashboard-stale'");
  });
});
