'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const fs = require('fs');
const path = require('path');

test('L3b.7 : Pilotage nomme le KPI « Ventes payées (avoir inclus) » (ni encaissement, ni marge)', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../public/dashboards/canonical/js/pilotage.js'), 'utf8');
  expect(src).toContain("label: 'Ventes payées (avoir inclus)'");
  expect(src).not.toMatch(/CA encaissé/);
});
