'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const fs = require('fs');
const path = require('path');

test('L10 : Pilotage nomme le KPI « Commandes payées — part hors avoir » (ni CA, ni encaissé)', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../public/dashboards/canonical/js/pilotage.js'), 'utf8');
  expect(src).toContain("label: 'Commandes payées — part hors avoir'");
  expect(src).not.toMatch(/CA encaissé/);
});
